DROP POLICY IF EXISTS "BRD exports are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view checklist attachments" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for merchant portal files" ON storage.objects;

CREATE POLICY "Signed-in users read BRD exports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brd-exports');

CREATE POLICY "Signed-in users read checklist attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'checklist-attachments');

CREATE POLICY "Signed-in users read merchant portal files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'merchant-portal-files');