-- 1. Private cron token store -------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cron_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.cron_config (id, token)
VALUES (true, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.cron_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA private FROM anon, authenticated, public;
REVOKE ALL ON private.cron_config FROM anon, authenticated, public;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT ALL ON private.cron_config TO service_role;

CREATE OR REPLACE FUNCTION public.cron_token_matches(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT EXISTS (SELECT 1 FROM private.cron_config c WHERE c.token = _token)
$$;

REVOKE ALL ON FUNCTION public.cron_token_matches(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_token_matches(text) TO service_role;

-- 2. Scheduled jobs ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_app_job(_name text, _schedule text, _job text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, cron, net
AS $$
DECLARE
  _token text;
BEGIN
  SELECT token INTO _token FROM private.cron_config LIMIT 1;

  PERFORM cron.unschedule(_name) WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = _name
  );

  PERFORM cron.schedule(
    _name,
    _schedule,
    format(
      $cmd$select net.http_post(
        url := 'https://handover-sandbox.lovable.app/api/public/cron?job=%s',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-token','%s'),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );$cmd$,
      _job, _token
    )
  );
END;
$$;

SELECT private.schedule_app_job('app-poll-emails',                  '0 * * * *',   'poll-emails');
SELECT private.schedule_app_job('app-poll-platform-golive-emails',  '15 */2 * * *','poll-platform-golive-emails');
SELECT private.schedule_app_job('app-poll-shopify-sme-emails',      '5 */4 * * *', 'poll-shopify-sme-emails');
SELECT private.schedule_app_job('app-send-scheduled-report',        '* * * * *',   'send-scheduled-report');
SELECT private.schedule_app_job('app-send-scheduled-tat-report',    '* * * * *',   'send-scheduled-tat-report');
SELECT private.schedule_app_job('app-send-scheduled-movement-report','* * * * *',  'send-scheduled-movement-report');
SELECT private.schedule_app_job('app-slack-stuck-merchants-digest', '30 4 * * *',  'slack-stuck-merchants-digest');
SELECT private.schedule_app_job('app-check-overdue-tasks',          '30 3 * * *',  'check-overdue-tasks');

-- 3. Bootstrap the first workspace admin ---------------------------------------
UPDATE public.profiles
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

UPDATE public.user_roles
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT p.id, 'super_admin', p.tenant_id
FROM public.profiles p
WHERE p.email = 'ap79020@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'super_admin'
  );

-- 4. Starter checklist templates (editable in Settings) -------------------------
INSERT INTO public.checklist_templates (title, owner_team, phase, sort_order, tenant_id, standard_duration)
SELECT v.title, v.owner_team::public.team_role, v.phase::public.project_phase, v.sort_order,
       '00000000-0000-0000-0000-000000000001'::uuid, v.standard_duration
FROM (VALUES
  ('Kick-off call with merchant',              'mint',        'mint',        10, 1),
  ('Collect merchant business requirements',   'mint',        'mint',        20, 3),
  ('Share BRD form with merchant',             'mint',        'mint',        30, 3),
  ('BRD sign-off received',                    'mint',        'mint',        40, 7),
  ('Commercials and SOW signed',               'mint',        'mint',        50, 7),
  ('Create merchant account (MID)',            'mint',        'mint',        60, 2),
  ('Handover to integration team',             'mint',        'mint',        70, 1),
  ('Share sandbox credentials',                'integration', 'integration', 10, 1),
  ('Merchant completes sandbox integration',   'integration', 'integration', 20, 10),
  ('Checkout / payments test cases passed',    'integration', 'integration', 30, 5),
  ('PG onboarding completed',                  'integration', 'integration', 40, 7),
  ('Share production credentials',             'integration', 'integration', 50, 2),
  ('Production smoke test completed',          'integration', 'integration', 60, 3),
  ('Go-live sign-off from merchant',           'integration', 'integration', 70, 2),
  ('Handover to merchant success',             'ms',          'ms',          10, 1),
  ('Dashboard walkthrough with merchant',      'ms',          'ms',          20, 3),
  ('First week transaction health review',     'ms',          'ms',          30, 7),
  ('30-day performance review',                'ms',          'ms',          40, 30)
) AS v(title, owner_team, phase, sort_order, standard_duration)
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates ct
  WHERE ct.tenant_id = '00000000-0000-0000-0000-000000000001'
);