ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS zoom_user_id text,
  ADD COLUMN IF NOT EXISTS teams_organizer_user_id text,
  ADD COLUMN IF NOT EXISTS google_calendar_refresh_token text;