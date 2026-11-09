-- Fix projects_enqueue_workflow_event: references OLD/NEW.current_phase which was
-- renamed to current_stage in 20261105000001_rename_phase_to_stage.sql.
-- Without this fix any UPDATE on a project row throws:
--   "record \"new\" has no field \"current_phase\""

CREATE OR REPLACE FUNCTION public.projects_enqueue_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _event text;
BEGIN
  -- A workflow's own writes must not enqueue more work.
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
     OR NEW.current_stage IS DISTINCT FROM OLD.current_stage
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
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          to_jsonb(NEW));
  RETURN NEW;
END;
$$;
