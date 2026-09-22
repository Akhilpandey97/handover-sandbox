-- Meetings on checklist items: scheduled alongside sub-tasks, and the place a
-- call's transcript, minutes and AI-flagged risks come back to.

-- 1. The meeting itself -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,

  title text NOT NULL,
  agenda text,
  provider text NOT NULL CHECK (provider IN ('google_meet', 'zoom', 'teams')),
  join_url text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 600),
  /* Invitee email addresses, lowercased. */
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  invite_sent_at timestamptz,

  /* The provider's own id for the call, which is how a webhook or a poller
     finds its way back to this row. Derived from join_url where the provider
     puts it there (Zoom), set by the poller otherwise. */
  provider_meeting_id text,

  transcript text,
  transcript_source text CHECK (
    transcript_source IS NULL
    OR transcript_source IN ('zoom', 'google_meet', 'teams', 'manual', 'api')
  ),
  transcript_received_at timestamptz,

  analysis_status text NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'processing', 'done', 'failed')),
  analysis_error text,
  analysed_at timestamptz,
  /* The Meeting AI comment holding the minutes, so the UI can deep-link to it
     and a re-run can tell it already posted. */
  mom_comment_id uuid,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_meetings_item_idx
  ON public.checklist_meetings (checklist_item_id, scheduled_at);
CREATE INDEX IF NOT EXISTS checklist_meetings_project_idx
  ON public.checklist_meetings (project_id, scheduled_at);

-- Webhooks arrive with only a provider id, so that lookup has to be unique and
-- fast. Partial, because the column is null until a provider tells us.
CREATE UNIQUE INDEX IF NOT EXISTS checklist_meetings_provider_id_idx
  ON public.checklist_meetings (provider, provider_meeting_id)
  WHERE provider_meeting_id IS NOT NULL;

-- Pollers look for calls that have ended and still owe us a transcript.
CREATE INDEX IF NOT EXISTS checklist_meetings_awaiting_transcript_idx
  ON public.checklist_meetings (scheduled_at)
  WHERE status <> 'cancelled' AND transcript IS NULL;

CREATE TRIGGER checklist_meetings_updated_at
  BEFORE UPDATE ON public.checklist_meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_meetings TO authenticated;
GRANT ALL ON public.checklist_meetings TO service_role;

ALTER TABLE public.checklist_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read meetings" ON public.checklist_meetings;
CREATE POLICY "Tenant members read meetings" ON public.checklist_meetings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Tenant members write meetings" ON public.checklist_meetings;
CREATE POLICY "Tenant members write meetings" ON public.checklist_meetings
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) OR public.is_super_admin(auth.uid()));

-- 2. Per-provider credentials -------------------------------------------------
-- Transcripts come from each provider's own API, so every workspace brings its
-- own app credentials. Secrets stay out of the browser: the API route masks
-- them on read, exactly as it does for the Resend and Jira keys.
ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS zoom_account_id text,
  ADD COLUMN IF NOT EXISTS zoom_client_id text,
  ADD COLUMN IF NOT EXISTS zoom_client_secret text,
  ADD COLUMN IF NOT EXISTS zoom_webhook_secret text,
  ADD COLUMN IF NOT EXISTS teams_tenant_id text,
  ADD COLUMN IF NOT EXISTS teams_client_id text,
  ADD COLUMN IF NOT EXISTS teams_client_secret text,
  ADD COLUMN IF NOT EXISTS google_meet_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_oauth_client_id text,
  ADD COLUMN IF NOT EXISTS google_oauth_client_secret text;

-- Mirror the existing column grant: non-secret columns are readable by the
-- workspace, secrets are reachable only through the service role.
GRANT SELECT (zoom_account_id, zoom_client_id, teams_tenant_id, teams_client_id, google_oauth_client_id)
  ON public.tenant_integrations TO authenticated;

-- 3. Minutes are posted as a comment by a non-human author --------------------
-- checklist_comments.user_name already carries the display name and user_id is
-- nullable, so "Meeting AI" needs no schema change; this only documents it.
COMMENT ON COLUMN public.checklist_comments.user_name IS
  'Display name of the author. Non-human authors (e.g. "Meeting AI") leave user_id null.';
