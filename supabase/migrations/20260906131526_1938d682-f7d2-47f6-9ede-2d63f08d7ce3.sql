-- Seed system teams per tenant, carrying over any names set in app_settings
INSERT INTO public.teams (name, slug, color, is_system, is_active, sort_order, tenant_id)
SELECT
  COALESCE((SELECT s.value FROM public.app_settings s
            WHERE s.tenant_id = t.id AND s.key = d.setting_key), d.default_name),
  d.slug, d.color, true, true, d.sort_order, t.id
FROM public.tenants t
CROSS JOIN (VALUES
  ('mint', 'team_mint', 'Sales', '#3b82f6', 0),
  ('integration', 'team_integration', 'MINT', '#a855f7', 1),
  ('ms', 'team_ms', 'Merchant Success', '#10b981', 2)
) AS d(slug, setting_key, default_name, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.teams x WHERE x.tenant_id = t.id AND x.slug = d.slug
);

-- The old duplicate editor is being removed; drop its rows
DELETE FROM public.app_settings WHERE key IN ('team_mint','team_integration','team_ms','team_manager');