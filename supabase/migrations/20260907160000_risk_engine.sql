-- Risk engine: activity signal, auto-row dedupe, and AI explanation cache.

-- 1. Last checklist-comment per project.
-- checklist_comments only references checklist_item_id, and PostgREST cannot do
-- a grouped max() through an embedded join, so expose it as a function rather
-- than fetching every comment row and reducing client-side.
CREATE OR REPLACE FUNCTION public.project_last_activity(_tenant_id uuid)
RETURNS TABLE (project_id uuid, last_comment_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ci.project_id, max(cc.created_at) AS last_comment_at
  FROM public.checklist_comments cc
  JOIN public.checklist_items ci ON ci.id = cc.checklist_item_id
  WHERE ci.tenant_id = _tenant_id
  GROUP BY ci.project_id;
$$;

GRANT EXECUTE ON FUNCTION public.project_last_activity(uuid) TO authenticated, service_role;

-- 2. One open auto-row per (project, rule).
-- The cron writes with the service role and the browser with the user's key;
-- nothing currently enforces the project_id::trigger_rule convention.
CREATE UNIQUE INDEX IF NOT EXISTS project_risks_auto_open_idx
  ON public.project_risks (project_id, trigger_rule)
  WHERE trigger_type = 'auto' AND status <> 'resolved' AND status <> 'dismissed';

-- 3. AI explanation cache, keyed by a hash of the findings so an unchanged
-- verdict is never re-generated.
CREATE TABLE IF NOT EXISTS public.project_risk_insights (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id),
  findings_hash text NOT NULL,
  why text NOT NULL,
  recommendation text NOT NULL,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_risk_insights TO authenticated;
GRANT ALL ON public.project_risk_insights TO service_role;

ALTER TABLE public.project_risk_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read risk insights" ON public.project_risk_insights;
CREATE POLICY "Tenant members read risk insights" ON public.project_risk_insights
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Tenant members write risk insights" ON public.project_risk_insights;
CREATE POLICY "Tenant members write risk insights" ON public.project_risk_insights
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
