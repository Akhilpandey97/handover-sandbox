-- ─────────────────────────────────────────────────────────────────────────────
-- Migrate orphaned checklist templates into each tenant's default checklist set
--
-- Templates added via the old "Checklist" settings tab have checklist_set_id = NULL.
-- The seed trigger (fixed in 20261105000000) no longer seeds these, so new projects
-- get empty checklists when no assigned set exists.
--
-- This migration:
--   1. For each tenant, finds their default checklist set (is_default = true,
--      or the first set by sort_order if no default is flagged).
--   2. If none exists, creates a "Default" set for that tenant.
--   3. Assigns all orphaned templates (checklist_set_id IS NULL) to that set.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t_tenant_id  uuid;
  t_set_id     uuid;
BEGIN
  -- Iterate over every tenant that has at least one orphaned template
  FOR t_tenant_id IN
    SELECT DISTINCT tenant_id
    FROM public.checklist_templates
    WHERE checklist_set_id IS NULL
  LOOP
    -- Find this tenant's default set
    SELECT id INTO t_set_id
    FROM public.checklist_sets
    WHERE tenant_id IS NOT DISTINCT FROM t_tenant_id
      AND is_default = true
    ORDER BY sort_order
    LIMIT 1;

    -- No default set found — fall back to any set
    IF t_set_id IS NULL THEN
      SELECT id INTO t_set_id
      FROM public.checklist_sets
      WHERE tenant_id IS NOT DISTINCT FROM t_tenant_id
      ORDER BY sort_order
      LIMIT 1;
    END IF;

    -- Still none — create a Default set for this tenant
    IF t_set_id IS NULL THEN
      INSERT INTO public.checklist_sets (tenant_id, name, description, is_default, sort_order)
      VALUES (t_tenant_id, 'Default', 'Standard checklist applied to all projects.', true, 0)
      RETURNING id INTO t_set_id;
    END IF;

    -- Assign all orphaned templates for this tenant to the resolved set
    UPDATE public.checklist_templates
    SET checklist_set_id = t_set_id
    WHERE checklist_set_id IS NULL
      AND tenant_id IS NOT DISTINCT FROM t_tenant_id;
  END LOOP;
END;
$$;
