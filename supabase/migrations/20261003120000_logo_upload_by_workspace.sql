-- A logo belongs to a workspace, not to whoever happened to upload it first.
--
-- The policies gated writes on `owner = auth.uid()`, so replacing a logo only worked for
-- the person who first uploaded it. Everyone else got a policy failure, which the UI
-- reports as "Failed to upload logo" — including the case where the original uploader's
-- account no longer exists, leaving that workspace's logo permanently unchangeable.
--
-- Writes are now scoped to the caller's own workspace folder: org-logos/<tenant_id>/…,
-- which is the path the uploader already uses.

DROP POLICY IF EXISTS "Admins upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Owners update logos" ON storage.objects;
DROP POLICY IF EXISTS "Owners delete logos" ON storage.objects;

CREATE POLICY "Workspace members upload logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Workspace members update logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Workspace members delete logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );
