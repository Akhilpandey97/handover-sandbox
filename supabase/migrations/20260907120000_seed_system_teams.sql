-- Seed the built-in system teams (mint/integration/ms) into public.teams for every
-- existing tenant, so Team Management and useTeams() read consistent DB-backed rows
-- instead of relying on the client-side SYSTEM_TEAMS fallback.
-- Names and colours must stay in sync with SYSTEM_TEAMS in src/hooks/useTeams.ts.
INSERT INTO public.teams (name, slug, color, is_system, sort_order, tenant_id)
SELECT v.name, v.slug, v.color, true, v.sort_order, t.id
FROM public.tenants t
CROSS JOIN (VALUES
  ('Sales', 'mint', '#3b82f6', 0),
  ('MINT', 'integration', '#a855f7', 1),
  ('Merchant Success', 'ms', '#10b981', 2)
) AS v(name, slug, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.teams existing
  WHERE existing.tenant_id = t.id AND existing.slug = v.slug
);
