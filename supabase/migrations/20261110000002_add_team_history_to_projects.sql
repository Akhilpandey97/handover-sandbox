-- Add team_history to projects: an accumulated array of every team that has
-- ever owned this project. Used for "projects I worked on" across dashboard views.

-- 1. Add the column, default to current owner
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS team_history text[] NOT NULL DEFAULT '{}';

-- 2. Backfill: for each project, collect all distinct teams from transfer_history
--    (both from_team and to_team) plus the current owner
UPDATE public.projects p
SET team_history = (
  SELECT array_agg(DISTINCT t) FROM (
    SELECT p.current_owner_team AS t
    UNION
    SELECT from_team FROM public.transfer_history WHERE project_id = p.id
    UNION
    SELECT to_team   FROM public.transfer_history WHERE project_id = p.id
  ) sub
  WHERE t IS NOT NULL
);

-- 3. Trigger function: append new team to history on team change
CREATE OR REPLACE FUNCTION public.projects_track_team_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.current_owner_team IS DISTINCT FROM OLD.current_owner_team
     AND NEW.current_owner_team IS NOT NULL THEN
    NEW.team_history := array_append(
      COALESCE(OLD.team_history, '{}'),
      NEW.current_owner_team
    );
    -- deduplicate
    NEW.team_history := ARRAY(SELECT DISTINCT unnest(NEW.team_history));
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger (BEFORE UPDATE so NEW can be mutated)
DROP TRIGGER IF EXISTS projects_track_team_history ON public.projects;
CREATE TRIGGER projects_track_team_history
  BEFORE UPDATE OF current_owner_team ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_track_team_history();
