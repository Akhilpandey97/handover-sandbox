-- The upload_type CHECK constraint only allowed 'postman_collection' and
-- 'api_screenshot', blocking customer-side uploads (upload_type = 'customer_document').
ALTER TABLE public.merchant_portal_uploads
  DROP CONSTRAINT merchant_portal_uploads_upload_type_check;

ALTER TABLE public.merchant_portal_uploads
  ADD CONSTRAINT merchant_portal_uploads_upload_type_check
  CHECK (upload_type = ANY (ARRAY[
    'postman_collection'::text,
    'api_screenshot'::text,
    'customer_document'::text
  ]));
