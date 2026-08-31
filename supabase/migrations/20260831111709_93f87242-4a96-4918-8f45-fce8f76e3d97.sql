ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.uid() SET search_path = public, auth;
ALTER FUNCTION public.role() SET search_path = public, auth;