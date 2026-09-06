-- Tenant admin helper
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- Managers-level access now also covers tenant admins
CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('manager', 'admin')
  )
$$;

-- Integrations: tenant admins only
DROP POLICY IF EXISTS "Tenant admins can view their integrations" ON public.tenant_integrations;
DROP POLICY IF EXISTS "Tenant admins can update their integrations" ON public.tenant_integrations;
DROP POLICY IF EXISTS "Tenant admins can create their integrations" ON public.tenant_integrations;

CREATE POLICY "Tenant admins can view their integrations"
ON public.tenant_integrations FOR SELECT TO authenticated
USING ((public.is_tenant_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Tenant admins can update their integrations"
ON public.tenant_integrations FOR UPDATE TO authenticated
USING ((public.is_tenant_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Tenant admins can create their integrations"
ON public.tenant_integrations FOR INSERT TO authenticated
WITH CHECK ((public.is_tenant_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid())) OR public.is_super_admin(auth.uid()));

-- API keys: tenant admins only
DROP POLICY IF EXISTS "Admins read tenant api keys" ON public.api_keys;
CREATE POLICY "Admins read tenant api keys"
ON public.api_keys FOR SELECT TO authenticated
USING ((tenant_id = public.get_user_tenant_id(auth.uid()) AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()));