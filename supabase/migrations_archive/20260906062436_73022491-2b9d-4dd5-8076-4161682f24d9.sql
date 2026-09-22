
DELETE FROM public.checklist_comments WHERE checklist_item_id IN (SELECT id FROM public.checklist_items WHERE owner_team='qa_team');
DELETE FROM public.checklist_responsibility_logs WHERE checklist_item_id IN (SELECT id FROM public.checklist_items WHERE owner_team='qa_team');
DELETE FROM public.checklist_tasks WHERE checklist_item_id IN (SELECT id FROM public.checklist_items WHERE owner_team='qa_team');
DELETE FROM public.checklist_form_responses WHERE checklist_item_id IN (SELECT id FROM public.checklist_items WHERE owner_team='qa_team');
DELETE FROM public.checklist_items WHERE owner_team='qa_team';
DELETE FROM public.checklist_form_assignments WHERE checklist_template_id IN (SELECT id FROM public.checklist_templates WHERE owner_team='qa_team');
DELETE FROM public.checklist_templates WHERE owner_team='qa_team';

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON public.api_keys(tenant_id);

GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tenant api keys" ON public.api_keys
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (public.is_manager(auth.uid()) OR public.is_super_admin(auth.uid()))
);

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_external_id_idx
  ON public.projects(tenant_id, external_id) WHERE external_id IS NOT NULL;
