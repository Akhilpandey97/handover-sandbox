GRANT sandbox_exec TO CURRENT_USER;
DO $$
DECLARE r record; me text := current_user; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='sandbox_exec' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, me);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner WHERE n.nspname='public' AND o.rolname='sandbox_exec' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.sig, me);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_roles o ON o.oid=t.typowner WHERE n.nspname='public' AND t.typtype='e' AND o.rolname='sandbox_exec' LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO %I', r.typname, me);
  END LOOP;
END $$;