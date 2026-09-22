-- Store the expected go-live date instead of deriving it in the browser.
--
-- Until now a project with no date got one computed client-side from the latest
-- checklist due date. That value was never written back, so reports and the API
-- saw nothing, and it moved silently whenever a due date changed. This makes it
-- real data that follows the checklist while it is automatic, and stops the
-- moment somebody sets the date themselves.

-- 1. Which projects own their date.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS expected_go_live_is_manual boolean NOT NULL DEFAULT false;

-- Every date that exists today was typed by a person, imported or set via the
-- API, so nothing already on screen starts moving when this ships.
UPDATE public.projects
SET expected_go_live_is_manual = true
WHERE expected_go_live_date IS NOT NULL
  AND expected_go_live_is_manual = false;

-- 2. Recompute one project's automatic date from its checklist.
CREATE OR REPLACE FUNCTION public.recompute_expected_go_live(_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- 3. Any change to a checklist due date re-derives the project's date.
CREATE OR REPLACE FUNCTION public.checklist_items_sync_egl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_expected_go_live(OLD.project_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_expected_go_live(NEW.project_id);

  -- An item moved between projects leaves the old one to re-derive too.
  IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    PERFORM public.recompute_expected_go_live(OLD.project_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_items_sync_egl ON public.checklist_items;
CREATE TRIGGER checklist_items_sync_egl
AFTER INSERT OR DELETE OR UPDATE OF due_date, is_task, project_id
ON public.checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.checklist_items_sync_egl();

-- 4. Setting the date by hand takes ownership; clearing it hands it back.
CREATE OR REPLACE FUNCTION public.projects_mark_manual_egl()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.expected_go_live_is_manual := NEW.expected_go_live_date IS NOT NULL;
    RETURN NEW;
  END IF;

  -- Skip our own recompute; anything else touching the column is a person.
  IF coalesce(current_setting('app.egl_auto', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.expected_go_live_date IS DISTINCT FROM OLD.expected_go_live_date THEN
    NEW.expected_go_live_is_manual := NEW.expected_go_live_date IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_mark_manual_egl_ins ON public.projects;
CREATE TRIGGER projects_mark_manual_egl_ins
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.projects_mark_manual_egl();

DROP TRIGGER IF EXISTS projects_mark_manual_egl_upd ON public.projects;
CREATE TRIGGER projects_mark_manual_egl_upd
BEFORE UPDATE OF expected_go_live_date ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.projects_mark_manual_egl();

-- 5. Clearing a manual date should refill it immediately, not wait for the next
-- checklist edit.
CREATE OR REPLACE FUNCTION public.projects_refill_auto_egl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.expected_go_live_is_manual = false AND NEW.expected_go_live_date IS NULL THEN
    PERFORM public.recompute_expected_go_live(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_refill_auto_egl ON public.projects;
CREATE TRIGGER projects_refill_auto_egl
AFTER UPDATE OF expected_go_live_date ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.projects_refill_auto_egl();

-- 6. Backfill the projects that have no date, from their existing checklists.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.projects
    WHERE expected_go_live_is_manual = false AND expected_go_live_date IS NULL
  LOOP
    PERFORM public.recompute_expected_go_live(r.id);
  END LOOP;
END;
$$;
