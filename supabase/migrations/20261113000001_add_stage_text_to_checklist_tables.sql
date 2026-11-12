-- Add free-form `stage` text column to checklist tables.
-- Stage is now a user-defined string (e.g. "Discovery", "Build", "UAT")
-- set at the template level and seeded into checklist items.
-- It is nullable — items without a stage fall under an "Ungrouped" bucket in the UI.

ALTER TABLE public.checklist_templates ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE public.checklist_items     ADD COLUMN IF NOT EXISTS stage text;

-- Rewrite seed trigger to carry stage from template → item
CREATE OR REPLACE FUNCTION public.seed_project_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  matched_set_id uuid;
  rule            record;
BEGIN
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
    project_id, title, completed, owner_team, stage,
    current_responsibility, sort_order, tenant_id, due_date
  )
  SELECT
    NEW.id,
    t.title,
    false,
    t.owner_team,
    t.stage,
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
