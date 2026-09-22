-- Support access, hardened.
--
-- 20260910100000_tenant_access_grants.sql made reaching into a customer
-- workspace deliberate. An audit found four gaps, closed here:
--
--   1. A grantee kept their own role inside the customer's workspace. The role
--      helpers read user_roles without regard to tenant, so an admin at home
--      was an admin of the customer too. A grant now carries the role to work
--      with, and the helpers use it for the length of the session.
--   2. The record could be rewritten: super admins could edit or delete grants,
--      granted_by came from the client, and the log lines were written by the
--      browser into the grantee's own tenant. Grants are now append-only apart
--      from revocation, and every grant, revocation, entry and exit is written
--      by the database into the customer's workspace.
--   3. Activity logged during a session landed in the grantee's home tenant.
--   4. profiles.active_tenant_id and tenant_id relied on RLS alone, where any
--      broader "update own profile" policy would bypass the check.
--
-- Nothing changes for anyone who is not in a support session.

-- ── 1. Keep the current role helpers as *_home ──────────────────────────────
-- Existing policies reference these functions by OID, so they can only be
-- changed in place. Their live bodies are copied first, verbatim, so the
-- wrappers below fall back to exactly what runs today.
DO $$
DECLARE
  fname text;
  def text;
BEGIN
  FOREACH fname IN ARRAY ARRAY['is_manager', 'is_tenant_admin', 'is_gokwik_general', 'get_user_role'] LOOP
    CONTINUE WHEN to_regprocedure(format('public.%I(uuid)', fname)) IS NULL;
    -- Already copied on an earlier run: the original now holds the wrapper.
    CONTINUE WHEN to_regprocedure(format('public.%I(uuid)', fname || '_home')) IS NOT NULL;

    def := pg_get_functiondef(to_regprocedure(format('public.%I(uuid)', fname)));
    def := regexp_replace(def, 'FUNCTION public\.' || fname || '\(', 'FUNCTION public.' || fname || '_home(');
    IF position(fname || '_home(' IN def) = 0 THEN
      RAISE EXCEPTION 'Could not copy public.%', fname;
    END IF;
    EXECUTE def;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(uuid) FROM PUBLIC, anon, authenticated', fname || '_home');
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(uuid) TO service_role', fname || '_home');
  END LOOP;
END $$;

-- ── 2. The role a grant allows ──────────────────────────────────────────────
ALTER TABLE public.tenant_access_grants ADD COLUMN IF NOT EXISTS role text;

-- Grants opened before this carried the grantee's own role in practice, so
-- that is what they keep. 'none' marks a grantee who had no role at all.
UPDATE public.tenant_access_grants g
SET role = COALESCE(
  (
    SELECT ur.role::text
    FROM public.user_roles ur
    WHERE ur.user_id = g.granted_to
    ORDER BY CASE ur.role::text
      WHEN 'super_admin' THEN 0 WHEN 'superadmin' THEN 0
      WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END
    LIMIT 1
  ),
  public.get_user_role_home(g.granted_to)::text,
  'none'
)
WHERE g.role IS NULL;

ALTER TABLE public.tenant_access_grants ALTER COLUMN role SET DEFAULT 'manager';
ALTER TABLE public.tenant_access_grants ALTER COLUMN role SET NOT NULL;

-- ── 3. The live session, resolved in one place ──────────────────────────────
CREATE OR REPLACE FUNCTION public._is_platform_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('super_admin', 'superadmin')
  )
  OR COALESCE(public.get_user_role_home(_user_id)::text, '') IN ('super_admin', 'superadmin')
$$;

/**
 * The support session a person is in right now, if any. applies_role is false
 * for super admins: their reach is already global and a grant must never
 * narrow what they can do.
 */
CREATE OR REPLACE FUNCTION public.support_session_for(_user_id uuid)
RETURNS TABLE (
  grant_id uuid,
  tenant_id uuid,
  home_tenant_id uuid,
  role text,
  applies_role boolean,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- The role that replaces the person's own for the session, or null.
CREATE OR REPLACE FUNCTION public._support_grant_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NULLIF(s.role, 'none')
  FROM public.support_session_for(_user_id) s
  WHERE s.applies_role
$$;

-- The caller's own session, for the app. Never another person's.
CREATE OR REPLACE FUNCTION public.my_support_session()
RETURNS TABLE (grant_id uuid, tenant_id uuid, role text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.grant_id, s.tenant_id,
         CASE WHEN s.applies_role THEN NULLIF(s.role, 'none') END,
         s.expires_at
  FROM public.support_session_for(auth.uid()) s
$$;

REVOKE ALL ON FUNCTION public._is_platform_super_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_session_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._support_grant_role(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_platform_super_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.support_session_for(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._support_grant_role(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.my_support_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_support_session() TO authenticated, service_role;

-- ── 4. Role helpers honour the grant's role during a session ────────────────
-- Signatures and return types are read from the live functions so the
-- replacement is exact. Outside a session each one returns its *_home copy.
DO $$
DECLARE
  spec record;
  fn regprocedure;
  args text;
  argname text;
  ret text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('is_manager',        'CASE WHEN r IS NULL THEN public.is_manager_home(%1$s) ELSE r IN (''manager'', ''admin'') END'),
      ('is_tenant_admin',   'CASE WHEN r IS NULL THEN public.is_tenant_admin_home(%1$s) ELSE r = ''admin'' END'),
      ('is_gokwik_general', 'CASE WHEN r IS NULL THEN public.is_gokwik_general_home(%1$s) ELSE r = ''gokwik_general'' END'),
      ('get_user_role',     'CASE WHEN r IS NULL THEN public.get_user_role_home(%1$s) ELSE r::%2$s END')
    ) AS t(fname, template)
  LOOP
    fn := to_regprocedure(format('public.%I(uuid)', spec.fname));
    IF fn IS NULL OR to_regprocedure(format('public.%I(uuid)', spec.fname || '_home')) IS NULL THEN
      RAISE NOTICE 'public.% not found; left unchanged', spec.fname;
      CONTINUE;
    END IF;

    args := pg_get_function_arguments(fn);
    argname := split_part(btrim(args), ' ', 1);
    IF argname = 'uuid' THEN argname := '$1'; END IF;
    ret := pg_get_function_result(fn);

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql STABLE SECURITY DEFINER '
      'SET search_path TO ''public'' AS $fn$ SELECT %s FROM public._support_grant_role(%s) AS r $fn$',
      spec.fname, args, ret, format(spec.template, argname, ret), argname
    );
  END LOOP;
END $$;

-- ── 5. The access record: append-only, written by the database ──────────────
CREATE TABLE IF NOT EXISTS public.tenant_access_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id        uuid,
  tenant_id       uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  subject_name    text,
  actor_user_id   uuid,
  actor_name      text,
  event           text NOT NULL CHECK (event IN ('granted', 'revoked', 'entered', 'left')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- No foreign key to tenants: the record should outlive the thing it is about.
CREATE INDEX IF NOT EXISTS tenant_access_events_tenant_idx
  ON public.tenant_access_events (tenant_id, created_at DESC);

ALTER TABLE public.tenant_access_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_access_events FROM anon, authenticated;
GRANT SELECT ON public.tenant_access_events TO authenticated;
GRANT SELECT ON public.tenant_access_events TO service_role;

DROP POLICY IF EXISTS "Super admins read access events" ON public.tenant_access_events;
CREATE POLICY "Super admins read access events"
  ON public.tenant_access_events FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Tenant members read access events on their workspace" ON public.tenant_access_events;
CREATE POLICY "Tenant members read access events on their workspace"
  ON public.tenant_access_events FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Users read their own access events" ON public.tenant_access_events;
CREATE POLICY "Users read their own access events"
  ON public.tenant_access_events FOR SELECT TO authenticated
  USING (subject_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.tenant_access_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Support access events are a permanent record';
END $$;

DROP TRIGGER IF EXISTS tenant_access_events_immutable ON public.tenant_access_events;
CREATE TRIGGER tenant_access_events_immutable
  BEFORE UPDATE OR DELETE ON public.tenant_access_events
  FOR EACH ROW EXECUTE FUNCTION public.tenant_access_events_immutable();

/**
 * Writes one event, and mirrors it into the customer's activity log so the
 * people whose workspace it is can see it where they already look. The mirror
 * is best-effort; the event row is not.
 */
CREATE OR REPLACE FUNCTION public._log_support_access(
  _grant_id uuid,
  _tenant_id uuid,
  _subject uuid,
  _event text,
  _detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public._log_support_access(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6. Grants: super admins open and revoke; nobody edits or deletes ────────
DROP POLICY IF EXISTS "Super admins manage access grants" ON public.tenant_access_grants;

DROP POLICY IF EXISTS "Super admins read access grants" ON public.tenant_access_grants;
CREATE POLICY "Super admins read access grants"
  ON public.tenant_access_grants FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins open access grants" ON public.tenant_access_grants;
CREATE POLICY "Super admins open access grants"
  ON public.tenant_access_grants FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins revoke access grants" ON public.tenant_access_grants;
CREATE POLICY "Super admins revoke access grants"
  ON public.tenant_access_grants FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

REVOKE DELETE, TRUNCATE ON public.tenant_access_grants FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenant_access_grants_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Who opened it is whoever is signed in, not what the client says.
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
  -- 30 days, with a day of slack for the client's clock.
  IF NEW.expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION 'Support access can last at most 30 days';
  END IF;

  SELECT tenant_id INTO grantee_tenant FROM public.profiles WHERE id = NEW.granted_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The person receiving access has no account';
  END IF;

  -- A grant into someone's own workspace would only raise their role there,
  -- sidestepping user management.
  IF grantee_tenant = NEW.tenant_id THEN
    RAISE EXCEPTION 'That person already belongs to this workspace; change their role under Users instead';
  END IF;

  -- Access goes to your own staff, never to a member of another customer.
  SELECT tenant_id INTO granter_tenant FROM public.profiles WHERE id = granter;
  IF NEW.granted_to <> granter
     AND grantee_tenant IS DISTINCT FROM granter_tenant
     AND NOT public._is_platform_super_admin(NEW.granted_to) THEN
    RAISE EXCEPTION 'Support access can only be given to members of your own workspace';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tenant_access_grants_before_update()
RETURNS trigger
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

  -- The time of revocation is the server's, not the client's.
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tenant_access_grants_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._log_support_access(NEW.id, NEW.tenant_id, NEW.granted_to, 'granted',
      jsonb_build_object('role', NEW.role, 'reason', NEW.reason, 'expires_at', NEW.expires_at));
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM public._log_support_access(NEW.id, NEW.tenant_id, NEW.granted_to, 'revoked',
      jsonb_build_object('role', NEW.role));

    -- Revoking ends the session it was carrying, unless another live grant
    -- still covers the same workspace.
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

DROP TRIGGER IF EXISTS tenant_access_grants_before_insert ON public.tenant_access_grants;
CREATE TRIGGER tenant_access_grants_before_insert
  BEFORE INSERT ON public.tenant_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_before_insert();

DROP TRIGGER IF EXISTS tenant_access_grants_before_update ON public.tenant_access_grants;
CREATE TRIGGER tenant_access_grants_before_update
  BEFORE UPDATE ON public.tenant_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_before_update();

DROP TRIGGER IF EXISTS tenant_access_grants_after_change ON public.tenant_access_grants;
CREATE TRIGGER tenant_access_grants_after_change
  AFTER INSERT OR UPDATE ON public.tenant_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tenant_access_grants_after_change();

-- ── 7. Profiles: guard the fields that decide which workspace you are in ────
-- Enforced by trigger, not RLS, so no other UPDATE policy on profiles can
-- route around it. Only direct client requests are checked; the server and
-- database functions behave as before.
CREATE OR REPLACE FUNCTION public.profiles_guard_support_fields()
RETURNS trigger
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

CREATE OR REPLACE FUNCTION public.profiles_log_support_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS profiles_guard_support_fields ON public.profiles;
CREATE TRIGGER profiles_guard_support_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_support_fields();

DROP TRIGGER IF EXISTS profiles_log_support_session ON public.profiles;
CREATE TRIGGER profiles_log_support_session
  AFTER UPDATE OF active_tenant_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_log_support_session();

-- ── 8. Activity during a session lands in the customer's workspace ──────────
-- The browser logs with the person's home tenant. While a session is open,
-- move the row to the workspace they are actually working in and mark it, so
-- the customer can tell support activity from their own team's. Server rows
-- already written against the session tenant are marked too.
CREATE OR REPLACE FUNCTION public.activity_logs_attribute_support()
RETURNS trigger
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

DROP TRIGGER IF EXISTS activity_logs_attribute_support ON public.activity_logs;
CREATE TRIGGER activity_logs_attribute_support
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.activity_logs_attribute_support();
