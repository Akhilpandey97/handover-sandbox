ALTER TABLE public.project_risk_insights ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'risk';
ALTER TABLE public.project_risk_insights DROP CONSTRAINT IF EXISTS project_risk_insights_pkey;
ALTER TABLE public.project_risk_insights ADD PRIMARY KEY (project_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_risk_insights TO authenticated;
GRANT ALL ON public.project_risk_insights TO service_role;