-- Time-limited support access to a customer workspace.
--
-- A super admin already reaches every tenant: RLS policies carry
-- "OR is_super_admin(auth.uid())", so the access is permanent, global and
-- leaves no record of when it was used or why. That is fine for a platform
-- owner and poor for anyone who has to answer for it later.
--
-- This does not change that reach. It makes using it deliberate: you open a
-- named grant against one tenant, with a reason and an expiry, the app works
-- inside that tenant while it lasts, and the grant is on the record.

CREATE TABLE IF NOT EXISTS public.tenant_access_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  granted_to  uuid NOT NULL,
  granted_by  uuid NOT NULL,
  granted_by_name text,
  reason      text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "Is there a live grant for this person on this tenant" is the only question
-- ever asked of this table.
CREATE INDEX IF NOT EXISTS tenant_access_grants_active_idx
  ON public.tenant_access_grants (granted_to, tenant_id, expires_at DESC);

ALTER TABLE public.tenant_access_grants ENABLE ROW LEVEL SECURITY;

-- Super admins manage grants. Tenant members may read the ones against their
-- own workspace: being able to see who had access, and when, is the point of
-- writing them down.
DROP POLICY IF EXISTS "Super admins manage access grants" ON public.tenant_access_grants;
CREATE POLICY "Super admins manage access grants"
  ON public.tenant_access_grants FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Tenant members read grants on their workspace" ON public.tenant_access_grants;
CREATE POLICY "Tenant members read grants on their workspace"
  ON public.tenant_access_grants FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Which tenant the person is currently working inside. Null means their own.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_tenant_id uuid;

/**
 * The tenant a support session is currently valid for, or null.
 *
 * Checked on every load rather than trusted from the client, so an expired or
 * revoked grant stops working on its own without anything having to notice.
 */
CREATE OR REPLACE FUNCTION public.active_support_tenant(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.tenant_id
  FROM public.tenant_access_grants g
  JOIN public.profiles p ON p.id = _user_id
  WHERE g.granted_to = _user_id
    AND g.tenant_id = p.active_tenant_id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.expires_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.active_support_tenant(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_support_tenant(uuid) TO authenticated;
