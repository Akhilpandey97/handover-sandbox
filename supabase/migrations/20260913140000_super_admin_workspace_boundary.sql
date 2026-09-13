-- Super admins stay inside the workspace they are working in.
--
-- RLS policies on tenant tables carry "OR is_super_admin(auth.uid())", so a
-- super admin can read and write every customer's data from anywhere, and
-- doing so leaves no record. The screens now filter by the current workspace
-- (see .lovable/plan/super-admin-workspace-scoping-2026-09-13.md); this makes
-- the database hold the same line.
--
-- It adds one RESTRICTIVE policy per tenant table. Restrictive policies are
-- ANDed with the existing permissive ones, so this can only narrow access and
-- needs no knowledge of the policies already there. For anyone who is not a
-- super admin the condition is always true: nothing changes for them.
--
-- A super admin is held to get_user_tenant_id(): their own workspace, or the
-- customer's while a support session is open. Reaching a customer therefore
-- goes through a support access grant, which is logged.
--
-- Not affected: the service role (server routes, cron, merchant portal)
-- bypasses RLS; SECURITY DEFINER functions run as their owner; tenant access
-- grants and events stay global for super admins.

-- ── 1. What the Tenants page needs across workspaces ────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_stats()
RETURNS TABLE (tenant_id uuid, user_count bigint, project_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can list workspace statistics';
  END IF;

  RETURN QUERY
  SELECT t.id,
         (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = t.id),
         (SELECT count(*) FROM public.projects pr WHERE pr.tenant_id = t.id)
  FROM public.tenants t;
END $$;

-- Creating a workspace also seeds its default teams, which live in the new
-- tenant rather than the one the super admin is working in.
CREATE OR REPLACE FUNCTION public.create_tenant(_name text, _slug text, _logo_url text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can create a workspace';
  END IF;

  INSERT INTO public.tenants (name, slug, logo_url)
  VALUES (_name, _slug, NULLIF(_logo_url, ''))
  RETURNING id INTO new_id;

  -- Mirrors SYSTEM_TEAMS in src/hooks/useTeams.ts.
  INSERT INTO public.teams (name, slug, color, is_system, sort_order, tenant_id)
  VALUES
    ('Sales',            'mint',        '#3b82f6', true, 0, new_id),
    ('MINT',             'integration', '#a855f7', true, 1, new_id),
    ('Merchant Success', 'ms',          '#10b981', true, 2, new_id);

  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.tenant_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_tenant(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant(text, text, text) TO authenticated, service_role;

-- ── 2. The boundary ─────────────────────────────────────────────────────────
-- Generated for every table with a tenant_id column, so a table added later is
-- covered by re-running this block. Rows with no tenant (global defaults) stay
-- reachable. A person's own profile, roles and notifications stay reachable
-- during a support session, or the app could not load who they are or let
-- them leave the workspace.
DO $$
DECLARE
  r record;
  own_rows text;
  expr text;
  policy_name constant text := 'Super admins stay in the current workspace';
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name NOT IN ('tenant_access_grants', 'tenant_access_events')
    ORDER BY c.table_name
  LOOP
    own_rows := CASE r.table_name
      WHEN 'profiles'      THEN ' OR id = auth.uid()'
      WHEN 'user_roles'    THEN ' OR user_id = auth.uid()'
      WHEN 'notifications' THEN ' OR user_id = auth.uid()'
      ELSE ''
    END;

    -- (SELECT ...) lets Postgres evaluate each check once per statement rather than per row.
    expr := 'NOT (SELECT public.is_super_admin(auth.uid()))'
         || ' OR tenant_id IS NULL'
         || ' OR tenant_id = (SELECT public.get_user_tenant_id(auth.uid()))'
         || own_rows;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      policy_name, r.table_name, expr, expr
    );
  END LOOP;
END $$;
