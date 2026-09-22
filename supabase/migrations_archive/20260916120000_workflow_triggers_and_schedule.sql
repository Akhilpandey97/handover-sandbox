-- Automations that could be saved but never ran.
--
-- Settings → Workflows offers a "Checklist completed" event, but nothing ever
-- queued one: only the projects trigger fed workflow_events. And the runner
-- itself was never scheduled, so rules only fired when someone changed a
-- project in the app (which calls run-workflows straight after) — a change from
-- Buddy, the CRM API, an email import or the SQL editor waited indefinitely, and
-- time-based and "go-live date passed" rules, which have no change to react to,
-- never ran at all.

-- ── Checklist completed ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.checklist_items_enqueue_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.workflow_run', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Only the moment an item becomes done: not re-saves of a done item, and
  -- not sub-tasks, which are not checklist steps.
  IF coalesce(NEW.completed, false) AND NOT coalesce(OLD.completed, false) AND NOT coalesce(NEW.is_task, false) THEN
    INSERT INTO public.workflow_events (tenant_id, project_id, event_name, old_row, new_row)
    VALUES (NEW.tenant_id, NEW.project_id, 'checklist_completed', to_jsonb(OLD), to_jsonb(NEW));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_items_enqueue_workflow_event_upd ON public.checklist_items;
CREATE TRIGGER checklist_items_enqueue_workflow_event_upd
  AFTER UPDATE OF completed ON public.checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.checklist_items_enqueue_workflow_event();

REVOKE EXECUTE ON FUNCTION public.checklist_items_enqueue_workflow_event() FROM anon, authenticated, PUBLIC;

-- ── Scheduler ───────────────────────────────────────────────────────────────
-- Every 10 minutes: drains queued events and runs time-based and "go-live date
-- passed" rules. Uses the same helper and token as the other app jobs.
SELECT private.schedule_app_job('app-run-workflows', '*/10 * * * *', 'run-workflows');
