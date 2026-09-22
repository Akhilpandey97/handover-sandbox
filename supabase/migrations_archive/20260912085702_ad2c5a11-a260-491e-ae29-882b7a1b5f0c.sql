CREATE TABLE public.project_credentials (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sandbox_app_secret text,
  sandbox_kwikpass_jwe_key text,
  prod_app_secret text,
  prod_kwikpass_jwe_key text,
  kp_prod_jwe_key text,
  kp_sandbox_jwe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_credentials TO authenticated;
GRANT ALL ON public.project_credentials TO service_role;

ALTER TABLE public.project_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins can view project credentials"
ON public.project_credentials FOR SELECT TO authenticated
USING (
  (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Tenant admins can create project credentials"
ON public.project_credentials FOR INSERT TO authenticated
WITH CHECK (
  (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Tenant admins can update project credentials"
ON public.project_credentials FOR UPDATE TO authenticated
USING (
  (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Tenant admins can delete project credentials"
ON public.project_credentials FOR DELETE TO authenticated
USING (
  (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE TRIGGER update_project_credentials_updated_at
BEFORE UPDATE ON public.project_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();