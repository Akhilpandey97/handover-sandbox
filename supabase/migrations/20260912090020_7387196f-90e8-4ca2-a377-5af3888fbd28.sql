ALTER TABLE public.projects
  DROP COLUMN sandbox_app_secret,
  DROP COLUMN sandbox_kwikpass_jwe_key,
  DROP COLUMN prod_app_secret,
  DROP COLUMN prod_kwikpass_jwe_key,
  DROP COLUMN kp_prod_jwe_key,
  DROP COLUMN kp_sandbox_jwe_key;