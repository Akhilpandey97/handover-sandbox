-- Baseline schema for the Handover app.
--
-- Taken from the live database on 2026-09-22, after the move off Lovable Cloud.
-- Most of this schema was never in a migration: Lovable created the tables outside
-- the repo, so the migrations that follow only ever amended what was already there.
-- Everything up to 20260916120000 is folded into this file; those files are kept in
-- supabase/migrations_archive/ for reference.

--
-- PostgreSQL database dump
--

\restrict GFoao40BK8njfjdUnwAySYws2ih7ofmzbWPS4odvvdxwreepRYg7QxBDhd6GkOL

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- public already exists on a new Supabase project


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: project_phase; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_phase AS ENUM (
    'mint',
    'integration',
    'ms',
    'completed'
);


--
-- Name: project_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_state AS ENUM (
    'not_started',
    'on_hold',
    'in_progress',
    'live',
    'blocked'
);


--
-- Name: responsibility_party; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.responsibility_party AS ENUM (
    'gokwik',
    'merchant',
    'neutral'
);


--
-- Name: team_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.team_role AS ENUM (
    'mint',
    'integration',
    'ms',
    'manager',
    'super_admin',
    'gokwik_general'
);


--
-- Name: schedule_app_job(text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.schedule_app_job(_name text, _schedule text, _job text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'private', 'public', 'cron', 'net'
    AS $_$
DECLARE
  _token text;
BEGIN
  SELECT token INTO _token FROM private.cron_config LIMIT 1;

  PERFORM cron.unschedule(_name) WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = _name
  );

  PERFORM cron.schedule(
    _name,
    _schedule,
    format(
      $cmd$select net.http_post(
        url := 'https://handover-sandbox.lovable.app/api/public/cron?job=%s',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-token','%s'),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );$cmd$,
      _job, _token
    )
  );
END;
$_$;


--
-- Name: _is_platform_super_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._is_platform_super_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin', 'superadmin')
  )
  OR COALESCE(public.get_user_role_home(_user_id)::text, '') IN ('super_admin', 'superadmin')
$$;


--
-- Name: _log_support_access(uuid, uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := COALESCE(auth.uid(), _subject);
  actor_label text;
  subject_label text;
  tenant_label text;
  msg text;
BEGIN
  SELECT name INTO actor_label FROM public.profiles WHERE id = actor;
  SELECT name INTO subject_label FROM public.profiles WHERE id = _subject;
  SELECT name INTO tenant_label FROM public.tenants WHERE id = _tenant_id;

  INSERT INTO public.tenant_access_events
    (grant_id, tenant_id, subject_user_id, subject_name, actor_user_id, actor_name, event, detail)
  VALUES
    (_grant_id, _tenant_id, _subject, subject_label, actor, actor_label, _event, COALESCE(_detail, '{}'::jsonb));

  msg := CASE _event
    WHEN 'granted' THEN format('Granted support access to "%s" for %s as %s until %s — %s',
      COALESCE(tenant_label, 'workspace'), COALESCE(subject_label, 'unknown user'),
      COALESCE(_detail->>'role', 'unknown role'),
      to_char((_detail->>'expires_at')::timestamptz, 'YYYY-MM-DD HH24:MI TZ'),
      COALESCE(_detail->>'reason', ''))
    WHEN 'revoked' THEN format('Revoked support access to "%s" for %s',
      COALESCE(tenant_label, 'workspace'), COALESCE(subject_label, 'unknown user'))
    WHEN 'entered' THEN format('%s entered "%s" under support access',
      COALESCE(subject_label, 'Unknown user'), COALESCE(tenant_label, 'workspace'))
    ELSE format('%s left "%s" (support access ended)',
      COALESCE(subject_label, 'Unknown user'), COALESCE(tenant_label, 'workspace'))
  END;

  BEGIN
    INSERT INTO public.activity_logs
      (tenant_id, user_id, user_name, action_type, category, description, entity_type, entity_id, metadata, status)
    VALUES
      (_tenant_id, actor, COALESCE(actor_label, 'Unknown'), 'user', 'tenant', msg, 'tenant', _tenant_id::text,
       jsonb_build_object('support_access',
         jsonb_build_object('event', _event, 'grant_id', _grant_id, 'subject_user_id', _subject)
         || COALESCE(_detail, '{}'::jsonb)),
       'success');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'Support access activity mirror failed: %', SQLERRM;
  END;
END $$;


--
-- Name: _support_grant_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._support_grant_role(_user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NULLIF(s.role, 'none')
  FROM public.support_session_for(_user_id) s
  WHERE s.applies_role
$$;


--
-- Name: active_support_tenant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.active_support_tenant(_user_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT g.tenant_id
  FROM public.tenant_access_grants g
  JOIN public.profiles p ON p.id = _user_id
  WHERE g.granted_to = _user_id
    AND g.tenant_id = p.active_tenant_id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.expires_at DESC
  LIMIT 1;
$$;


--
-- Name: activity_logs_attribute_support(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activity_logs_attribute_support() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  s_grant uuid;
  s_tenant uuid;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF current_user = 'authenticated' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    SELECT m.grant_id, m.tenant_id INTO s_grant, s_tenant FROM public.my_support_session() m;
    IF s_grant IS NULL THEN
      RETURN NEW;
    END IF;
    NEW.tenant_id := s_tenant;
  ELSIF current_user = 'service_role' THEN
    SELECT f.grant_id, f.tenant_id INTO s_grant, s_tenant FROM public.support_session_for(NEW.user_id) f;
    IF s_grant IS NULL OR NEW.tenant_id IS DISTINCT FROM s_tenant THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  NEW.metadata := COALESCE(NEW.metadata::jsonb, '{}'::jsonb)
    || jsonb_build_object('support_access', jsonb_build_object('grant_id', s_grant, 'tenant_id', s_tenant));
  RETURN NEW;
END $$;


--
-- Name: can_read_checklist_attachment(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_checklist_attachment(objname text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.projects p
    where (
        p.id = public.storage_path_project_id(objname)
        or p.id = (
          select ci.project_id from public.checklist_items ci
          where ci.id::text = split_part(objname, '/', 1)
        )
      )
      and (
        p.tenant_id = public.get_user_tenant_id(auth.uid())
        or public.get_user_role(auth.uid()) in ('super_admin', 'superadmin')
      )
  )
$$;


--
-- Name: can_read_merchant_portal_file(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_merchant_portal_file(objname text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.projects p
    where p.id::text = split_part(objname, '/', 1)
      and (
        p.tenant_id = public.get_user_tenant_id(auth.uid())
        or public.get_user_role(auth.uid()) in ('super_admin', 'superadmin')
      )
  )
$$;


--
-- Name: checklist_items_enqueue_workflow_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checklist_items_enqueue_workflow_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF coalesce(current_setting('app.workflow_run', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.completed, false) AND NOT coalesce(OLD.completed, false) AND NOT coalesce(NEW.is_task, false) THEN
    INSERT INTO public.workflow_events (tenant_id, project_id, event_name, old_row, new_row)
    VALUES (NEW.tenant_id, NEW.project_id, 'checklist_completed', to_jsonb(OLD), to_jsonb(NEW));
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: checklist_items_sync_egl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checklist_items_sync_egl() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_expected_go_live(OLD.project_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_expected_go_live(NEW.project_id);

  IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    PERFORM public.recompute_expected_go_live(OLD.project_id);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: create_tenant(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_tenant(_name text, _slug text, _logo_url text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can create a workspace';
  END IF;
  INSERT INTO public.tenants (name, slug, logo_url)
  VALUES (_name, _slug, NULLIF(_logo_url, ''))
  RETURNING id INTO new_id;
  INSERT INTO public.teams (name, slug, color, is_system, sort_order, tenant_id)
  VALUES
    ('Sales',            'mint',        '#3b82f6', true, 0, new_id),
    ('MINT',             'integration', '#a855f7', true, 1, new_id),
    ('Merchant Success', 'ms',          '#10b981', true, 2, new_id);
  RETURN new_id;
END $$;


--
-- Name: cron_token_matches(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cron_token_matches(_token text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'private', 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM private.cron_config c WHERE c.token = _token)
$$;


--
-- Name: delete_team_cascade(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_team_cascade(_slug text, _team_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _tenant uuid; _super boolean;
BEGIN
  _tenant := public.get_user_tenant_id(auth.uid());
  _super  := public.is_super_admin(auth.uid());
  IF _tenant IS NULL AND NOT _super THEN RAISE EXCEPTION 'Not permitted'; END IF;

  DELETE FROM public.checklist_comments WHERE checklist_item_id IN (
    SELECT id FROM public.checklist_items WHERE owner_team=_slug AND (_super OR tenant_id=_tenant));
  DELETE FROM public.checklist_responsibility_logs WHERE checklist_item_id IN (
    SELECT id FROM public.checklist_items WHERE owner_team=_slug AND (_super OR tenant_id=_tenant));
  DELETE FROM public.checklist_tasks WHERE checklist_item_id IN (
    SELECT id FROM public.checklist_items WHERE owner_team=_slug AND (_super OR tenant_id=_tenant));
  DELETE FROM public.checklist_form_responses WHERE checklist_item_id IN (
    SELECT id FROM public.checklist_items WHERE owner_team=_slug AND (_super OR tenant_id=_tenant));
  DELETE FROM public.checklist_items WHERE owner_team=_slug AND (_super OR tenant_id=_tenant);

  DELETE FROM public.checklist_form_assignments WHERE checklist_template_id IN (
    SELECT id FROM public.checklist_templates WHERE owner_team=_slug AND (_super OR tenant_id=_tenant));
  DELETE FROM public.checklist_templates WHERE owner_team=_slug AND (_super OR tenant_id=_tenant);

  DELETE FROM public.teams WHERE id=_team_id AND (_super OR tenant_id=_tenant);
END; $$;


--
-- Name: get_user_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role(_user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT CASE WHEN r IS NULL THEN public.get_user_role_home(_user_id) ELSE r::text END FROM public._support_grant_role(_user_id) AS r $$;


--
-- Name: get_user_role_home(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role_home(_user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;


--
-- Name: get_user_tenant_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_tenant_id(_user_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, team, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'team', 'mint'),
    (NEW.raw_user_meta_data->>'tenant_id')::uuid
  );
  
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'team', 'mint'),
    (NEW.raw_user_meta_data->>'tenant_id')::uuid
  );
  
  RETURN NEW;
END;
$$;


--
-- Name: is_gokwik_general(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_gokwik_general(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT CASE WHEN r IS NULL THEN public.is_gokwik_general_home(_user_id) ELSE r = 'gokwik_general' END FROM public._support_grant_role(_user_id) AS r $$;


--
-- Name: is_gokwik_general_home(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_gokwik_general_home(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'gokwik_general'
  )
$$;


--
-- Name: is_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_manager(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT CASE WHEN r IS NULL THEN public.is_manager_home(_user_id) ELSE r IN ('manager', 'admin') END FROM public._support_grant_role(_user_id) AS r $$;


--
-- Name: is_manager_home(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_manager_home(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('manager', 'admin')
  )
$$;


--
-- Name: is_super_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;


--
-- Name: is_tenant_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_tenant_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT CASE WHEN r IS NULL THEN public.is_tenant_admin_home(_user_id) ELSE r = 'admin' END FROM public._support_grant_role(_user_id) AS r $$;


--
-- Name: is_tenant_admin_home(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_tenant_admin_home(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  )
$$;


--
-- Name: my_support_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_support_session() RETURNS TABLE(grant_id uuid, tenant_id uuid, role text, expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.grant_id, s.tenant_id,
         CASE WHEN s.applies_role THEN NULLIF(s.role, 'none') END,
         s.expires_at
  FROM public.support_session_for(auth.uid()) s
$$;


--
-- Name: profiles_guard_support_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_guard_support_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can move an account to another workspace';
  END IF;

  IF NEW.active_tenant_id IS DISTINCT FROM OLD.active_tenant_id THEN
    IF NEW.id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'You can only open or close your own support session';
    END IF;
    IF NEW.active_tenant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tenant_access_grants g
      WHERE g.granted_to = auth.uid()
        AND g.tenant_id = NEW.active_tenant_id
        AND g.revoked_at IS NULL
        AND g.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'There is no live support access grant for that workspace';
    END IF;
  END IF;

  RETURN NEW;
END $$;


--
-- Name: profiles_guard_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_guard_tenant_id() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'tenant_id cannot be changed by this user';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: profiles_log_support_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_log_support_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g_id uuid;
BEGIN
  IF NEW.active_tenant_id IS NOT DISTINCT FROM OLD.active_tenant_id THEN
    RETURN NULL;
  END IF;

  IF OLD.active_tenant_id IS NOT NULL THEN
    SELECT id INTO g_id FROM public.tenant_access_grants
    WHERE granted_to = NEW.id AND tenant_id = OLD.active_tenant_id
    ORDER BY created_at DESC LIMIT 1;
    PERFORM public._log_support_access(g_id, OLD.active_tenant_id, NEW.id, 'left',
      jsonb_build_object('ended_by', CASE WHEN auth.uid() = NEW.id THEN 'self' ELSE 'revocation' END));
  END IF;

  IF NEW.active_tenant_id IS NOT NULL THEN
    SELECT id INTO g_id FROM public.tenant_access_grants
    WHERE granted_to = NEW.id AND tenant_id = NEW.active_tenant_id
      AND revoked_at IS NULL AND expires_at > now()
    ORDER BY expires_at DESC LIMIT 1;
    PERFORM public._log_support_access(g_id, NEW.active_tenant_id, NEW.id, 'entered', '{}'::jsonb);
  END IF;

  RETURN NULL;
END $$;


--
-- Name: project_last_activity(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_last_activity(_tenant_id uuid) RETURNS TABLE(project_id uuid, last_comment_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT ci.project_id, max(cc.created_at) AS last_comment_at
  FROM public.checklist_comments cc
  JOIN public.checklist_items ci ON ci.id = cc.checklist_item_id
  WHERE ci.tenant_id = _tenant_id
  GROUP BY ci.project_id;
$$;


--
-- Name: projects_enqueue_workflow_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.projects_enqueue_workflow_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _event text;
BEGIN
  -- A workflow's own writes must not enqueue more work, or an update_field
  -- action feeding a field_change rule would recurse.
  IF coalesce(current_setting('app.workflow_run', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _event := 'project_created';
  ELSIF NEW.current_owner_team IS DISTINCT FROM OLD.current_owner_team THEN
    _event := 'project_transferred';
  ELSIF NEW.project_state IS DISTINCT FROM OLD.project_state THEN
    _event := 'project_state_changed';
  ELSIF NEW.go_live_date IS DISTINCT FROM OLD.go_live_date
     OR NEW.assigned_owner IS DISTINCT FROM OLD.assigned_owner
     OR NEW.current_phase IS DISTINCT FROM OLD.current_phase
     OR NEW.expected_go_live_date IS DISTINCT FROM OLD.expected_go_live_date
     OR NEW.go_live_percent IS DISTINCT FROM OLD.go_live_percent
     OR NEW.integration_type IS DISTINCT FROM OLD.integration_type
     OR NEW.pg_onboarding IS DISTINCT FROM OLD.pg_onboarding THEN
    _event := 'project_updated';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.workflow_events (tenant_id, project_id, event_name, old_row, new_row)
  VALUES (NEW.tenant_id, NEW.id, _event,
          CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          to_jsonb(NEW));
  RETURN NEW;
END; $$;


--
-- Name: projects_mark_manual_egl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.projects_mark_manual_egl() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.expected_go_live_is_manual := NEW.expected_go_live_date IS NOT NULL;
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('app.egl_auto', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.expected_go_live_date IS DISTINCT FROM OLD.expected_go_live_date THEN
    NEW.expected_go_live_is_manual := NEW.expected_go_live_date IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: projects_refill_auto_egl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.projects_refill_auto_egl() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.expected_go_live_is_manual = false AND NEW.expected_go_live_date IS NULL THEN
    PERFORM public.recompute_expected_go_live(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: recompute_expected_go_live(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_expected_go_live(_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  latest date;
BEGIN
  SELECT max(ci.due_date) INTO latest
  FROM public.checklist_items ci
  WHERE ci.project_id = _project_id
    AND coalesce(ci.is_task, false) = false
    AND ci.due_date IS NOT NULL;

  -- Marks the write as automatic so the manual-detection trigger ignores it.
  PERFORM set_config('app.egl_auto', 'on', true);

  UPDATE public.projects p
  SET expected_go_live_date = latest
  WHERE p.id = _project_id
    AND p.expected_go_live_is_manual = false
    AND p.expected_go_live_date IS DISTINCT FROM latest;

  PERFORM set_config('app.egl_auto', 'off', true);
END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.role() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'auth'
    AS $$ SELECT auth.role() $$;


--
-- Name: seed_project_checklist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_project_checklist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.checklist_items ci WHERE ci.project_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.checklist_items (
    project_id, title, completed, phase, owner_team,
    current_responsibility, sort_order, tenant_id, due_date
  )
  SELECT
    NEW.id, t.title, false,
    -- A template owned by a custom team has no valid phase. Fall back rather
    -- than fail: this runs on project insert, so one bad row here blocked
    -- creating any project at all.
    (CASE WHEN t.phase IN ('mint','integration','ms','completed')
          THEN t.phase ELSE 'integration' END)::project_phase,
    t.owner_team,
    'neutral'::responsibility_party,
    COALESCE(t.sort_order, 0), NEW.tenant_id,
    CASE WHEN t.standard_duration IS NOT NULL AND t.standard_duration > 0
         THEN (NEW.kick_off_date + (t.standard_duration || ' days')::interval)::date
         ELSE NULL END
  FROM public.checklist_templates t
  WHERE t.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
  ORDER BY t.sort_order;

  RETURN NEW;
END;
$$;


--
-- Name: storage_path_project_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.storage_path_project_id(objname text) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select case
    when objname like 'projects/%' then nullif(split_part(objname, '/', 2), '')::uuid
    else null
  end
$$;


--
-- Name: support_session_for(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_session_for(_user_id uuid) RETURNS TABLE(grant_id uuid, tenant_id uuid, home_tenant_id uuid, role text, applies_role boolean, expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT g.id, g.tenant_id, p.tenant_id, g.role,
         NOT public._is_platform_super_admin(_user_id), g.expires_at
  FROM public.tenant_access_grants g
  JOIN public.profiles p ON p.id = _user_id
  WHERE g.granted_to = _user_id
    AND g.tenant_id = p.active_tenant_id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.expires_at DESC
  LIMIT 1
$$;


--
-- Name: tenant_access_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_access_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Support access events are a permanent record';
END $$;


--
-- Name: tenant_access_grants_after_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_access_grants_after_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._log_support_access(NEW.id, NEW.tenant_id, NEW.granted_to, 'granted',
      jsonb_build_object('role', NEW.role, 'reason', NEW.reason, 'expires_at', NEW.expires_at));
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM public._log_support_access(NEW.id, NEW.tenant_id, NEW.granted_to, 'revoked',
      jsonb_build_object('role', NEW.role));

    UPDATE public.profiles p
    SET active_tenant_id = NULL
    WHERE p.id = NEW.granted_to
      AND p.active_tenant_id = NEW.tenant_id
      AND NOT EXISTS (
        SELECT 1 FROM public.tenant_access_grants g
        WHERE g.granted_to = NEW.granted_to
          AND g.tenant_id = NEW.tenant_id
          AND g.revoked_at IS NULL
          AND g.expires_at > now()
      );
  END IF;
  RETURN NULL;
END $$;


--
-- Name: tenant_access_grants_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_access_grants_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  granter uuid := COALESCE(auth.uid(), NEW.granted_by);
  granter_tenant uuid;
  grantee_tenant uuid;
BEGIN
  IF granter IS NULL THEN
    RAISE EXCEPTION 'An access grant must record who opened it';
  END IF;

  NEW.granted_by := granter;
  NEW.granted_by_name := COALESCE((SELECT name FROM public.profiles WHERE id = granter), NEW.granted_by_name);
  NEW.created_at := now();
  NEW.revoked_at := NULL;

  NEW.reason := NULLIF(btrim(COALESCE(NEW.reason, '')), '');
  IF NEW.reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for support access';
  END IF;

  NEW.role := COALESCE(NULLIF(btrim(NEW.role), ''), 'manager');
  IF NEW.role NOT IN ('manager', 'admin', 'gokwik_general') THEN
    RAISE EXCEPTION 'Support access can grant Manager, Admin or General, not %', NEW.role;
  END IF;

  IF NEW.expires_at IS NULL OR NEW.expires_at <= now() THEN
    RAISE EXCEPTION 'Support access must expire in the future';
  END IF;
  IF NEW.expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION 'Support access can last at most 30 days';
  END IF;

  SELECT tenant_id INTO grantee_tenant FROM public.profiles WHERE id = NEW.granted_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The person receiving access has no account';
  END IF;

  IF grantee_tenant = NEW.tenant_id THEN
    RAISE EXCEPTION 'That person already belongs to this workspace; change their role under Users instead';
  END IF;

  SELECT tenant_id INTO granter_tenant FROM public.profiles WHERE id = granter;
  IF NEW.granted_to <> granter
     AND grantee_tenant IS DISTINCT FROM granter_tenant
     AND NOT public._is_platform_super_admin(NEW.granted_to) THEN
    RAISE EXCEPTION 'Support access can only be given to members of your own workspace';
  END IF;

  RETURN NEW;
END $$;


--
-- Name: tenant_access_grants_before_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_access_grants_before_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.granted_to, NEW.granted_by, NEW.granted_by_name,
      NEW.reason, NEW.expires_at, NEW.role, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.granted_to, OLD.granted_by, OLD.granted_by_name,
      OLD.reason, OLD.expires_at, OLD.role, OLD.created_at) THEN
    RAISE EXCEPTION 'Access grants cannot be edited. Revoke this one and open a new grant.';
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'This grant is already revoked';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END $$;


--
-- Name: tenant_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_stats() RETURNS TABLE(tenant_id uuid, user_count bigint, project_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can list workspace statistics';
  END IF;
  RETURN QUERY
  SELECT t.id,
         (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = t.id),
         (SELECT count(*) FROM public.projects pr WHERE pr.tenant_id = t.id)
  FROM public.tenants t;
END $$;


--
-- Name: uid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uid() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'auth'
    AS $$ SELECT auth.uid() $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: workflow_transfer_project(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _from_team text; _tenant uuid; _owner uuid;
BEGIN
  SELECT current_owner_team, tenant_id, assigned_owner
    INTO _from_team, _tenant, _owner
  FROM public.projects WHERE id = _project_id;
  IF _from_team IS NULL OR _from_team = _to_team THEN RETURN; END IF;

  PERFORM set_config('app.workflow_run', 'on', true);
  UPDATE public.projects
     SET current_owner_team = _to_team, pending_acceptance = true, updated_at = now()
   WHERE id = _project_id;
  INSERT INTO public.transfer_history
    (project_id, tenant_id, from_team, to_team, transferred_by, notes)
  VALUES (_project_id, _tenant, _from_team, _to_team, _owner, 'Transferred by workflow');
  PERFORM set_config('app.workflow_run', 'off', true);
END; $$;


--
-- Name: workflow_update_project(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM set_config('app.workflow_run', 'on', true);

  UPDATE public.projects p SET
    assigned_owner        = COALESCE((_patch->>'assigned_owner')::uuid, p.assigned_owner),
    project_state         = COALESCE((_patch->>'project_state')::project_state, p.project_state),
    current_phase         = COALESCE((_patch->>'current_phase')::project_phase, p.current_phase),
    current_owner_team    = COALESCE(_patch->>'current_owner_team', p.current_owner_team),
    expected_go_live_date = COALESCE((_patch->>'expected_go_live_date')::date, p.expected_go_live_date),
    go_live_percent       = COALESCE((_patch->>'go_live_percent')::int, p.go_live_percent),
    integration_type      = COALESCE(_patch->>'integration_type', p.integration_type),
    pg_onboarding         = COALESCE(_patch->>'pg_onboarding', p.pg_onboarding),
    updated_at            = now()
  WHERE p.id = _project_id;

  PERFORM set_config('app.workflow_run', 'off', true);
END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cron_config; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.cron_config (
    id boolean DEFAULT true NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cron_config_id_check CHECK (id)
);


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    user_id uuid,
    user_name text,
    action_type text DEFAULT 'system'::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    description text NOT NULL,
    entity_type text,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'success'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    description text,
    trigger_type text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_type text NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_by_name text,
    last_triggered_at timestamp with time zone,
    trigger_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    created_by uuid,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


--
-- Name: brd_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brd_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    field_id uuid NOT NULL,
    value text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: brd_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brd_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    project_id uuid NOT NULL,
    form_template_id uuid NOT NULL,
    merchant_email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    csv_url text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid,
    conversation_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: checklist_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checklist_item_id uuid NOT NULL,
    user_name text NOT NULL,
    user_id uuid,
    comment text NOT NULL,
    attachment_url text,
    attachment_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


--
-- Name: COLUMN checklist_comments.user_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.checklist_comments.user_name IS 'Display name of the author. Non-human authors (e.g. "Meeting AI") leave user_id null.';


--
-- Name: checklist_form_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_form_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checklist_template_id uuid NOT NULL,
    form_template_id uuid NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checklist_form_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    question text NOT NULL,
    field_type text DEFAULT 'text'::text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb,
    is_required boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checklist_form_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_form_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    checklist_item_id uuid NOT NULL,
    form_template_id uuid NOT NULL,
    field_id uuid NOT NULL,
    value text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checklist_form_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_form_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    completed boolean DEFAULT false,
    completed_by text,
    completed_at timestamp with time zone,
    phase text NOT NULL,
    owner_team text NOT NULL,
    current_responsibility public.responsibility_party DEFAULT 'neutral'::public.responsibility_party,
    comment text,
    comment_by text,
    comment_at timestamp with time zone,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id uuid,
    is_task boolean DEFAULT false NOT NULL,
    due_date date
);


--
-- Name: checklist_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    project_id uuid NOT NULL,
    checklist_item_id uuid NOT NULL,
    title text NOT NULL,
    agenda text,
    provider text NOT NULL,
    join_url text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    invite_sent_at timestamp with time zone,
    provider_meeting_id text,
    transcript text,
    transcript_source text,
    transcript_received_at timestamp with time zone,
    analysis_status text DEFAULT 'pending'::text NOT NULL,
    analysis_error text,
    analysed_at timestamp with time zone,
    mom_comment_id uuid,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checklist_meetings_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text]))),
    CONSTRAINT checklist_meetings_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 600))),
    CONSTRAINT checklist_meetings_provider_check CHECK ((provider = ANY (ARRAY['google_meet'::text, 'zoom'::text, 'teams'::text]))),
    CONSTRAINT checklist_meetings_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT checklist_meetings_transcript_source_check CHECK (((transcript_source IS NULL) OR (transcript_source = ANY (ARRAY['zoom'::text, 'google_meet'::text, 'teams'::text, 'manual'::text, 'api'::text]))))
);


--
-- Name: checklist_responsibility_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_responsibility_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checklist_item_id uuid NOT NULL,
    party public.responsibility_party NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id uuid
);


--
-- Name: checklist_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checklist_item_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    assigned_to uuid,
    due_date date,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    owner_team text NOT NULL,
    phase text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    standard_duration integer
);


--
-- Name: custom_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    field_id uuid NOT NULL,
    value text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    field_key text NOT NULL,
    field_label text NOT NULL,
    field_type text DEFAULT 'text'::text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_portal_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_portal_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    last_accessed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_portal_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_portal_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    upload_type text NOT NULL,
    file_name text NOT NULL,
    file_url text NOT NULL,
    uploaded_by text DEFAULT 'merchant'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_portal_uploads_upload_type_check CHECK ((upload_type = ANY (ARRAY['postman_collection'::text, 'api_screenshot'::text])))
);


--
-- Name: merchant_portal_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_portal_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    email text NOT NULL,
    page text NOT NULL,
    session_id text,
    user_agent text,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: movement_report_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movement_report_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid,
    tenant_id uuid NOT NULL,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    email_count integer DEFAULT 0,
    error_message text,
    completed_at timestamp with time zone
);


--
-- Name: movement_report_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movement_report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    timeframe text NOT NULL,
    days text[] DEFAULT ARRAY['Mon'::text, 'Tue'::text, 'Wed'::text, 'Thu'::text, 'Fri'::text] NOT NULL,
    time_ist text DEFAULT '09:00'::text NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    subject_prefix text,
    enabled boolean DEFAULT true NOT NULL,
    last_sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT movement_report_schedules_timeframe_check CHECK ((timeframe = ANY (ARRAY['daily'::text, 'weekly'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    actor_name text,
    project_id uuid,
    project_name text,
    checklist_item_id uuid,
    checklist_item_title text,
    task_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    comment_id uuid
);


--
-- Name: parsed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parsed_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    gmail_message_id text NOT NULL,
    subject text NOT NULL,
    sender text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    brand_name text,
    brand_url text,
    platform text,
    sub_platform text,
    arr numeric,
    category text,
    txns_per_day integer,
    aov numeric,
    merchant_size text,
    city text,
    sales_notes text,
    parsed_fields jsonb DEFAULT '{}'::jsonb,
    raw_html text,
    status text DEFAULT 'new'::text NOT NULL,
    project_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parsed_emails_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewed'::text, 'project_created'::text, 'dismissed'::text])))
);


--
-- Name: platform_merchants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_merchants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    platform text NOT NULL,
    merchant_name text NOT NULL,
    status text DEFAULT 'inprogress'::text NOT NULL,
    arr numeric,
    go_live_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid,
    csm_id uuid,
    brand_poc_name text,
    brand_poc_emails text[] DEFAULT '{}'::text[] NOT NULL,
    platform_poc_emails text[] DEFAULT '{}'::text[] NOT NULL,
    welcome_email_sent_at timestamp with time zone,
    login_email text,
    temp_password text,
    gmail_message_id text,
    gmail_thread_id text,
    mid text,
    website text,
    merchant_phone text,
    platform_poc_name text,
    auto_created boolean DEFAULT false NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    team text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tenant_id uuid,
    last_login timestamp with time zone,
    active_tenant_id uuid
);


--
-- Name: project_ai_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_ai_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    month text NOT NULL,
    blocker text,
    blocked_on text,
    deadline text,
    confidence text,
    pg_creds text,
    db_walkthrough text,
    csm_alignment text,
    manual_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_comment_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_comment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    author_name text NOT NULL,
    author_type text DEFAULT 'user'::text NOT NULL,
    field_name text NOT NULL,
    content text NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_credentials (
    project_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    sandbox_app_secret text,
    sandbox_kwikpass_jwe_key text,
    prod_app_secret text,
    prod_kwikpass_jwe_key text,
    kp_prod_jwe_key text,
    kp_sandbox_jwe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_email_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_email_context (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    summary text,
    test_cases jsonb DEFAULT '[]'::jsonb,
    checklist_context text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_count integer DEFAULT 0,
    action_items jsonb DEFAULT '[]'::jsonb
);


--
-- Name: project_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    gmail_thread_id text NOT NULL,
    gmail_message_id text NOT NULL,
    subject text NOT NULL,
    snippet text,
    participants text[] DEFAULT '{}'::text[],
    thread_date timestamp with time zone NOT NULL,
    message_count integer DEFAULT 1,
    raw_headers jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb,
    bodies_fetched_at timestamp with time zone
);


--
-- Name: project_jira_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_jira_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    jira_key text NOT NULL,
    summary text,
    status text,
    status_category text,
    priority text,
    issue_type text,
    resolution text,
    assignee_name text,
    assignee_email text,
    assignee_avatar text,
    reporter_name text,
    reporter_email text,
    reporter_avatar text,
    creator_name text,
    creator_email text,
    project_key text,
    project_name text,
    created timestamp with time zone,
    updated timestamp with time zone,
    due_date timestamp with time zone,
    resolved_at timestamp with time zone,
    labels text[] DEFAULT '{}'::text[],
    components text[] DEFAULT '{}'::text[],
    fix_versions text[] DEFAULT '{}'::text[],
    affects_versions text[] DEFAULT '{}'::text[],
    description text,
    environment text,
    story_points numeric,
    sprint text,
    epic_key text,
    epic_name text,
    parent_key text,
    subtask_count integer DEFAULT 0,
    comment_count integer DEFAULT 0,
    attachment_count integer DEFAULT 0,
    watchers_count integer DEFAULT 0,
    votes integer DEFAULT 0,
    url text,
    raw jsonb DEFAULT '{}'::jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_responsibility_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_responsibility_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    party public.responsibility_party NOT NULL,
    phase public.project_phase NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id uuid
);


--
-- Name: project_risk_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_risk_insights (
    project_id uuid NOT NULL,
    tenant_id uuid,
    findings_hash text NOT NULL,
    why text NOT NULL,
    recommendation text NOT NULL,
    model text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'risk'::text NOT NULL
);


--
-- Name: project_risks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_risks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid,
    title text NOT NULL,
    description text,
    category text DEFAULT 'merchant_dependency'::text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    trigger_rule text,
    mitigation_plan text,
    mitigation_due_at timestamp with time zone,
    assigned_to uuid,
    escalated boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_name text NOT NULL,
    mid text NOT NULL,
    platform text DEFAULT 'Custom'::text,
    arr numeric(10,2) DEFAULT 0,
    txns_per_day integer DEFAULT 0,
    aov numeric(10,2) DEFAULT 0,
    category text,
    current_phase public.project_phase DEFAULT 'mint'::public.project_phase,
    current_owner_team text DEFAULT 'mint'::public.team_role,
    pending_acceptance boolean DEFAULT false,
    go_live_percent integer DEFAULT 0,
    brand_url text,
    jira_link text,
    brd_link text,
    mint_checklist_link text,
    integration_checklist_link text,
    kick_off_date date NOT NULL,
    go_live_date date,
    expected_go_live_date date,
    mint_notes text,
    project_notes text,
    current_phase_comment text,
    phase2_comment text,
    sales_spoc text,
    integration_type text DEFAULT 'Standard'::text,
    pg_onboarding text,
    current_responsibility public.responsibility_party DEFAULT 'neutral'::public.responsibility_party,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    assigned_owner uuid,
    project_state public.project_state DEFAULT 'not_started'::public.project_state,
    tenant_id uuid,
    archived boolean DEFAULT false,
    archived_at timestamp with time zone,
    contact_email text,
    sow_link text,
    config_id text,
    sandbox_mid text,
    sandbox_app_id text,
    sandbox_base_url text,
    sandbox_config_id text,
    prod_mid text,
    prod_app_id text,
    prod_base_url text,
    prod_config_id text,
    mcp_config_id text,
    enable_mcp_document boolean DEFAULT false NOT NULL,
    enable_kp boolean DEFAULT false NOT NULL,
    mandatory_apis text[] DEFAULT ARRAY['Get Cart'::text, 'Set Shipping Address'::text, 'Set Shipping Option'::text, 'Create Order'::text, 'Place Order'::text, 'Update Order'::text, 'Split Order'::text, 'Check Order Status'::text] NOT NULL,
    faq_help jsonb DEFAULT '[]'::jsonb NOT NULL,
    payment_simulator_link text,
    tracker_month text,
    external_id text,
    expected_go_live_is_manual boolean DEFAULT false NOT NULL
);


--
-- Name: report_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    tenant_id uuid,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    recipients text[] DEFAULT '{}'::text[],
    error_message text,
    email_count integer DEFAULT 0,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    columns text[] DEFAULT '{}'::text[] NOT NULL,
    schedule text,
    recipients text[] DEFAULT '{}'::text[],
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shopify_lt_thread_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopify_lt_thread_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    thread_id text NOT NULL,
    status text,
    subject text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_summary text,
    ai_summary_at timestamp with time zone,
    ai_status text,
    ai_confidence text,
    ai_evidence text,
    ai_merchant_name text
);


--
-- Name: shopify_sme_merchants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopify_sme_merchants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    gmail_message_id text NOT NULL,
    subject text NOT NULL,
    sender text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    brand_name text,
    merchant_poc_name text,
    merchant_email text,
    merchant_contact text,
    shopify_url text,
    website_url text,
    platform text,
    sub_platform text,
    expected_arr numeric,
    category text,
    txns_per_day integer,
    aov numeric,
    merchant_size text,
    city text,
    rto_refund_amount numeric,
    rto_coverage_pct numeric,
    mg_sheet_link text,
    commercials jsonb DEFAULT '{}'::jsonb,
    notes text,
    merchant_id_ext text,
    merchant_id_text text,
    parsed_fields jsonb DEFAULT '{}'::jsonb,
    raw_html text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_owner_email text,
    gmail_thread_id text,
    CONSTRAINT shopify_sme_merchants_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewed'::text, 'dismissed'::text])))
);


--
-- Name: signup_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signup_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    job_title text,
    company_name text,
    phone text,
    country text,
    city text,
    user_agent text,
    synced_at timestamp with time zone,
    sync_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tat_report_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tat_report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    granularity text DEFAULT 'monthly'::text NOT NULL,
    days text[] DEFAULT ARRAY['Mon'::text] NOT NULL,
    time_ist text DEFAULT '09:00'::text NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    subject_prefix text,
    enabled boolean DEFAULT true NOT NULL,
    last_sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tat_report_schedules_granularity_check CHECK ((granularity = ANY (ARRAY['monthly'::text, 'quarterly'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text DEFAULT '#3b82f6'::text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_access_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_access_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grant_id uuid,
    tenant_id uuid NOT NULL,
    subject_user_id uuid NOT NULL,
    subject_name text,
    actor_user_id uuid,
    actor_name text,
    event text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_access_events_event_check CHECK ((event = ANY (ARRAY['granted'::text, 'revoked'::text, 'entered'::text, 'left'::text])))
);


--
-- Name: tenant_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    granted_to uuid NOT NULL,
    granted_by uuid NOT NULL,
    granted_by_name text,
    reason text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'manager'::text NOT NULL
);


--
-- Name: tenant_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    resend_api_key text,
    from_email text,
    from_name text,
    reply_to text,
    google_mail_api_key text,
    gmail_monitor_address text,
    jira_base_url text,
    jira_email text,
    jira_api_token text,
    slack_webhook_url text,
    slack_bot_token text,
    slack_channel text,
    app_base_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    jira_project_key text,
    zoom_account_id text,
    zoom_client_id text,
    zoom_client_secret text,
    zoom_webhook_secret text,
    teams_tenant_id text,
    teams_client_id text,
    teams_client_secret text,
    google_meet_refresh_token text,
    google_oauth_client_id text,
    google_oauth_client_secret text,
    zoom_user_id text,
    teams_organizer_user_id text,
    google_calendar_refresh_token text
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transfer_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    from_team text NOT NULL,
    to_team text NOT NULL,
    transferred_by text NOT NULL,
    accepted_by text,
    transferred_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id uuid
);


--
-- Name: workflow_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    project_id uuid NOT NULL,
    event_name text NOT NULL,
    old_row jsonb,
    new_row jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error text
);


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    tenant_id uuid,
    project_id uuid,
    event_id uuid,
    status text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cron_config cron_config_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.cron_config
    ADD CONSTRAINT cron_config_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_workflows ai_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_workflows
    ADD CONSTRAINT ai_workflows_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_key_tenant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_tenant_unique UNIQUE (key, tenant_id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: brd_responses brd_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_responses
    ADD CONSTRAINT brd_responses_pkey PRIMARY KEY (id);


--
-- Name: brd_responses brd_responses_session_id_field_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_responses
    ADD CONSTRAINT brd_responses_session_id_field_id_key UNIQUE (session_id, field_id);


--
-- Name: brd_sessions brd_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_sessions
    ADD CONSTRAINT brd_sessions_pkey PRIMARY KEY (id);


--
-- Name: brd_sessions brd_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_sessions
    ADD CONSTRAINT brd_sessions_token_key UNIQUE (token);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: checklist_comments checklist_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_comments
    ADD CONSTRAINT checklist_comments_pkey PRIMARY KEY (id);


--
-- Name: checklist_form_assignments checklist_form_assignments_checklist_template_id_form_templ_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_assignments
    ADD CONSTRAINT checklist_form_assignments_checklist_template_id_form_templ_key UNIQUE (checklist_template_id, form_template_id);


--
-- Name: checklist_form_assignments checklist_form_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_assignments
    ADD CONSTRAINT checklist_form_assignments_pkey PRIMARY KEY (id);


--
-- Name: checklist_form_fields checklist_form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_fields
    ADD CONSTRAINT checklist_form_fields_pkey PRIMARY KEY (id);


--
-- Name: checklist_form_responses checklist_form_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_pkey PRIMARY KEY (id);


--
-- Name: checklist_form_responses checklist_form_responses_project_id_checklist_item_id_field_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_project_id_checklist_item_id_field_key UNIQUE (project_id, checklist_item_id, field_id);


--
-- Name: checklist_form_templates checklist_form_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_templates
    ADD CONSTRAINT checklist_form_templates_pkey PRIMARY KEY (id);


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_pkey PRIMARY KEY (id);


--
-- Name: checklist_meetings checklist_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_meetings
    ADD CONSTRAINT checklist_meetings_pkey PRIMARY KEY (id);


--
-- Name: checklist_responsibility_logs checklist_responsibility_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_responsibility_logs
    ADD CONSTRAINT checklist_responsibility_logs_pkey PRIMARY KEY (id);


--
-- Name: checklist_tasks checklist_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_tasks
    ADD CONSTRAINT checklist_tasks_pkey PRIMARY KEY (id);


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: checklist_templates checklist_templates_title_owner_team_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_title_owner_team_tenant_id_key UNIQUE (title, owner_team, tenant_id);


--
-- Name: custom_field_values custom_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_pkey PRIMARY KEY (id);


--
-- Name: custom_field_values custom_field_values_project_id_field_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_project_id_field_id_key UNIQUE (project_id, field_id);


--
-- Name: custom_fields custom_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_pkey PRIMARY KEY (id);


--
-- Name: custom_fields custom_fields_tenant_id_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_tenant_id_field_key_key UNIQUE (tenant_id, field_key);


--
-- Name: merchant_portal_tokens merchant_portal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_portal_tokens
    ADD CONSTRAINT merchant_portal_tokens_pkey PRIMARY KEY (id);


--
-- Name: merchant_portal_tokens merchant_portal_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_portal_tokens
    ADD CONSTRAINT merchant_portal_tokens_token_key UNIQUE (token);


--
-- Name: merchant_portal_uploads merchant_portal_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_portal_uploads
    ADD CONSTRAINT merchant_portal_uploads_pkey PRIMARY KEY (id);


--
-- Name: merchant_portal_visits merchant_portal_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_portal_visits
    ADD CONSTRAINT merchant_portal_visits_pkey PRIMARY KEY (id);


--
-- Name: movement_report_executions movement_report_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movement_report_executions
    ADD CONSTRAINT movement_report_executions_pkey PRIMARY KEY (id);


--
-- Name: movement_report_schedules movement_report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movement_report_schedules
    ADD CONSTRAINT movement_report_schedules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: parsed_emails parsed_emails_gmail_message_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parsed_emails
    ADD CONSTRAINT parsed_emails_gmail_message_id_tenant_id_key UNIQUE (gmail_message_id, tenant_id);


--
-- Name: parsed_emails parsed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parsed_emails
    ADD CONSTRAINT parsed_emails_pkey PRIMARY KEY (id);


--
-- Name: platform_merchants platform_merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_merchants
    ADD CONSTRAINT platform_merchants_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: project_ai_insights project_ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_ai_insights
    ADD CONSTRAINT project_ai_insights_pkey PRIMARY KEY (id);


--
-- Name: project_ai_insights project_ai_insights_project_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_ai_insights
    ADD CONSTRAINT project_ai_insights_project_id_month_key UNIQUE (project_id, month);


--
-- Name: project_comment_logs project_comment_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comment_logs
    ADD CONSTRAINT project_comment_logs_pkey PRIMARY KEY (id);


--
-- Name: project_credentials project_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_credentials
    ADD CONSTRAINT project_credentials_pkey PRIMARY KEY (project_id);


--
-- Name: project_email_context project_email_context_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_email_context
    ADD CONSTRAINT project_email_context_pkey PRIMARY KEY (id);


--
-- Name: project_email_context project_email_context_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_email_context
    ADD CONSTRAINT project_email_context_project_id_key UNIQUE (project_id);


--
-- Name: project_emails project_emails_gmail_thread_id_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_emails
    ADD CONSTRAINT project_emails_gmail_thread_id_project_id_key UNIQUE (gmail_thread_id, project_id);


--
-- Name: project_emails project_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_emails
    ADD CONSTRAINT project_emails_pkey PRIMARY KEY (id);


--
-- Name: project_jira_tickets project_jira_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jira_tickets
    ADD CONSTRAINT project_jira_tickets_pkey PRIMARY KEY (id);


--
-- Name: project_jira_tickets project_jira_tickets_project_id_jira_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jira_tickets
    ADD CONSTRAINT project_jira_tickets_project_id_jira_key_key UNIQUE (project_id, jira_key);


--
-- Name: project_responsibility_logs project_responsibility_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_responsibility_logs
    ADD CONSTRAINT project_responsibility_logs_pkey PRIMARY KEY (id);


--
-- Name: project_risk_insights project_risk_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_risk_insights
    ADD CONSTRAINT project_risk_insights_pkey PRIMARY KEY (project_id, kind);


--
-- Name: project_risks project_risks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_risks
    ADD CONSTRAINT project_risks_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: report_executions report_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_pkey PRIMARY KEY (id);


--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);


--
-- Name: shopify_lt_thread_status shopify_lt_thread_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_lt_thread_status
    ADD CONSTRAINT shopify_lt_thread_status_pkey PRIMARY KEY (id);


--
-- Name: shopify_lt_thread_status shopify_lt_thread_status_tenant_id_thread_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_lt_thread_status
    ADD CONSTRAINT shopify_lt_thread_status_tenant_id_thread_id_key UNIQUE (tenant_id, thread_id);


--
-- Name: shopify_sme_merchants shopify_sme_merchants_gmail_message_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_sme_merchants
    ADD CONSTRAINT shopify_sme_merchants_gmail_message_id_tenant_id_key UNIQUE (gmail_message_id, tenant_id);


--
-- Name: shopify_sme_merchants shopify_sme_merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_sme_merchants
    ADD CONSTRAINT shopify_sme_merchants_pkey PRIMARY KEY (id);


--
-- Name: signup_leads signup_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_leads
    ADD CONSTRAINT signup_leads_pkey PRIMARY KEY (id);


--
-- Name: tat_report_schedules tat_report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tat_report_schedules
    ADD CONSTRAINT tat_report_schedules_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams teams_slug_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_slug_tenant_id_key UNIQUE (slug, tenant_id);


--
-- Name: tenant_access_events tenant_access_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_access_events
    ADD CONSTRAINT tenant_access_events_pkey PRIMARY KEY (id);


--
-- Name: tenant_access_grants tenant_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_access_grants
    ADD CONSTRAINT tenant_access_grants_pkey PRIMARY KEY (id);


--
-- Name: tenant_integrations tenant_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_integrations
    ADD CONSTRAINT tenant_integrations_pkey PRIMARY KEY (id);


--
-- Name: tenant_integrations tenant_integrations_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_integrations
    ADD CONSTRAINT tenant_integrations_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: transfer_history transfer_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_history
    ADD CONSTRAINT transfer_history_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: workflow_events workflow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_events
    ADD CONSTRAINT workflow_events_pkey PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: api_keys_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_tenant_idx ON public.api_keys USING btree (tenant_id);


--
-- Name: chat_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_conversation_idx ON public.chat_messages USING btree (conversation_id, created_at);


--
-- Name: chat_messages_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_user_created_idx ON public.chat_messages USING btree (user_id, created_at DESC);


--
-- Name: checklist_meetings_awaiting_transcript_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_meetings_awaiting_transcript_idx ON public.checklist_meetings USING btree (scheduled_at) WHERE ((status <> 'cancelled'::text) AND (transcript IS NULL));


--
-- Name: checklist_meetings_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_meetings_item_idx ON public.checklist_meetings USING btree (checklist_item_id, scheduled_at);


--
-- Name: checklist_meetings_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_meetings_project_idx ON public.checklist_meetings USING btree (project_id, scheduled_at);


--
-- Name: checklist_meetings_provider_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checklist_meetings_provider_id_idx ON public.checklist_meetings USING btree (provider, provider_meeting_id) WHERE (provider_meeting_id IS NOT NULL);


--
-- Name: idx_activity_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_entity ON public.activity_logs USING btree (entity_type, entity_id);


--
-- Name: idx_activity_logs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_tenant_created ON public.activity_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_ai_workflows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_workflows_tenant ON public.ai_workflows USING btree (tenant_id, is_active);


--
-- Name: idx_app_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_settings_tenant ON public.app_settings USING btree (tenant_id);


--
-- Name: idx_brd_responses_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brd_responses_session ON public.brd_responses USING btree (session_id);


--
-- Name: idx_brd_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brd_sessions_token ON public.brd_sessions USING btree (token);


--
-- Name: idx_chat_messages_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id, created_at);


--
-- Name: idx_checklist_comments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_comments_created_at ON public.checklist_comments USING btree (created_at);


--
-- Name: idx_checklist_comments_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_comments_item_id ON public.checklist_comments USING btree (checklist_item_id);


--
-- Name: idx_checklist_items_project_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_items_project_sort ON public.checklist_items USING btree (project_id, sort_order, id);


--
-- Name: idx_checklist_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_items_tenant ON public.checklist_items USING btree (tenant_id);


--
-- Name: idx_checklist_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_project ON public.checklist_items USING btree (project_id);


--
-- Name: idx_checklist_resp_logs_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checklist_resp_logs_item ON public.checklist_responsibility_logs USING btree (checklist_item_id);


--
-- Name: idx_comment_logs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_logs_project ON public.project_comment_logs USING btree (project_id);


--
-- Name: idx_comment_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_logs_tenant ON public.project_comment_logs USING btree (tenant_id);


--
-- Name: idx_custom_field_values_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_field_values_project ON public.custom_field_values USING btree (project_id);


--
-- Name: idx_custom_fields_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_active_sort ON public.custom_fields USING btree (is_active, sort_order);


--
-- Name: idx_mpv_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpv_email ON public.merchant_portal_visits USING btree (email);


--
-- Name: idx_mpv_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpv_project ON public.merchant_portal_visits USING btree (project_id);


--
-- Name: idx_mpv_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpv_tenant ON public.merchant_portal_visits USING btree (tenant_id);


--
-- Name: idx_mpv_visited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpv_visited_at ON public.merchant_portal_visits USING btree (visited_at DESC);


--
-- Name: idx_platform_merchants_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_merchants_platform ON public.platform_merchants USING btree (platform);


--
-- Name: idx_platform_merchants_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_merchants_tenant ON public.platform_merchants USING btree (tenant_id);


--
-- Name: idx_portal_tokens_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_tokens_project ON public.merchant_portal_tokens USING btree (project_id);


--
-- Name: idx_portal_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_tokens_token ON public.merchant_portal_tokens USING btree (token);


--
-- Name: idx_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_tenant ON public.profiles USING btree (tenant_id);


--
-- Name: idx_proj_resp_logs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proj_resp_logs_started ON public.project_responsibility_logs USING btree (started_at);


--
-- Name: idx_project_ai_insights_project_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_ai_insights_project_month ON public.project_ai_insights USING btree (project_id, month);


--
-- Name: idx_project_ai_insights_tenant_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_ai_insights_tenant_month ON public.project_ai_insights USING btree (tenant_id, month);


--
-- Name: idx_project_email_context_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_email_context_project ON public.project_email_context USING btree (project_id);


--
-- Name: idx_project_emails_project_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_emails_project_date ON public.project_emails USING btree (project_id, thread_date DESC);


--
-- Name: idx_project_emails_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_emails_project_id ON public.project_emails USING btree (project_id);


--
-- Name: idx_project_emails_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_emails_thread ON public.project_emails USING btree (gmail_thread_id, project_id);


--
-- Name: idx_project_emails_thread_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_emails_thread_date ON public.project_emails USING btree (project_id, thread_date DESC);


--
-- Name: idx_project_jira_tickets_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_jira_tickets_project ON public.project_jira_tickets USING btree (project_id);


--
-- Name: idx_project_jira_tickets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_jira_tickets_tenant ON public.project_jira_tickets USING btree (tenant_id);


--
-- Name: idx_project_resp_logs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_resp_logs_project ON public.project_responsibility_logs USING btree (project_id);


--
-- Name: idx_projects_assigned_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_assigned_owner ON public.projects USING btree (assigned_owner);


--
-- Name: idx_projects_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_created_at ON public.projects USING btree (created_at DESC);


--
-- Name: idx_projects_owner_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_owner_team ON public.projects USING btree (current_owner_team);


--
-- Name: idx_projects_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_phase ON public.projects USING btree (current_phase);


--
-- Name: idx_projects_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_tenant ON public.projects USING btree (tenant_id);


--
-- Name: idx_projects_tracker_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_tracker_month ON public.projects USING btree (tracker_month);


--
-- Name: idx_report_executions_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_executions_report_id ON public.report_executions USING btree (report_id);


--
-- Name: idx_report_executions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_executions_status ON public.report_executions USING btree (status);


--
-- Name: idx_transfer_history_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfer_history_project ON public.transfer_history USING btree (project_id);


--
-- Name: idx_user_roles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_tenant ON public.user_roles USING btree (tenant_id);


--
-- Name: notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: platform_merchants_tenant_gmail_msg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_merchants_tenant_gmail_msg_idx ON public.platform_merchants USING btree (tenant_id, gmail_message_id) WHERE (gmail_message_id IS NOT NULL);


--
-- Name: project_risks_auto_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_risks_auto_open_idx ON public.project_risks USING btree (project_id, trigger_rule) WHERE ((trigger_type = 'auto'::text) AND (status <> 'resolved'::text) AND (status <> 'dismissed'::text));


--
-- Name: projects_tenant_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX projects_tenant_external_id_idx ON public.projects USING btree (tenant_id, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: shopify_sme_merchants_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopify_sme_merchants_thread_idx ON public.shopify_sme_merchants USING btree (tenant_id, gmail_thread_id);


--
-- Name: signup_leads_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX signup_leads_created_at_idx ON public.signup_leads USING btree (created_at DESC);


--
-- Name: signup_leads_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX signup_leads_email_idx ON public.signup_leads USING btree (lower(email));


--
-- Name: tenant_access_events_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_access_events_tenant_idx ON public.tenant_access_events USING btree (tenant_id, created_at DESC);


--
-- Name: tenant_access_grants_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_access_grants_active_idx ON public.tenant_access_grants USING btree (granted_to, tenant_id, expires_at DESC);


--
-- Name: workflow_events_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_events_pending_idx ON public.workflow_events USING btree (processed_at, created_at);


--
-- Name: workflow_runs_workflow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_runs_workflow_idx ON public.workflow_runs USING btree (workflow_id, created_at DESC);


--
-- Name: activity_logs activity_logs_attribute_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER activity_logs_attribute_support BEFORE INSERT ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.activity_logs_attribute_support();


--
-- Name: checklist_items checklist_items_enqueue_workflow_event_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_items_enqueue_workflow_event_upd AFTER UPDATE OF completed ON public.checklist_items FOR EACH ROW EXECUTE FUNCTION public.checklist_items_enqueue_workflow_event();


--
-- Name: checklist_items checklist_items_sync_egl; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_items_sync_egl AFTER INSERT OR DELETE OR UPDATE OF due_date, is_task, project_id ON public.checklist_items FOR EACH ROW EXECUTE FUNCTION public.checklist_items_sync_egl();


--
-- Name: checklist_meetings checklist_meetings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_meetings_updated_at BEFORE UPDATE ON public.checklist_meetings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: movement_report_schedules movement_report_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER movement_report_schedules_updated_at BEFORE UPDATE ON public.movement_report_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles profiles_guard_support_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_guard_support_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_support_fields();


--
-- Name: profiles profiles_guard_tenant_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_guard_tenant_id BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_tenant_id();


--
-- Name: profiles profiles_log_support_session; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_log_support_session AFTER UPDATE OF active_tenant_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_log_support_session();


--
-- Name: projects projects_enqueue_workflow_event_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_enqueue_workflow_event_ins AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_enqueue_workflow_event();


--
-- Name: projects projects_enqueue_workflow_event_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_enqueue_workflow_event_upd AFTER UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_enqueue_workflow_event();


--
-- Name: projects projects_mark_manual_egl_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_mark_manual_egl_ins BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_mark_manual_egl();


--
-- Name: projects projects_mark_manual_egl_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_mark_manual_egl_upd BEFORE UPDATE OF expected_go_live_date ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_mark_manual_egl();


--
-- Name: projects projects_refill_auto_egl; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_refill_auto_egl AFTER UPDATE OF expected_go_live_date ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_refill_auto_egl();


--
-- Name: projects seed_project_checklist_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seed_project_checklist_trigger AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.seed_project_checklist();


--
-- Name: shopify_lt_thread_status shopify_lt_thread_status_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shopify_lt_thread_status_updated_at BEFORE UPDATE ON public.shopify_lt_thread_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tat_report_schedules tat_report_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tat_report_schedules_updated_at BEFORE UPDATE ON public.tat_report_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tenant_access_events tenant_access_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_access_events_immutable BEFORE DELETE OR UPDATE ON public.tenant_access_events FOR EACH ROW EXECUTE FUNCTION public.tenant_access_events_immutable();


--
-- Name: tenant_access_grants tenant_access_grants_after_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_access_grants_after_change AFTER INSERT OR UPDATE ON public.tenant_access_grants FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_after_change();


--
-- Name: tenant_access_grants tenant_access_grants_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_access_grants_before_insert BEFORE INSERT ON public.tenant_access_grants FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_before_insert();


--
-- Name: tenant_access_grants tenant_access_grants_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_access_grants_before_update BEFORE UPDATE ON public.tenant_access_grants FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_before_update();


--
-- Name: app_settings update_app_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: checklist_tasks update_checklist_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_checklist_tasks_updated_at BEFORE UPDATE ON public.checklist_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: parsed_emails update_parsed_emails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_parsed_emails_updated_at BEFORE UPDATE ON public.parsed_emails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: platform_merchants update_platform_merchants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_platform_merchants_updated_at BEFORE UPDATE ON public.platform_merchants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_ai_insights update_project_ai_insights_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_ai_insights_updated_at BEFORE UPDATE ON public.project_ai_insights FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_credentials update_project_credentials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_credentials_updated_at BEFORE UPDATE ON public.project_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_emails update_project_emails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_emails_updated_at BEFORE UPDATE ON public.project_emails FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_jira_tickets update_project_jira_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_jira_tickets_updated_at BEFORE UPDATE ON public.project_jira_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_risks update_project_risks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_risks_updated_at BEFORE UPDATE ON public.project_risks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: projects update_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shopify_sme_merchants update_shopify_sme_merchants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shopify_sme_merchants_updated_at BEFORE UPDATE ON public.shopify_sme_merchants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tenant_integrations update_tenant_integrations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tenant_integrations_updated_at BEFORE UPDATE ON public.tenant_integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tenants update_tenants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: activity_logs activity_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: ai_workflows ai_workflows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_workflows
    ADD CONSTRAINT ai_workflows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: api_keys api_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: app_settings app_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: brd_responses brd_responses_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_responses
    ADD CONSTRAINT brd_responses_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.checklist_form_fields(id) ON DELETE CASCADE;


--
-- Name: brd_responses brd_responses_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_responses
    ADD CONSTRAINT brd_responses_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.brd_sessions(id) ON DELETE CASCADE;


--
-- Name: brd_responses brd_responses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_responses
    ADD CONSTRAINT brd_responses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: brd_sessions brd_sessions_form_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_sessions
    ADD CONSTRAINT brd_sessions_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.checklist_form_templates(id) ON DELETE CASCADE;


--
-- Name: brd_sessions brd_sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_sessions
    ADD CONSTRAINT brd_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: brd_sessions brd_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brd_sessions
    ADD CONSTRAINT brd_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: chat_messages chat_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_comments checklist_comments_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_comments
    ADD CONSTRAINT checklist_comments_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: checklist_comments checklist_comments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_comments
    ADD CONSTRAINT checklist_comments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_form_assignments checklist_form_assignments_checklist_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_assignments
    ADD CONSTRAINT checklist_form_assignments_checklist_template_id_fkey FOREIGN KEY (checklist_template_id) REFERENCES public.checklist_templates(id) ON DELETE CASCADE;


--
-- Name: checklist_form_assignments checklist_form_assignments_form_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_assignments
    ADD CONSTRAINT checklist_form_assignments_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.checklist_form_templates(id) ON DELETE CASCADE;


--
-- Name: checklist_form_assignments checklist_form_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_assignments
    ADD CONSTRAINT checklist_form_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_form_fields checklist_form_fields_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_fields
    ADD CONSTRAINT checklist_form_fields_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.checklist_form_templates(id) ON DELETE CASCADE;


--
-- Name: checklist_form_fields checklist_form_fields_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_fields
    ADD CONSTRAINT checklist_form_fields_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_form_responses checklist_form_responses_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: checklist_form_responses checklist_form_responses_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.checklist_form_fields(id) ON DELETE CASCADE;


--
-- Name: checklist_form_responses checklist_form_responses_form_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.checklist_form_templates(id) ON DELETE CASCADE;


--
-- Name: checklist_form_responses checklist_form_responses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: checklist_form_responses checklist_form_responses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_responses
    ADD CONSTRAINT checklist_form_responses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_form_templates checklist_form_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_form_templates
    ADD CONSTRAINT checklist_form_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_items checklist_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: checklist_items checklist_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_meetings checklist_meetings_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_meetings
    ADD CONSTRAINT checklist_meetings_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: checklist_meetings checklist_meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_meetings
    ADD CONSTRAINT checklist_meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: checklist_meetings checklist_meetings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_meetings
    ADD CONSTRAINT checklist_meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: checklist_meetings checklist_meetings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_meetings
    ADD CONSTRAINT checklist_meetings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_responsibility_logs checklist_responsibility_logs_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_responsibility_logs
    ADD CONSTRAINT checklist_responsibility_logs_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: checklist_responsibility_logs checklist_responsibility_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_responsibility_logs
    ADD CONSTRAINT checklist_responsibility_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_tasks checklist_tasks_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_tasks
    ADD CONSTRAINT checklist_tasks_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: checklist_tasks checklist_tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_tasks
    ADD CONSTRAINT checklist_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: checklist_tasks checklist_tasks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_tasks
    ADD CONSTRAINT checklist_tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checklist_templates checklist_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: custom_field_values custom_field_values_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.custom_fields(id) ON DELETE CASCADE;


--
-- Name: custom_field_values custom_field_values_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: custom_field_values custom_field_values_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: custom_fields custom_fields_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_fields
    ADD CONSTRAINT custom_fields_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: merchant_portal_uploads merchant_portal_uploads_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_portal_uploads
    ADD CONSTRAINT merchant_portal_uploads_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: movement_report_executions movement_report_executions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movement_report_executions
    ADD CONSTRAINT movement_report_executions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.movement_report_schedules(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: parsed_emails parsed_emails_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parsed_emails
    ADD CONSTRAINT parsed_emails_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id);


--
-- Name: parsed_emails parsed_emails_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parsed_emails
    ADD CONSTRAINT parsed_emails_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: platform_merchants platform_merchants_csm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_merchants
    ADD CONSTRAINT platform_merchants_csm_id_fkey FOREIGN KEY (csm_id) REFERENCES public.profiles(id);


--
-- Name: platform_merchants platform_merchants_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_merchants
    ADD CONSTRAINT platform_merchants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_ai_insights project_ai_insights_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_ai_insights
    ADD CONSTRAINT project_ai_insights_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_comment_logs project_comment_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comment_logs
    ADD CONSTRAINT project_comment_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_comment_logs project_comment_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comment_logs
    ADD CONSTRAINT project_comment_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_credentials project_credentials_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_credentials
    ADD CONSTRAINT project_credentials_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_credentials project_credentials_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_credentials
    ADD CONSTRAINT project_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: project_email_context project_email_context_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_email_context
    ADD CONSTRAINT project_email_context_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_email_context project_email_context_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_email_context
    ADD CONSTRAINT project_email_context_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_emails project_emails_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_emails
    ADD CONSTRAINT project_emails_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_emails project_emails_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_emails
    ADD CONSTRAINT project_emails_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_jira_tickets project_jira_tickets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jira_tickets
    ADD CONSTRAINT project_jira_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_responsibility_logs project_responsibility_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_responsibility_logs
    ADD CONSTRAINT project_responsibility_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_responsibility_logs project_responsibility_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_responsibility_logs
    ADD CONSTRAINT project_responsibility_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: project_risk_insights project_risk_insights_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_risk_insights
    ADD CONSTRAINT project_risk_insights_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_risk_insights project_risk_insights_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_risk_insights
    ADD CONSTRAINT project_risk_insights_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: projects projects_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: report_executions report_executions_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.saved_reports(id) ON DELETE CASCADE;


--
-- Name: report_executions report_executions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: saved_reports saved_reports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: shopify_lt_thread_status shopify_lt_thread_status_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_lt_thread_status
    ADD CONSTRAINT shopify_lt_thread_status_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: shopify_sme_merchants shopify_sme_merchants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_sme_merchants
    ADD CONSTRAINT shopify_sme_merchants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: teams teams_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_access_grants tenant_access_grants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_access_grants
    ADD CONSTRAINT tenant_access_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_integrations tenant_integrations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_integrations
    ADD CONSTRAINT tenant_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: transfer_history transfer_history_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_history
    ADD CONSTRAINT transfer_history_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: transfer_history transfer_history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_history
    ADD CONSTRAINT transfer_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: user_roles user_roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_runs workflow_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.ai_workflows(id) ON DELETE CASCADE;


--
-- Name: cron_config; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.cron_config ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_logs Activity logs viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Activity logs viewable by tenant" ON public.activity_logs FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: api_keys Admins read tenant api keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read tenant api keys" ON public.api_keys FOR SELECT TO authenticated USING ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: checklist_form_assignments Assignments viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Assignments viewable by tenant" ON public.checklist_form_assignments FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: merchant_portal_uploads Authenticated users can delete uploads for their tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can delete uploads for their tenant" ON public.merchant_portal_uploads FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = public.uid()))));


--
-- Name: merchant_portal_uploads Authenticated users can insert uploads for their tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert uploads for their tenant" ON public.merchant_portal_uploads FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = public.uid()))));


--
-- Name: merchant_portal_uploads Authenticated users can view uploads for their tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view uploads for their tenant" ON public.merchant_portal_uploads FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = public.uid()))));


--
-- Name: brd_responses BRD responses viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "BRD responses viewable by tenant" ON public.brd_responses FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: brd_sessions BRD sessions viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "BRD sessions viewable by tenant" ON public.brd_sessions FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_email_context Block gokwik_general writes on project_email_context; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block gokwik_general writes on project_email_context" ON public.project_email_context AS RESTRICTIVE USING (
CASE
    WHEN (current_setting('request.method'::text, true) = ANY (ARRAY['POST'::text, 'PATCH'::text, 'PUT'::text, 'DELETE'::text])) THEN (NOT public.is_gokwik_general(public.uid()))
    ELSE true
END) WITH CHECK ((NOT public.is_gokwik_general(public.uid())));


--
-- Name: project_emails Block gokwik_general writes on project_emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block gokwik_general writes on project_emails" ON public.project_emails AS RESTRICTIVE USING (
CASE
    WHEN (current_setting('request.method'::text, true) = ANY (ARRAY['POST'::text, 'PATCH'::text, 'PUT'::text, 'DELETE'::text])) THEN (NOT public.is_gokwik_general(public.uid()))
    ELSE true
END) WITH CHECK ((NOT public.is_gokwik_general(public.uid())));


--
-- Name: project_jira_tickets Block gokwik_general writes on project_jira_tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block gokwik_general writes on project_jira_tickets" ON public.project_jira_tickets AS RESTRICTIVE USING (
CASE
    WHEN (current_setting('request.method'::text, true) = ANY (ARRAY['POST'::text, 'PATCH'::text, 'PUT'::text, 'DELETE'::text])) THEN (NOT public.is_gokwik_general(public.uid()))
    ELSE true
END) WITH CHECK ((NOT public.is_gokwik_general(public.uid())));


--
-- Name: transfer_history Block gokwik_general writes on transfer_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block gokwik_general writes on transfer_history" ON public.transfer_history AS RESTRICTIVE USING ((NOT public.is_gokwik_general(public.uid()))) WITH CHECK ((NOT public.is_gokwik_general(public.uid())));


--
-- Name: checklist_comments Checklist comments viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Checklist comments viewable by tenant" ON public.checklist_comments FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_items Checklist items viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Checklist items viewable by tenant" ON public.checklist_items FOR SELECT USING (((tenant_id = ( SELECT public.get_user_tenant_id(public.uid()) AS get_user_tenant_id)) OR ( SELECT public.is_super_admin(public.uid()) AS is_super_admin)));


--
-- Name: checklist_responsibility_logs Checklist resp logs viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Checklist resp logs viewable by tenant" ON public.checklist_responsibility_logs FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_comment_logs Comment logs viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Comment logs viewable by tenant" ON public.project_comment_logs FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: custom_field_values Custom field values viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Custom field values viewable by tenant" ON public.custom_field_values FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: custom_fields Custom fields viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Custom fields viewable by tenant" ON public.custom_fields FOR SELECT USING (((tenant_id = ( SELECT public.get_user_tenant_id(public.uid()) AS get_user_tenant_id)) OR ( SELECT public.is_super_admin(public.uid()) AS is_super_admin)));


--
-- Name: checklist_form_fields Form fields viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Form fields viewable by tenant" ON public.checklist_form_fields FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_templates Form templates viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Form templates viewable by tenant" ON public.checklist_form_templates FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: movement_report_executions Insert executions in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Insert executions in tenant" ON public.movement_report_executions FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: movement_report_schedules Manage schedules in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manage schedules in tenant" ON public.movement_report_schedules USING ((((tenant_id = public.get_user_tenant_id(public.uid())) AND public.is_manager(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: tat_report_schedules Manage tat schedules in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manage tat schedules in tenant" ON public.tat_report_schedules USING ((((tenant_id = public.get_user_tenant_id(public.uid())) AND public.is_manager(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_assignments Managers can create assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create assignments" ON public.checklist_form_assignments FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: custom_fields Managers can create custom fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create custom fields" ON public.custom_fields FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_fields Managers can create form fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create form fields" ON public.checklist_form_fields FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_templates Managers can create form templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create form templates" ON public.checklist_form_templates FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: saved_reports Managers can create reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create reports" ON public.saved_reports FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: teams Managers can create teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create teams" ON public.teams FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_templates Managers can create templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create templates" ON public.checklist_templates FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: ai_workflows Managers can create workflows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can create workflows" ON public.ai_workflows FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_assignments Managers can delete assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete assignments" ON public.checklist_form_assignments FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_responsibility_logs Managers can delete checklist resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete checklist resp logs" ON public.checklist_responsibility_logs FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: project_comment_logs Managers can delete comment logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete comment logs" ON public.project_comment_logs FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: custom_fields Managers can delete custom fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete custom fields" ON public.custom_fields FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_fields Managers can delete form fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete form fields" ON public.checklist_form_fields FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_templates Managers can delete form templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete form templates" ON public.checklist_form_templates FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: parsed_emails Managers can delete parsed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete parsed emails" ON public.parsed_emails FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: merchant_portal_tokens Managers can delete portal tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete portal tokens" ON public.merchant_portal_tokens FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: project_responsibility_logs Managers can delete project resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete project resp logs" ON public.project_responsibility_logs FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: report_executions Managers can delete report executions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete report executions" ON public.report_executions FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: saved_reports Managers can delete reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete reports" ON public.saved_reports FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_sme_merchants Managers can delete shopify sme; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete shopify sme" ON public.shopify_sme_merchants FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: teams Managers can delete teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete teams" ON public.teams FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_templates Managers can delete templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete templates" ON public.checklist_templates FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: transfer_history Managers can delete transfer records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete transfer records" ON public.transfer_history FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: ai_workflows Managers can delete workflows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can delete workflows" ON public.ai_workflows FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: parsed_emails Managers can insert parsed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert parsed emails" ON public.parsed_emails FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_sme_merchants Managers can insert shopify sme; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert shopify sme" ON public.shopify_sme_merchants FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: app_settings Managers can insert tenant settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert tenant settings" ON public.app_settings FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: profiles Managers can update any profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update any profile" ON public.profiles FOR UPDATE TO authenticated USING (((public.is_manager(auth.uid()) AND (tenant_id = public.get_user_tenant_id(auth.uid()))) OR (auth.uid() = id)));


--
-- Name: custom_fields Managers can update custom fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update custom fields" ON public.custom_fields FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_fields Managers can update form fields; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update form fields" ON public.checklist_form_fields FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_templates Managers can update form templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update form templates" ON public.checklist_form_templates FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: parsed_emails Managers can update parsed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update parsed emails" ON public.parsed_emails FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: saved_reports Managers can update reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update reports" ON public.saved_reports FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_sme_merchants Managers can update shopify sme; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update shopify sme" ON public.shopify_sme_merchants FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: teams Managers can update teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update teams" ON public.teams FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_templates Managers can update templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update templates" ON public.checklist_templates FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: app_settings Managers can update tenant settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update tenant settings" ON public.app_settings FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: ai_workflows Managers can update workflows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update workflows" ON public.ai_workflows FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: user_roles Managers delete tenant roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers delete tenant roles" ON public.user_roles FOR DELETE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: user_roles Managers insert tenant roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers insert tenant roles" ON public.user_roles FOR INSERT WITH CHECK (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: user_roles Managers update tenant roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers update tenant roles" ON public.user_roles FOR UPDATE USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: user_roles Managers view tenant roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers view tenant roles" ON public.user_roles FOR SELECT USING (((public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: parsed_emails Parsed emails viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parsed emails viewable by tenant" ON public.parsed_emails FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: merchant_portal_tokens Portal tokens viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal tokens viewable by tenant" ON public.merchant_portal_tokens FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_responsibility_logs Project resp logs viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Project resp logs viewable by tenant" ON public.project_responsibility_logs FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: projects Projects viewable by tenant users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Projects viewable by tenant users" ON public.projects FOR SELECT USING (((tenant_id = ( SELECT public.get_user_tenant_id(public.uid()) AS get_user_tenant_id)) OR ( SELECT public.is_super_admin(public.uid()) AS is_super_admin)));


--
-- Name: report_executions Report executions viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Report executions viewable by tenant" ON public.report_executions FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: saved_reports Reports viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Reports viewable by tenant" ON public.saved_reports FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_responses Responses viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Responses viewable by tenant" ON public.checklist_form_responses FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_risks Risks viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Risks viewable by tenant" ON public.project_risks FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: app_settings Settings readable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Settings readable by tenant" ON public.app_settings FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_sme_merchants Shopify SME viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Shopify SME viewable by tenant" ON public.shopify_sme_merchants FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: tenants Super admins can do everything on tenants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins can do everything on tenants" ON public.tenants USING (public.is_super_admin(public.uid()));


--
-- Name: tenant_access_grants Super admins open access grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins open access grants" ON public.tenant_access_grants FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));


--
-- Name: tenant_access_events Super admins read access events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins read access events" ON public.tenant_access_events FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));


--
-- Name: tenant_access_grants Super admins read access grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins read access grants" ON public.tenant_access_grants FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));


--
-- Name: signup_leads Super admins read signup leads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins read signup leads" ON public.signup_leads FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));


--
-- Name: tenant_access_grants Super admins revoke access grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins revoke access grants" ON public.tenant_access_grants FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));


--
-- Name: activity_logs Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.activity_logs AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: ai_workflows Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.ai_workflows AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: api_keys Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.api_keys AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: app_settings Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.app_settings AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: brd_responses Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.brd_responses AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: brd_sessions Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.brd_sessions AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: chat_messages Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.chat_messages AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_comments Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_comments AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_form_assignments Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_form_assignments AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_form_fields Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_form_fields AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_form_responses Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_form_responses AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_form_templates Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_form_templates AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_items Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_items AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_meetings Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_meetings AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_responsibility_logs Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_responsibility_logs AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_tasks Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_tasks AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_templates Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.checklist_templates AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: custom_field_values Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.custom_field_values AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: custom_fields Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.custom_fields AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: merchant_portal_tokens Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.merchant_portal_tokens AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: merchant_portal_uploads Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.merchant_portal_uploads AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: merchant_portal_visits Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.merchant_portal_visits AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: movement_report_executions Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.movement_report_executions AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: movement_report_schedules Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.movement_report_schedules AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: notifications Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.notifications AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (user_id = auth.uid()))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (user_id = auth.uid())));


--
-- Name: parsed_emails Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.parsed_emails AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: platform_merchants Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.platform_merchants AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: profiles Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.profiles AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (id = auth.uid()))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (id = auth.uid())));


--
-- Name: project_ai_insights Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_ai_insights AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_comment_logs Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_comment_logs AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_credentials Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_credentials AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_email_context Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_email_context AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_emails Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_emails AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_jira_tickets Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_jira_tickets AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_responsibility_logs Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_responsibility_logs AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_risk_insights Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_risk_insights AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: project_risks Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.project_risks AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: projects Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.projects AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: report_executions Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.report_executions AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: saved_reports Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.saved_reports AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: shopify_lt_thread_status Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.shopify_lt_thread_status AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: shopify_sme_merchants Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.shopify_sme_merchants AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: tat_report_schedules Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.tat_report_schedules AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: teams Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.teams AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: tenant_integrations Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.tenant_integrations AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: transfer_history Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.transfer_history AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: user_roles Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.user_roles AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (user_id = auth.uid()))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)) OR (user_id = auth.uid())));


--
-- Name: workflow_events Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.workflow_events AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: workflow_runs Super admins stay in the current workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins stay in the current workspace" ON public.workflow_runs AS RESTRICTIVE TO authenticated USING (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id)))) WITH CHECK (((NOT ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin)) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT public.get_user_tenant_id(auth.uid()) AS get_user_tenant_id))));


--
-- Name: checklist_tasks Tasks viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tasks viewable by tenant" ON public.checklist_tasks FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: teams Teams viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teams viewable by tenant" ON public.teams FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_templates Templates viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Templates viewable by tenant" ON public.checklist_templates FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_credentials Tenant admins can create project credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can create project credentials" ON public.project_credentials FOR INSERT TO authenticated WITH CHECK ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: tenant_integrations Tenant admins can create their integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can create their integrations" ON public.tenant_integrations FOR INSERT TO authenticated WITH CHECK (((public.is_tenant_admin(auth.uid()) AND (tenant_id = public.get_user_tenant_id(auth.uid()))) OR public.is_super_admin(auth.uid())));


--
-- Name: project_credentials Tenant admins can delete project credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can delete project credentials" ON public.project_credentials FOR DELETE TO authenticated USING ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: project_credentials Tenant admins can update project credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can update project credentials" ON public.project_credentials FOR UPDATE TO authenticated USING ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()))) WITH CHECK ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: tenant_integrations Tenant admins can update their integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can update their integrations" ON public.tenant_integrations FOR UPDATE TO authenticated USING (((public.is_tenant_admin(auth.uid()) AND (tenant_id = public.get_user_tenant_id(auth.uid()))) OR public.is_super_admin(auth.uid())));


--
-- Name: project_credentials Tenant admins can view project credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can view project credentials" ON public.project_credentials FOR SELECT TO authenticated USING ((((tenant_id = public.get_user_tenant_id(auth.uid())) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: tenant_integrations Tenant admins can view their integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can view their integrations" ON public.tenant_integrations FOR SELECT TO authenticated USING (((public.is_tenant_admin(auth.uid()) AND (tenant_id = public.get_user_tenant_id(auth.uid()))) OR public.is_super_admin(auth.uid())));


--
-- Name: platform_merchants Tenant members can delete platform merchants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members can delete platform merchants" ON public.platform_merchants FOR DELETE TO authenticated USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: platform_merchants Tenant members can insert platform merchants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members can insert platform merchants" ON public.platform_merchants FOR INSERT TO authenticated WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: platform_merchants Tenant members can update platform merchants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members can update platform merchants" ON public.platform_merchants FOR UPDATE TO authenticated USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: platform_merchants Tenant members can view platform merchants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members can view platform merchants" ON public.platform_merchants FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: notifications Tenant members create notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members create notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin(auth.uid()) OR ((tenant_id IS NOT NULL) AND (tenant_id = public.get_user_tenant_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = notifications.user_id) AND (p.tenant_id = notifications.tenant_id)))))));


--
-- Name: merchant_portal_visits Tenant members log portal visits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members log portal visits" ON public.merchant_portal_visits FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: tenant_access_events Tenant members read access events on their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members read access events on their workspace" ON public.tenant_access_events FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: tenant_access_grants Tenant members read grants on their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members read grants on their workspace" ON public.tenant_access_grants FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: checklist_meetings Tenant members read meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members read meetings" ON public.checklist_meetings FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: project_risk_insights Tenant members read risk insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members read risk insights" ON public.project_risk_insights FOR SELECT TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: workflow_runs Tenant members read workflow runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members read workflow runs" ON public.workflow_runs FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: project_ai_insights Tenant members view ai insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members view ai insights" ON public.project_ai_insights FOR SELECT TO authenticated USING ((public.is_super_admin(public.uid()) OR (tenant_id = public.get_user_tenant_id(public.uid())) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_ai_insights.project_id) AND (p.tenant_id = public.get_user_tenant_id(public.uid())))))));


--
-- Name: merchant_portal_visits Tenant members view portal visits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members view portal visits" ON public.merchant_portal_visits FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_ai_insights Tenant members write ai insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members write ai insights" ON public.project_ai_insights TO authenticated USING ((public.is_super_admin(public.uid()) OR (tenant_id = public.get_user_tenant_id(public.uid())) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_ai_insights.project_id) AND (p.tenant_id = public.get_user_tenant_id(public.uid()))))))) WITH CHECK ((public.is_super_admin(public.uid()) OR (tenant_id = public.get_user_tenant_id(public.uid())) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_ai_insights.project_id) AND (p.tenant_id = public.get_user_tenant_id(public.uid())))))));


--
-- Name: checklist_meetings Tenant members write meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members write meetings" ON public.checklist_meetings TO authenticated USING (((tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid()))) WITH CHECK (((tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid())));


--
-- Name: project_risk_insights Tenant members write risk insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant members write risk insights" ON public.project_risk_insights TO authenticated USING ((tenant_id = public.get_user_tenant_id(auth.uid()))) WITH CHECK ((tenant_id = public.get_user_tenant_id(auth.uid())));


--
-- Name: brd_sessions Tenant users can create BRD sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create BRD sessions" ON public.brd_sessions FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: activity_logs Tenant users can create activity logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create activity logs" ON public.activity_logs FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_comments Tenant users can create checklist comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create checklist comments" ON public.checklist_comments FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_items Tenant users can create checklist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create checklist items" ON public.checklist_items FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_responsibility_logs Tenant users can create checklist resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create checklist resp logs" ON public.checklist_responsibility_logs FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_comment_logs Tenant users can create comment logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create comment logs" ON public.project_comment_logs FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: custom_field_values Tenant users can create custom field values; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create custom field values" ON public.custom_field_values FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: merchant_portal_tokens Tenant users can create portal tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create portal tokens" ON public.merchant_portal_tokens FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_responsibility_logs Tenant users can create project resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create project resp logs" ON public.project_responsibility_logs FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: projects Tenant users can create projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create projects" ON public.projects FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: report_executions Tenant users can create report executions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create report executions" ON public.report_executions FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_responses Tenant users can create responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create responses" ON public.checklist_form_responses FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_risks Tenant users can create risks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create risks" ON public.project_risks FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_tasks Tenant users can create tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create tasks" ON public.checklist_tasks FOR INSERT WITH CHECK ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: transfer_history Tenant users can create transfer records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can create transfer records" ON public.transfer_history FOR INSERT WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_items Tenant users can delete checklist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete checklist items" ON public.checklist_items FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: custom_field_values Tenant users can delete custom field values; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete custom field values" ON public.custom_field_values FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: projects Tenant users can delete projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete projects" ON public.projects FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_form_responses Tenant users can delete responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete responses" ON public.checklist_form_responses FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_risks Tenant users can delete risks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete risks" ON public.project_risks FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_tasks Tenant users can delete tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete tasks" ON public.checklist_tasks FOR DELETE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: shopify_lt_thread_status Tenant users can delete thread statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can delete thread statuses" ON public.shopify_lt_thread_status FOR DELETE TO authenticated USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_lt_thread_status Tenant users can insert thread statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can insert thread statuses" ON public.shopify_lt_thread_status FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: brd_responses Tenant users can manage BRD responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can manage BRD responses" ON public.brd_responses USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: brd_sessions Tenant users can update BRD sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update BRD sessions" ON public.brd_sessions FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_items Tenant users can update checklist items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update checklist items" ON public.checklist_items FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_responsibility_logs Tenant users can update checklist resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update checklist resp logs" ON public.checklist_responsibility_logs FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: custom_field_values Tenant users can update custom field values; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update custom field values" ON public.custom_field_values FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: merchant_portal_tokens Tenant users can update portal tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update portal tokens" ON public.merchant_portal_tokens FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_responsibility_logs Tenant users can update project resp logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update project resp logs" ON public.project_responsibility_logs FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: projects Tenant users can update projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update projects" ON public.projects FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: report_executions Tenant users can update report executions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update report executions" ON public.report_executions FOR UPDATE USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: checklist_form_responses Tenant users can update responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update responses" ON public.checklist_form_responses FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: project_risks Tenant users can update risks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update risks" ON public.project_risks FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: checklist_tasks Tenant users can update tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update tasks" ON public.checklist_tasks FOR UPDATE USING ((((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())) AND (NOT public.is_gokwik_general(public.uid()))));


--
-- Name: shopify_lt_thread_status Tenant users can update thread statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update thread statuses" ON public.shopify_lt_thread_status FOR UPDATE TO authenticated USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: transfer_history Tenant users can update transfer records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can update transfer records" ON public.transfer_history FOR UPDATE USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: shopify_lt_thread_status Tenant users can view thread statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant users can view thread statuses" ON public.shopify_lt_thread_status FOR SELECT TO authenticated USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: transfer_history Transfer history viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Transfer history viewable by tenant" ON public.transfer_history FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: chat_messages Users can delete own chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own chat messages" ON public.chat_messages FOR DELETE USING ((public.uid() = user_id));


--
-- Name: checklist_comments Users can delete own comments in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own comments in tenant" ON public.checklist_comments FOR DELETE USING ((((user_id = public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR (public.is_manager(public.uid()) AND (tenant_id = public.get_user_tenant_id(public.uid()))) OR public.is_super_admin(public.uid())));


--
-- Name: chat_messages Users can insert own chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own chat messages" ON public.chat_messages FOR INSERT WITH CHECK ((public.uid() = user_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((public.uid() = id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING ((public.uid() = id));


--
-- Name: chat_messages Users can view own chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own chat messages" ON public.chat_messages FOR SELECT USING ((public.uid() = user_id));


--
-- Name: user_roles Users can view own role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING ((user_id = public.uid()));


--
-- Name: profiles Users can view tenant profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view tenant profiles" ON public.profiles FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: tenants Users can view their own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own tenant" ON public.tenants FOR SELECT USING ((id = public.get_user_tenant_id(public.uid())));


--
-- Name: notifications Users delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications Users read own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: tenant_access_events Users read their own access events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read their own access events" ON public.tenant_access_events FOR SELECT TO authenticated USING ((subject_user_id = auth.uid()));


--
-- Name: tenant_access_grants Users read their own grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read their own grants" ON public.tenant_access_grants FOR SELECT TO authenticated USING ((granted_to = auth.uid()));


--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_messages Users update their own chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update their own chat messages" ON public.chat_messages FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: movement_report_executions View executions in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View executions in tenant" ON public.movement_report_executions FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: movement_report_schedules View schedules in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View schedules in tenant" ON public.movement_report_schedules FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: tat_report_schedules View tat schedules in tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View tat schedules in tenant" ON public.tat_report_schedules FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: ai_workflows Workflows viewable by tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workflows viewable by tenant" ON public.ai_workflows FOR SELECT USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_workflows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: brd_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brd_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: brd_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brd_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_form_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_form_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_form_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_form_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_form_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_form_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_form_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_form_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_responsibility_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_responsibility_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_field_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_portal_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_portal_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_portal_uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_portal_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_portal_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_portal_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: movement_report_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movement_report_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: movement_report_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movement_report_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: parsed_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parsed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_merchants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_merchants ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: project_ai_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_ai_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: project_comment_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_comment_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: project_email_context; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_email_context ENABLE ROW LEVEL SECURITY;

--
-- Name: project_email_context project_email_context_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_email_context_tenant_access ON public.project_email_context USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: project_emails project_emails_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_emails_tenant_access ON public.project_emails USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_jira_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_jira_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: project_jira_tickets project_jira_tickets_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_jira_tickets_tenant_access ON public.project_jira_tickets USING (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid()))) WITH CHECK (((tenant_id = public.get_user_tenant_id(public.uid())) OR public.is_super_admin(public.uid())));


--
-- Name: project_responsibility_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_responsibility_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_risk_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_risk_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: project_risks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_risks ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: report_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: shopify_lt_thread_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopify_lt_thread_status ENABLE ROW LEVEL SECURITY;

--
-- Name: shopify_sme_merchants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopify_sme_merchants ENABLE ROW LEVEL SECURITY;

--
-- Name: signup_leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signup_leads ENABLE ROW LEVEL SECURITY;

--
-- Name: tat_report_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tat_report_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_access_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_access_events ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_access_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: transfer_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfer_history ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_events ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _is_platform_super_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._is_platform_super_admin(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._is_platform_super_admin(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public._is_platform_super_admin(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public._is_platform_super_admin(_user_id uuid) TO service_role;


--
-- Name: FUNCTION _log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public._log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb) TO anon;
GRANT ALL ON FUNCTION public._log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb) TO authenticated;
GRANT ALL ON FUNCTION public._log_support_access(_grant_id uuid, _tenant_id uuid, _subject uuid, _event text, _detail jsonb) TO service_role;


--
-- Name: FUNCTION _support_grant_role(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._support_grant_role(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._support_grant_role(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public._support_grant_role(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public._support_grant_role(_user_id uuid) TO service_role;


--
-- Name: FUNCTION active_support_tenant(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.active_support_tenant(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.active_support_tenant(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.active_support_tenant(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.active_support_tenant(_user_id uuid) TO service_role;


--
-- Name: FUNCTION activity_logs_attribute_support(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activity_logs_attribute_support() TO anon;
GRANT ALL ON FUNCTION public.activity_logs_attribute_support() TO authenticated;
GRANT ALL ON FUNCTION public.activity_logs_attribute_support() TO service_role;


--
-- Name: FUNCTION can_read_checklist_attachment(objname text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_read_checklist_attachment(objname text) TO anon;
GRANT ALL ON FUNCTION public.can_read_checklist_attachment(objname text) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_checklist_attachment(objname text) TO service_role;


--
-- Name: FUNCTION can_read_merchant_portal_file(objname text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_read_merchant_portal_file(objname text) TO anon;
GRANT ALL ON FUNCTION public.can_read_merchant_portal_file(objname text) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_merchant_portal_file(objname text) TO service_role;


--
-- Name: FUNCTION checklist_items_enqueue_workflow_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.checklist_items_enqueue_workflow_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.checklist_items_enqueue_workflow_event() TO anon;
GRANT ALL ON FUNCTION public.checklist_items_enqueue_workflow_event() TO authenticated;
GRANT ALL ON FUNCTION public.checklist_items_enqueue_workflow_event() TO service_role;


--
-- Name: FUNCTION checklist_items_sync_egl(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.checklist_items_sync_egl() FROM PUBLIC;
GRANT ALL ON FUNCTION public.checklist_items_sync_egl() TO anon;
GRANT ALL ON FUNCTION public.checklist_items_sync_egl() TO authenticated;
GRANT ALL ON FUNCTION public.checklist_items_sync_egl() TO service_role;


--
-- Name: FUNCTION create_tenant(_name text, _slug text, _logo_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_tenant(_name text, _slug text, _logo_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_tenant(_name text, _slug text, _logo_url text) TO anon;
GRANT ALL ON FUNCTION public.create_tenant(_name text, _slug text, _logo_url text) TO authenticated;
GRANT ALL ON FUNCTION public.create_tenant(_name text, _slug text, _logo_url text) TO service_role;


--
-- Name: FUNCTION cron_token_matches(_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cron_token_matches(_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cron_token_matches(_token text) TO anon;
GRANT ALL ON FUNCTION public.cron_token_matches(_token text) TO authenticated;
GRANT ALL ON FUNCTION public.cron_token_matches(_token text) TO service_role;


--
-- Name: FUNCTION delete_team_cascade(_slug text, _team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_team_cascade(_slug text, _team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_team_cascade(_slug text, _team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.delete_team_cascade(_slug text, _team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_team_cascade(_slug text, _team_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_role(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_role(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_role_home(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_role_home(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_role_home(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_role_home(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_role_home(_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_tenant_id(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_tenant_id(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_tenant_id(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_tenant_id(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_tenant_id(_user_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_gokwik_general(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_gokwik_general(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_gokwik_general(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_gokwik_general(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_gokwik_general(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_gokwik_general_home(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_gokwik_general_home(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_gokwik_general_home(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_gokwik_general_home(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_gokwik_general_home(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_manager(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_manager(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_manager(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_manager(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_manager(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_manager_home(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_manager_home(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_manager_home(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_manager_home(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_manager_home(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_super_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_super_admin(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_super_admin(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_super_admin(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_tenant_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_tenant_admin(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_tenant_admin(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_tenant_admin(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_tenant_admin(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_tenant_admin_home(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_tenant_admin_home(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_tenant_admin_home(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_tenant_admin_home(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_tenant_admin_home(_user_id uuid) TO service_role;


--
-- Name: FUNCTION my_support_session(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_support_session() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_support_session() TO anon;
GRANT ALL ON FUNCTION public.my_support_session() TO authenticated;
GRANT ALL ON FUNCTION public.my_support_session() TO service_role;


--
-- Name: FUNCTION profiles_guard_support_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_guard_support_fields() TO anon;
GRANT ALL ON FUNCTION public.profiles_guard_support_fields() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_guard_support_fields() TO service_role;


--
-- Name: FUNCTION profiles_guard_tenant_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_guard_tenant_id() TO anon;
GRANT ALL ON FUNCTION public.profiles_guard_tenant_id() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_guard_tenant_id() TO service_role;


--
-- Name: FUNCTION profiles_log_support_session(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_log_support_session() TO anon;
GRANT ALL ON FUNCTION public.profiles_log_support_session() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_log_support_session() TO service_role;


--
-- Name: FUNCTION project_last_activity(_tenant_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.project_last_activity(_tenant_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.project_last_activity(_tenant_id uuid) TO anon;
GRANT ALL ON FUNCTION public.project_last_activity(_tenant_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.project_last_activity(_tenant_id uuid) TO service_role;


--
-- Name: FUNCTION projects_enqueue_workflow_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.projects_enqueue_workflow_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.projects_enqueue_workflow_event() TO anon;
GRANT ALL ON FUNCTION public.projects_enqueue_workflow_event() TO authenticated;
GRANT ALL ON FUNCTION public.projects_enqueue_workflow_event() TO service_role;


--
-- Name: FUNCTION projects_mark_manual_egl(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.projects_mark_manual_egl() FROM PUBLIC;
GRANT ALL ON FUNCTION public.projects_mark_manual_egl() TO anon;
GRANT ALL ON FUNCTION public.projects_mark_manual_egl() TO authenticated;
GRANT ALL ON FUNCTION public.projects_mark_manual_egl() TO service_role;


--
-- Name: FUNCTION projects_refill_auto_egl(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.projects_refill_auto_egl() FROM PUBLIC;
GRANT ALL ON FUNCTION public.projects_refill_auto_egl() TO anon;
GRANT ALL ON FUNCTION public.projects_refill_auto_egl() TO authenticated;
GRANT ALL ON FUNCTION public.projects_refill_auto_egl() TO service_role;


--
-- Name: FUNCTION recompute_expected_go_live(_project_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_expected_go_live(_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_expected_go_live(_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.recompute_expected_go_live(_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.recompute_expected_go_live(_project_id uuid) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.role() TO anon;
GRANT ALL ON FUNCTION public.role() TO authenticated;
GRANT ALL ON FUNCTION public.role() TO service_role;


--
-- Name: FUNCTION seed_project_checklist(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seed_project_checklist() FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_project_checklist() TO anon;
GRANT ALL ON FUNCTION public.seed_project_checklist() TO authenticated;
GRANT ALL ON FUNCTION public.seed_project_checklist() TO service_role;


--
-- Name: FUNCTION storage_path_project_id(objname text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.storage_path_project_id(objname text) TO anon;
GRANT ALL ON FUNCTION public.storage_path_project_id(objname text) TO authenticated;
GRANT ALL ON FUNCTION public.storage_path_project_id(objname text) TO service_role;


--
-- Name: FUNCTION support_session_for(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.support_session_for(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.support_session_for(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.support_session_for(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.support_session_for(_user_id uuid) TO service_role;


--
-- Name: FUNCTION tenant_access_events_immutable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tenant_access_events_immutable() TO anon;
GRANT ALL ON FUNCTION public.tenant_access_events_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.tenant_access_events_immutable() TO service_role;


--
-- Name: FUNCTION tenant_access_grants_after_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tenant_access_grants_after_change() TO anon;
GRANT ALL ON FUNCTION public.tenant_access_grants_after_change() TO authenticated;
GRANT ALL ON FUNCTION public.tenant_access_grants_after_change() TO service_role;


--
-- Name: FUNCTION tenant_access_grants_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tenant_access_grants_before_insert() TO anon;
GRANT ALL ON FUNCTION public.tenant_access_grants_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.tenant_access_grants_before_insert() TO service_role;


--
-- Name: FUNCTION tenant_access_grants_before_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tenant_access_grants_before_update() TO anon;
GRANT ALL ON FUNCTION public.tenant_access_grants_before_update() TO authenticated;
GRANT ALL ON FUNCTION public.tenant_access_grants_before_update() TO service_role;


--
-- Name: FUNCTION tenant_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tenant_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tenant_stats() TO anon;
GRANT ALL ON FUNCTION public.tenant_stats() TO authenticated;
GRANT ALL ON FUNCTION public.tenant_stats() TO service_role;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.uid() TO anon;
GRANT ALL ON FUNCTION public.uid() TO authenticated;
GRANT ALL ON FUNCTION public.uid() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION workflow_transfer_project(_project_id uuid, _to_team text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text) TO anon;
GRANT ALL ON FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text) TO authenticated;
GRANT ALL ON FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text) TO service_role;


--
-- Name: FUNCTION workflow_update_project(_project_id uuid, _patch jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb) TO anon;
GRANT ALL ON FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb) TO service_role;


--
-- Name: TABLE cron_config; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.cron_config TO service_role;


--
-- Name: TABLE activity_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_logs TO anon;
GRANT ALL ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;


--
-- Name: TABLE ai_workflows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_workflows TO anon;
GRANT ALL ON TABLE public.ai_workflows TO authenticated;
GRANT ALL ON TABLE public.ai_workflows TO service_role;


--
-- Name: TABLE api_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.api_keys TO anon;
GRANT ALL ON TABLE public.api_keys TO authenticated;
GRANT ALL ON TABLE public.api_keys TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE brd_responses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.brd_responses TO anon;
GRANT ALL ON TABLE public.brd_responses TO authenticated;
GRANT ALL ON TABLE public.brd_responses TO service_role;


--
-- Name: TABLE brd_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.brd_sessions TO anon;
GRANT ALL ON TABLE public.brd_sessions TO authenticated;
GRANT ALL ON TABLE public.brd_sessions TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE checklist_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_comments TO anon;
GRANT ALL ON TABLE public.checklist_comments TO authenticated;
GRANT ALL ON TABLE public.checklist_comments TO service_role;


--
-- Name: TABLE checklist_form_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_form_assignments TO anon;
GRANT ALL ON TABLE public.checklist_form_assignments TO authenticated;
GRANT ALL ON TABLE public.checklist_form_assignments TO service_role;


--
-- Name: TABLE checklist_form_fields; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_form_fields TO anon;
GRANT ALL ON TABLE public.checklist_form_fields TO authenticated;
GRANT ALL ON TABLE public.checklist_form_fields TO service_role;


--
-- Name: TABLE checklist_form_responses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_form_responses TO anon;
GRANT ALL ON TABLE public.checklist_form_responses TO authenticated;
GRANT ALL ON TABLE public.checklist_form_responses TO service_role;


--
-- Name: TABLE checklist_form_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_form_templates TO anon;
GRANT ALL ON TABLE public.checklist_form_templates TO authenticated;
GRANT ALL ON TABLE public.checklist_form_templates TO service_role;


--
-- Name: TABLE checklist_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_items TO anon;
GRANT ALL ON TABLE public.checklist_items TO authenticated;
GRANT ALL ON TABLE public.checklist_items TO service_role;


--
-- Name: TABLE checklist_meetings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_meetings TO anon;
GRANT ALL ON TABLE public.checklist_meetings TO authenticated;
GRANT ALL ON TABLE public.checklist_meetings TO service_role;


--
-- Name: TABLE checklist_responsibility_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_responsibility_logs TO anon;
GRANT ALL ON TABLE public.checklist_responsibility_logs TO authenticated;
GRANT ALL ON TABLE public.checklist_responsibility_logs TO service_role;


--
-- Name: TABLE checklist_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_tasks TO anon;
GRANT ALL ON TABLE public.checklist_tasks TO authenticated;
GRANT ALL ON TABLE public.checklist_tasks TO service_role;


--
-- Name: TABLE checklist_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_templates TO anon;
GRANT ALL ON TABLE public.checklist_templates TO authenticated;
GRANT ALL ON TABLE public.checklist_templates TO service_role;


--
-- Name: TABLE custom_field_values; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.custom_field_values TO anon;
GRANT ALL ON TABLE public.custom_field_values TO authenticated;
GRANT ALL ON TABLE public.custom_field_values TO service_role;


--
-- Name: TABLE custom_fields; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.custom_fields TO anon;
GRANT ALL ON TABLE public.custom_fields TO authenticated;
GRANT ALL ON TABLE public.custom_fields TO service_role;


--
-- Name: TABLE merchant_portal_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merchant_portal_tokens TO anon;
GRANT ALL ON TABLE public.merchant_portal_tokens TO authenticated;
GRANT ALL ON TABLE public.merchant_portal_tokens TO service_role;


--
-- Name: TABLE merchant_portal_uploads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merchant_portal_uploads TO anon;
GRANT ALL ON TABLE public.merchant_portal_uploads TO authenticated;
GRANT ALL ON TABLE public.merchant_portal_uploads TO service_role;


--
-- Name: TABLE merchant_portal_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merchant_portal_visits TO anon;
GRANT ALL ON TABLE public.merchant_portal_visits TO authenticated;
GRANT ALL ON TABLE public.merchant_portal_visits TO service_role;


--
-- Name: TABLE movement_report_executions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movement_report_executions TO anon;
GRANT ALL ON TABLE public.movement_report_executions TO authenticated;
GRANT ALL ON TABLE public.movement_report_executions TO service_role;


--
-- Name: TABLE movement_report_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movement_report_schedules TO anon;
GRANT ALL ON TABLE public.movement_report_schedules TO authenticated;
GRANT ALL ON TABLE public.movement_report_schedules TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE parsed_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.parsed_emails TO anon;
GRANT ALL ON TABLE public.parsed_emails TO authenticated;
GRANT ALL ON TABLE public.parsed_emails TO service_role;


--
-- Name: TABLE platform_merchants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_merchants TO anon;
GRANT ALL ON TABLE public.platform_merchants TO authenticated;
GRANT ALL ON TABLE public.platform_merchants TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE project_ai_insights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_ai_insights TO anon;
GRANT ALL ON TABLE public.project_ai_insights TO authenticated;
GRANT ALL ON TABLE public.project_ai_insights TO service_role;


--
-- Name: TABLE project_comment_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_comment_logs TO anon;
GRANT ALL ON TABLE public.project_comment_logs TO authenticated;
GRANT ALL ON TABLE public.project_comment_logs TO service_role;


--
-- Name: TABLE project_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_credentials TO anon;
GRANT ALL ON TABLE public.project_credentials TO authenticated;
GRANT ALL ON TABLE public.project_credentials TO service_role;


--
-- Name: TABLE project_email_context; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_email_context TO anon;
GRANT ALL ON TABLE public.project_email_context TO authenticated;
GRANT ALL ON TABLE public.project_email_context TO service_role;


--
-- Name: TABLE project_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_emails TO anon;
GRANT ALL ON TABLE public.project_emails TO authenticated;
GRANT ALL ON TABLE public.project_emails TO service_role;


--
-- Name: TABLE project_jira_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_jira_tickets TO anon;
GRANT ALL ON TABLE public.project_jira_tickets TO authenticated;
GRANT ALL ON TABLE public.project_jira_tickets TO service_role;


--
-- Name: TABLE project_responsibility_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_responsibility_logs TO anon;
GRANT ALL ON TABLE public.project_responsibility_logs TO authenticated;
GRANT ALL ON TABLE public.project_responsibility_logs TO service_role;


--
-- Name: TABLE project_risk_insights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_risk_insights TO anon;
GRANT ALL ON TABLE public.project_risk_insights TO authenticated;
GRANT ALL ON TABLE public.project_risk_insights TO service_role;


--
-- Name: TABLE project_risks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_risks TO anon;
GRANT ALL ON TABLE public.project_risks TO authenticated;
GRANT ALL ON TABLE public.project_risks TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE report_executions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.report_executions TO anon;
GRANT ALL ON TABLE public.report_executions TO authenticated;
GRANT ALL ON TABLE public.report_executions TO service_role;


--
-- Name: TABLE saved_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saved_reports TO anon;
GRANT ALL ON TABLE public.saved_reports TO authenticated;
GRANT ALL ON TABLE public.saved_reports TO service_role;


--
-- Name: TABLE shopify_lt_thread_status; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopify_lt_thread_status TO anon;
GRANT ALL ON TABLE public.shopify_lt_thread_status TO authenticated;
GRANT ALL ON TABLE public.shopify_lt_thread_status TO service_role;


--
-- Name: TABLE shopify_sme_merchants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopify_sme_merchants TO anon;
GRANT ALL ON TABLE public.shopify_sme_merchants TO authenticated;
GRANT ALL ON TABLE public.shopify_sme_merchants TO service_role;


--
-- Name: TABLE signup_leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.signup_leads TO anon;
GRANT ALL ON TABLE public.signup_leads TO authenticated;
GRANT ALL ON TABLE public.signup_leads TO service_role;


--
-- Name: TABLE tat_report_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tat_report_schedules TO anon;
GRANT ALL ON TABLE public.tat_report_schedules TO authenticated;
GRANT ALL ON TABLE public.tat_report_schedules TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE tenant_access_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenant_access_events TO anon;
GRANT ALL ON TABLE public.tenant_access_events TO authenticated;
GRANT ALL ON TABLE public.tenant_access_events TO service_role;


--
-- Name: TABLE tenant_access_grants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenant_access_grants TO anon;
GRANT ALL ON TABLE public.tenant_access_grants TO authenticated;
GRANT ALL ON TABLE public.tenant_access_grants TO service_role;


--
-- Name: TABLE tenant_integrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenant_integrations TO anon;
GRANT ALL ON TABLE public.tenant_integrations TO authenticated;
GRANT ALL ON TABLE public.tenant_integrations TO service_role;


--
-- Name: COLUMN tenant_integrations.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.tenant_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(tenant_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.from_email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(from_email) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.from_name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(from_name) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.reply_to; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(reply_to) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.gmail_monitor_address; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(gmail_monitor_address) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.jira_base_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(jira_base_url) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.jira_email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(jira_email) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.slack_channel; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(slack_channel) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.app_base_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(app_base_url) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.zoom_account_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(zoom_account_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.zoom_client_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(zoom_client_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.teams_tenant_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(teams_tenant_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.teams_client_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(teams_client_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: COLUMN tenant_integrations.google_oauth_client_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(google_oauth_client_id) ON TABLE public.tenant_integrations TO authenticated;


--
-- Name: TABLE tenants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tenants TO anon;
GRANT ALL ON TABLE public.tenants TO authenticated;
GRANT ALL ON TABLE public.tenants TO service_role;


--
-- Name: TABLE transfer_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transfer_history TO anon;
GRANT ALL ON TABLE public.transfer_history TO authenticated;
GRANT ALL ON TABLE public.transfer_history TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: TABLE workflow_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workflow_events TO anon;
GRANT ALL ON TABLE public.workflow_events TO authenticated;
GRANT ALL ON TABLE public.workflow_events TO service_role;


--
-- Name: TABLE workflow_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workflow_runs TO anon;
GRANT ALL ON TABLE public.workflow_runs TO authenticated;
GRANT ALL ON TABLE public.workflow_runs TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict GFoao40BK8njfjdUnwAySYws2ih7ofmzbWPS4odvvdxwreepRYg7QxBDhd6GkOL

