-- Gmail used to go through Lovable's connector gateway, which held the Google tokens.
-- Off Lovable the app refreshes its own, the way Meet and Calendar already do, so the
-- refresh token is stored per workspace beside theirs.
ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS google_mail_refresh_token text;

COMMENT ON COLUMN public.tenant_integrations.google_mail_refresh_token IS
  'Refresh token for the Gmail mailbox the pollers read, issued to google_oauth_client_id.';
