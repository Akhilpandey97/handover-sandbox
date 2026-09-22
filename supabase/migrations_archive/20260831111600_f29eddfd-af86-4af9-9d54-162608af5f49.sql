CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "Authenticated users can upload checklist attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'checklist-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view checklist attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'checklist-attachments');

CREATE POLICY "Authenticated users can delete their own attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'checklist-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'org-logos');

CREATE POLICY "Authenticated users can upload logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'org-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'org-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'org-logos' AND auth.role() = 'authenticated');

CREATE POLICY "BRD exports are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'brd-exports');

CREATE POLICY "Authenticated users can upload BRD exports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'brd-exports');

CREATE POLICY "Public read access for merchant portal files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'merchant-portal-files');

CREATE POLICY "Authenticated users can upload merchant portal files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'merchant-portal-files');

CREATE POLICY "Service role can manage merchant portal files"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'merchant-portal-files');

ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER PUBLICATION supabase_realtime ADD TABLE public.project_risks;