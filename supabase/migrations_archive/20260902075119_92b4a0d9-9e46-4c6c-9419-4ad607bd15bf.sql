REVOKE EXECUTE ON FUNCTION public.cron_token_matches(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_token_matches(text) TO service_role;