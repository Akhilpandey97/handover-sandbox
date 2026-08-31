CREATE OR REPLACE FUNCTION public.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE OR REPLACE FUNCTION public.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.role() $$;
GRANT EXECUTE ON FUNCTION public.uid(), public.role() TO anon, authenticated, service_role, sandbox_exec;