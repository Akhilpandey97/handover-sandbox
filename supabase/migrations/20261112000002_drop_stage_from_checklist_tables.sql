-- Drop the `stage` column from checklist_items and checklist_templates.
-- `stage` was originally a denormalized copy of owner_team (a project_phase enum).
-- It was always redundant with owner_team and is no longer used anywhere in the app.
-- owner_team is the authoritative grouping field going forward.
--
-- Also rewrites the seed_project_checklist trigger body to stop referencing
-- the now-dropped column (the previous body still used the old `phase` alias).

-- 1. Drop the column from both tables
ALTER TABLE public.checklist_items     DROP COLUMN IF EXISTS stage;
ALTER TABLE public.checklist_templates DROP COLUMN IF EXISTS stage;

-- 2. Rewrite the seed trigger to not insert stage
CREATE OR REPLACE FUNCTION public.seed_project_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  matched_set_id uuid;
  rule            record;
  match_found     boolean;
BEGIN
  -- ── 1. Find the best matching checklist set ───────────────────────────────
  FOR rule IN
    SELECT DISTINCT csr.checklist_set_id
    FROM public.checklist_set_rules csr
    JOIN public.checklist_sets cs ON cs.id = csr.checklist_set_id
    WHERE cs.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    GROUP BY csr.checklist_set_id
    HAVING bool_and(
      CASE csr.operator
        WHEN 'eq'     THEN (to_jsonb(NEW) ->> csr.field) = csr.value
        WHEN 'not_eq' THEN (to_jsonb(NEW) ->> csr.field) != csr.value
        WHEN 'in'     THEN (to_jsonb(NEW) ->> csr.field) = ANY(string_to_array(csr.value, ','))
        ELSE false
      END
    )
  LOOP
    matched_set_id := rule.checklist_set_id;
    EXIT;
  END LOOP;

  -- ── 2. Fall back to the default set ──────────────────────────────────────
  IF matched_set_id IS NULL THEN
    SELECT id INTO matched_set_id
    FROM public.checklist_sets
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
      AND is_default = true
    ORDER BY sort_order
    LIMIT 1;
  END IF;

  -- ── 3. Stamp the set on the project ──────────────────────────────────────
  IF matched_set_id IS NOT NULL THEN
    UPDATE public.projects SET checklist_set_id = matched_set_id WHERE id = NEW.id;
  END IF;

  -- ── 4. Seed checklist items (no stage column) ─────────────────────────────
  INSERT INTO public.checklist_items (
    project_id, title, completed, owner_team,
    current_responsibility, sort_order, tenant_id, due_date
  )
  SELECT
    NEW.id,
    t.title,
    false,
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
