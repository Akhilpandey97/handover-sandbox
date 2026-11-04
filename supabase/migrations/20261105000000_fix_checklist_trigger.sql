-- ─────────────────────────────────────────────────────────────────────────────
-- Fix checklist set trigger bugs
--
-- Bug 1 (in operator): previous trigger used `rule.value::jsonb ? project_val`
-- which is the JSON object-key operator, not array-contains. Replaced with
-- `ANY(SELECT jsonb_array_elements_text(...))` which is unambiguous.
--
-- Bug 2 (null-set fallback): templates with checklist_set_id IS NULL were
-- always seeded regardless of which set matched, flooding every project with
-- every unassigned template. Removed the OR fallback — only templates
-- explicitly assigned to the matched set are seeded.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Skip if already seeded (e.g. on conflict re-insert)
  IF EXISTS (SELECT 1 FROM public.checklist_items WHERE project_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Find the best-matching checklist set for this tenant
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
      -- Read the project field value
      CASE rule.field
        WHEN 'platform'          THEN project_val := NEW.platform;
        WHEN 'category'          THEN project_val := NEW.category;
        WHEN 'integration_type'  THEN project_val := NEW.integration_type;
        WHEN 'pg_onboarding'     THEN project_val := NEW.pg_onboarding;
        ELSE project_val := NULL;
      END CASE;

      -- Evaluate the rule
      CASE rule.operator
        WHEN 'eq' THEN
          IF project_val IS DISTINCT FROM rule.value THEN all_match := false; END IF;
        WHEN 'not_eq' THEN
          IF project_val IS NOT DISTINCT FROM rule.value THEN all_match := false; END IF;
        WHEN 'in' THEN
          -- value is a JSON array e.g. '["Shopify","WooCommerce"]'
          -- Use jsonb_array_elements_text to extract members, then ANY() to test membership
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
        EXIT; -- short-circuit: one rule failed, set doesn't match
      END IF;
    END LOOP;

    -- A set with zero rules is a catch-all (match_count stays 0, all_match = true)
    IF all_match THEN
      IF match_count > best_count
         OR (match_count = best_count AND NOT s.is_default AND best_set_id IS NOT NULL) THEN
        best_count  := match_count;
        best_set_id := s.id;
      END IF;
    END IF;
  END LOOP;

  matched_set_id := best_set_id;

  -- Fall back to the explicit default set if nothing matched
  IF matched_set_id IS NULL THEN
    SELECT id INTO matched_set_id
    FROM public.checklist_sets
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
      AND is_default = true
    ORDER BY sort_order
    LIMIT 1;
  END IF;

  -- Stamp the set on the project
  IF matched_set_id IS NOT NULL THEN
    UPDATE public.projects SET checklist_set_id = matched_set_id WHERE id = NEW.id;
  END IF;

  -- Seed checklist items from matched set's templates only
  -- (templates with NULL checklist_set_id are unassigned and not seeded)
  INSERT INTO public.checklist_items (
    project_id, title, completed, phase, owner_team,
    current_responsibility, sort_order, tenant_id, due_date
  )
  SELECT
    NEW.id,
    t.title,
    false,
    (CASE WHEN t.phase IN ('mint','integration','ms','completed')
          THEN t.phase ELSE 'integration' END)::project_phase,
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
