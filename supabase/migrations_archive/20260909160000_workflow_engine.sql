-- Workflow execution engine.
--
-- ai_workflows has existed as configuration with no runtime: rules were stored,
-- shown as Active and counted, but nothing ever read one to act on it. This adds
-- the pieces that make a rule fire — a queue of project changes, a runner's
-- history, and guarded functions for the writes a workflow performs.

-- ── Queue ───────────────────────────────────────────────────────────────────
-- A trigger records every project change here, so a rule fires no matter how the
-- row changed: the app, the SQL editor, a CSV import or an AI action.
CREATE TABLE IF NOT EXISTS public.workflow_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  project_id   uuid NOT NULL,
  event_name   text NOT NULL,
  old_row      jsonb,
  new_row      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

-- The drain is always "oldest unprocessed first".
CREATE INDEX IF NOT EXISTS workflow_events_pending_idx
  ON public.workflow_events (processed_at, created_at);

-- ── History ─────────────────────────────────────────────────────────────────
-- Without this there is no way to tell whether a workflow ever ran, which is
-- most of why the feature's silence went unnoticed for so long.
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.ai_workflows(id) ON DELETE CASCADE,
  tenant_id   uuid,
  project_id  uuid,
  event_id    uuid,
  status      text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx
  ON public.workflow_runs (workflow_id, created_at DESC);

-- ── Enqueue trigger ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.projects_enqueue_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event text;
BEGIN
  -- A workflow's own writes must not enqueue more work, or an update_field
  -- action feeding a field_change rule would recurse. Same guard the EGL
  -- triggers use for app.egl_auto.
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
    -- Nothing a workflow can watch changed; do not queue noise.
    RETURN NEW;
  END IF;

  INSERT INTO public.workflow_events (tenant_id, project_id, event_name, old_row, new_row)
  VALUES (
    NEW.tenant_id,
    NEW.id,
    _event,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_enqueue_workflow_event_ins ON public.projects;
CREATE TRIGGER projects_enqueue_workflow_event_ins
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_enqueue_workflow_event();

DROP TRIGGER IF EXISTS projects_enqueue_workflow_event_upd ON public.projects;
CREATE TRIGGER projects_enqueue_workflow_event_upd
  AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_enqueue_workflow_event();

-- ── Guarded action functions ────────────────────────────────────────────────
-- The guard has to be set inside the same transaction as the write. PostgREST
-- gives each request its own transaction, so a set_config sent as a separate
-- call would not cover the update — hence a function rather than two statements.

CREATE OR REPLACE FUNCTION public.workflow_update_project(_project_id uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.workflow_run', 'on', true);

  UPDATE public.projects p
  SET
    assigned_owner        = COALESCE((_patch->>'assigned_owner')::uuid, p.assigned_owner),
    -- Both are enums. ->> yields text, and COALESCE will not mix the two, so
    -- the cast is required — and because a SET clause evaluates every
    -- assignment, missing it broke every action, not just these fields.
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
END;
$$;

CREATE OR REPLACE FUNCTION public.workflow_transfer_project(_project_id uuid, _to_team text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_team text;
  _tenant    uuid;
  _owner     uuid;
BEGIN
  SELECT current_owner_team, tenant_id, assigned_owner
    INTO _from_team, _tenant, _owner
  FROM public.projects WHERE id = _project_id;

  IF _from_team IS NULL OR _from_team = _to_team THEN
    RETURN;
  END IF;

  PERFORM set_config('app.workflow_run', 'on', true);

  -- Mirrors useTransferProject: the receiving team has to accept.
  UPDATE public.projects
  SET current_owner_team = _to_team,
      pending_acceptance = true,
      updated_at = now()
  WHERE id = _project_id;

  INSERT INTO public.transfer_history (project_id, tenant_id, from_team, to_team, transferred_by, notes)
  VALUES (_project_id, _tenant, _from_team, _to_team, _owner, 'Transferred by workflow');

  PERFORM set_config('app.workflow_run', 'off', true);
END;
$$;

-- ── Access ──────────────────────────────────────────────────────────────────
ALTER TABLE public.workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs   ENABLE ROW LEVEL SECURITY;

-- The queue is machinery: only the runner (service role) touches it.
REVOKE ALL ON public.workflow_events FROM anon, authenticated;

-- History is shown in Settings → Workflows, so tenant members may read it.
REVOKE INSERT, UPDATE, DELETE ON public.workflow_runs FROM anon, authenticated;
DROP POLICY IF EXISTS "Tenant members read workflow runs" ON public.workflow_runs;
CREATE POLICY "Tenant members read workflow runs"
  ON public.workflow_runs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

-- Trigger-only and runner-only routines are not callable from the Data API.
REVOKE EXECUTE ON FUNCTION public.projects_enqueue_workflow_event() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workflow_update_project(uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workflow_transfer_project(uuid, text) FROM anon, authenticated, PUBLIC;
