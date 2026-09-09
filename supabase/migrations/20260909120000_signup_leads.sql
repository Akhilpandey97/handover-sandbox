-- Sign-up enquiries from the login page.
--
-- This is lead capture, not account creation: submitting creates no user and
-- grants no access. Rows are written by the API route using the service role,
-- so neither anon nor authenticated gets an INSERT policy — a public form is
-- the one place where a client-side insert grant would be abused.

CREATE TABLE IF NOT EXISTS public.signup_leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        text NOT NULL,
  job_title    text,
  company_name text,
  phone        text,
  country      text,
  city         text,
  -- Kept for spam triage, not for tracking.
  user_agent   text,
  -- Set once the row reaches the Google Sheet, so a failed forward can be
  -- retried without guessing which rows already landed.
  synced_at    timestamptz,
  sync_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_leads_created_at_idx ON public.signup_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS signup_leads_email_idx      ON public.signup_leads (lower(email));

ALTER TABLE public.signup_leads ENABLE ROW LEVEL SECURITY;

-- Read access is deliberately narrow: these are unverified strangers' contact
-- details, not tenant data, so they belong to whoever runs the platform.
DROP POLICY IF EXISTS "Super admins read signup leads" ON public.signup_leads;
CREATE POLICY "Super admins read signup leads"
  ON public.signup_leads FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.signup_leads FROM anon, authenticated;
