-- The scheduled jobs (private.schedule_app_job) need pg_cron and pg_net. Lovable Cloud
-- enabled them outside the migrations, so a fresh project has to create them here.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- gen_random_bytes, used for the cron token in private.cron_config.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
