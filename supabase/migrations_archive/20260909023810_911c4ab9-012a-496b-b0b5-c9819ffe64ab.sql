-- 1. Internal / trigger-only routines must not be callable from the Data API.
REVOKE EXECUTE ON FUNCTION public.cron_token_matches(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_expected_go_live(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_project_checklist() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.checklist_items_sync_egl() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projects_refill_auto_egl() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projects_mark_manual_egl() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;

-- Role helpers stay available to signed-in users (RLS depends on them) but not to anonymous callers.
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_manager(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_gokwik_general(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_last_activity(uuid) FROM anon;

-- 2. Portal visits: written by the server (service role), never by anonymous clients.
DROP POLICY IF EXISTS "Anyone can insert portal visit" ON public.merchant_portal_visits;
REVOKE INSERT ON public.merchant_portal_visits FROM anon;
CREATE POLICY "Tenant members log portal visits"
  ON public.merchant_portal_visits FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

-- 3. Notifications may only be created inside the author's own tenant.
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
CREATE POLICY "Tenant members create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (
      tenant_id IS NOT NULL
      AND tenant_id = public.get_user_tenant_id(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = notifications.user_id AND p.tenant_id = notifications.tenant_id
      )
    )
  );

-- 4. Storage: uploads require a signed-in owner; only the owner (or service role) may change them.
DROP POLICY IF EXISTS "Authenticated users can upload BRD exports" ON storage.objects;
CREATE POLICY "Owners upload BRD exports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brd-exports' AND owner = auth.uid());

CREATE POLICY "Owners manage BRD exports"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brd-exports' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'brd-exports' AND owner = auth.uid());

CREATE POLICY "Owners delete BRD exports"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brd-exports' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload checklist attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their own attachments" ON storage.objects;
CREATE POLICY "Owners upload checklist attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'checklist-attachments' AND owner = auth.uid());

CREATE POLICY "Owners update checklist attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'checklist-attachments' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'checklist-attachments' AND owner = auth.uid());

CREATE POLICY "Owners delete checklist attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'checklist-attachments' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload merchant portal files" ON storage.objects;
CREATE POLICY "Owners upload merchant portal files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'merchant-portal-files' AND owner = auth.uid());

CREATE POLICY "Owners update merchant portal files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'merchant-portal-files' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'merchant-portal-files' AND owner = auth.uid());

CREATE POLICY "Owners delete merchant portal files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'merchant-portal-files' AND owner = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;
CREATE POLICY "Admins upload logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-logos' AND owner = auth.uid());

CREATE POLICY "Owners update logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'org-logos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'org-logos' AND owner = auth.uid());

CREATE POLICY "Owners delete logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'org-logos' AND owner = auth.uid());