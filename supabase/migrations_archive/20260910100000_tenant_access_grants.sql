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

-- ── The tenant every RLS policy scopes by ───────────────────────────────────
-- Recovered original:
--   SELECT tenant_id FROM public.profiles WHERE id = _user_id LIMIT 1
--
-- Policies read "is_manager(uid) AND tenant_id = get_user_tenant_id(uid)". The
-- role half is global and tenant-independent, so redirecting this function is
-- what puts a person inside another workspace — and it is the only way a setup
-- user who is not a super admin can work there at all: without it the database
-- keeps handing them their own tenant no matter what the grant says.
--
-- The fallback is the original query verbatim, so with no live grant the
-- behaviour is unchanged.
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT g.tenant_id
      FROM public.tenant_access_grants g
      JOIN public.profiles p ON p.id = _user_id
      WHERE g.granted_to = _user_id
        AND g.tenant_id = p.active_tenant_id
        AND g.revoked_at IS NULL
        AND g.expires_at > now()
      ORDER BY g.expires_at DESC
      LIMIT 1
    ),
    (SELECT tenant_id FROM public.profiles WHERE id = _user_id LIMIT 1)
  )
$$;

-- Grants are matched by granted_to before the tenant is known, so this lookup
-- must not itself depend on get_user_tenant_id.
DROP POLICY IF EXISTS "Users read their own grants" ON public.tenant_access_grants;
CREATE POLICY "Users read their own grants"
  ON public.tenant_access_grants FOR SELECT TO authenticated
  USING (granted_to = auth.uid());

-- A grantee may open and close their own session, and nothing else.
DROP POLICY IF EXISTS "Users switch into a workspace they were granted" ON public.profiles;
CREATE POLICY "Users switch into a workspace they were granted"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (
      active_tenant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.tenant_access_grants g
        WHERE g.granted_to = auth.uid()
          AND g.tenant_id = active_tenant_id
          AND g.revoked_at IS NULL
          AND g.expires_at > now()
      )
    )
  );
