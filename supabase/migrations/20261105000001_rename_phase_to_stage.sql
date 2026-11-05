-- ─────────────────────────────────────────────────────────────────────────────
-- Rename every "phase" concept to "stage" across the schema.
--
-- Changes:
--   enum  project_phase  →  project_stage
--   checklist_items.phase              → .stage
--   checklist_templates.phase          → .stage
--   projects.current_phase             → .current_stage
--   projects.current_phase_comment     → .current_stage_comment
--   projects.phase2_comment            → .stage2_comment
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rename the enum type
ALTER TYPE public.project_phase RENAME TO project_stage;

-- 2. checklist_items
ALTER TABLE public.checklist_items RENAME COLUMN phase TO stage;

-- 3. checklist_templates
ALTER TABLE public.checklist_templates RENAME COLUMN phase TO stage;

-- 4. projects
ALTER TABLE public.projects RENAME COLUMN current_phase             TO current_stage;
ALTER TABLE public.projects RENAME COLUMN current_phase_comment     TO current_stage_comment;
ALTER TABLE public.projects RENAME COLUMN phase2_comment            TO stage2_comment;

-- 5. Re-create the seed trigger so it references the renamed column + enum
CREATE OR REPLACE FUNCTION public.seed_project_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  matched_set_id uuid;
  project_val    text;
  all_match      boolean;
  match_count    int;
  best_count     int := -1;
  best_set_id    uuid;
  s              RECORD;
  rule           RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.checklist_items WHERE project_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  FOR s IN
    SELECT id, is_default, sort_order
    FROM public.checklist_sets
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    ORDER BY sort_order
  LOOP
    match_count := 0;
    all_match   := true;

    FOR rule IN
      SELECT field, operator, value
      FROM public.checklist_set_rules
      WHERE checklist_set_id = s.id
    LOOP
      CASE rule.field
        WHEN 'platform'          THEN project_val := NEW.platform;
        WHEN 'category'          THEN project_val := NEW.category;
        WHEN 'integration_type'  THEN project_val := NEW.integration_type;
        WHEN 'pg_onboarding'     THEN project_val := NEW.pg_onboarding;
        ELSE project_val := NULL;
      END CASE;

      CASE rule.operator
        WHEN 'eq' THEN
          IF project_val IS DISTINCT FROM rule.value THEN all_match := false; END IF;
        WHEN 'not_eq' THEN
          IF project_val IS NOT DISTINCT FROM rule.value THEN all_match := false; END IF;
        WHEN 'in' THEN
          IF NOT (COALESCE(project_val, '') = ANY(
            SELECT jsonb_array_elements_text(rule.value::jsonb)
          )) THEN
            all_match := false;
          END IF;
        ELSE
          all_match := false;
      END CASE;

      IF all_match THEN
        match_count := match_count + 1;
      ELSE
        EXIT;
      END IF;
    END LOOP;

    IF all_match THEN
      IF match_count > best_count
         OR (match_count = best_count AND NOT s.is_default AND best_set_id IS NOT NULL) THEN
        best_count  := match_count;
        best_set_id := s.id;
      END IF;
    END IF;
  END LOOP;

  matched_set_id := best_set_id;

  IF matched_set_id IS NULL THEN
    SELECT id INTO matched_set_id
    FROM public.checklist_sets
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
      AND is_default = true
    ORDER BY sort_order
    LIMIT 1;
  END IF;

  IF matched_set_id IS NOT NULL THEN
    UPDATE public.projects SET checklist_set_id = matched_set_id WHERE id = NEW.id;
  END IF;

  INSERT INTO public.checklist_items (
    project_id, title, completed, stage, owner_team,
    current_responsibility, sort_order, tenant_id, due_date
  )
  SELECT
    NEW.id,
    t.title,
    false,
    (CASE WHEN t.stage IN ('mint','integration','ms','completed')
          THEN t.stage ELSE 'integration' END)::project_stage,
    t.owner_team,
    'neutral'::responsibility_party,
    COALESCE(t.sort_order, 0),
    NEW.tenant_id,
    CASE WHEN t.standard_duration IS NOT NULL AND t.standard_duration > 0
         THEN (NEW.kick_off_date + (t.standard_duration || ' days')::interval)::date
         ELSE NULL END
  FROM public.checklist_templates t
  WHERE t.checklist_set_id = matched_set_id
  ORDER BY t.sort_order;

  RETURN NEW;
END;
$$;
