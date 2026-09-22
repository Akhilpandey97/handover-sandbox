-- The scheduled jobs used to hardcode https://handover-sandbox.lovable.app. Off Lovable
-- the host changes, so it now lives in the database and the job list is data, not DDL.
--
-- After deploying to a new host:
--   SELECT private.set_app_base_url('https://app.example.com');
-- which stores the host and (re)schedules every job in private.app_jobs.
-- With no host set, nothing is scheduled: a fresh database never calls someone else's app.

ALTER TABLE private.cron_config ADD COLUMN IF NOT EXISTS app_base_url text;

CREATE TABLE IF NOT EXISTS private.app_jobs (
  name     text PRIMARY KEY,
  schedule text NOT NULL,
  job      text NOT NULL
);

ALTER TABLE private.app_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_jobs FROM anon, authenticated, public;
GRANT ALL ON private.app_jobs TO service_role;

INSERT INTO private.app_jobs (name, schedule, job) VALUES
  ('app-poll-emails',                   '0 * * * *',    'poll-emails'),
  ('app-poll-platform-golive-emails',   '15 */2 * * *', 'poll-platform-golive-emails'),
  ('app-poll-shopify-sme-emails',       '5 */4 * * *',  'poll-shopify-sme-emails'),
  ('app-poll-meeting-transcripts',      '*/15 * * * *', 'poll-meeting-transcripts'),
  ('app-send-scheduled-report',         '* * * * *',    'send-scheduled-report'),
  ('app-send-scheduled-tat-report',     '* * * * *',    'send-scheduled-tat-report'),
  ('app-send-scheduled-movement-report','* * * * *',    'send-scheduled-movement-report'),
  ('app-slack-stuck-merchants-digest',  '30 4 * * *',   'slack-stuck-merchants-digest'),
  ('app-check-overdue-tasks',           '30 3 * * *',   'check-overdue-tasks'),
  ('app-run-workflows',                 '*/10 * * * *', 'run-workflows')
ON CONFLICT (name) DO UPDATE
  SET schedule = EXCLUDED.schedule, job = EXCLUDED.job;

CREATE OR REPLACE FUNCTION private.schedule_app_job(_name text, _schedule text, _job text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, cron, net
AS $$
DECLARE
  _token    text;
  _base_url text;
BEGIN
  SELECT token, app_base_url INTO _token, _base_url FROM private.cron_config LIMIT 1;

  PERFORM cron.unschedule(_name) WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = _name
  );

  -- No host yet: leave the job unscheduled rather than calling the old one.
  IF _base_url IS NULL OR _base_url = '' THEN
    RETURN;
  END IF;

  PERFORM cron.schedule(
    _name,
    _schedule,
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-token',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );$cmd$,
      rtrim(_base_url, '/') || '/api/public/cron?job=' || _job, _token
    )
  );
END;
$$;

-- Point every job at a host, and schedule them.
CREATE OR REPLACE FUNCTION private.set_app_base_url(_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, cron, net
AS $$
DECLARE
  _j record;
BEGIN
  UPDATE private.cron_config SET app_base_url = _url;

  FOR _j IN SELECT name, schedule, job FROM private.app_jobs LOOP
    PERFORM private.schedule_app_job(_j.name, _j.schedule, _j.job);
  END LOOP;
END;
$$;

-- Issue a fresh scheduler token; the app's CRON_SECRET has to match the value returned.
CREATE OR REPLACE FUNCTION private.rotate_cron_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions, cron, net
AS $$
DECLARE
  _token text := encode(extensions.gen_random_bytes(32), 'hex');
  _j     record;
BEGIN
  UPDATE private.cron_config SET token = _token;

  FOR _j IN SELECT name, schedule, job FROM private.app_jobs LOOP
    PERFORM private.schedule_app_job(_j.name, _j.schedule, _j.job);
  END LOOP;

  RETURN _token;
END;
$$;

REVOKE ALL ON FUNCTION private.set_app_base_url(text)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION private.rotate_cron_token()     FROM public, anon, authenticated;
