CREATE TABLE public.tenant_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Email (Resend)
  resend_api_key text,
  from_email text,
  from_name text,
  reply_to text,
  -- Gmail polling
  google_mail_api_key text,
  gmail_monitor_address text,
  -- Jira
  jira_base_url text,
  jira_email text,
  jira_api_token text,
  -- Slack
  slack_webhook_url text,
  slack_bot_token text,
  slack_channel text,
  -- App
  app_base_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Non-secret columns are readable by tenant admins; secret columns are not granted to authenticated at all.
GRANT SELECT (id, tenant_id, from_email, from_name, reply_to, gmail_monitor_address, jira_base_url, jira_email, slack_channel, app_base_url, created_at, updated_at) ON public.tenant_integrations TO authenticated;
GRANT INSERT, UPDATE ON public.tenant_integrations TO authenticated;
GRANT ALL ON public.tenant_integrations TO service_role;

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins can view their integrations"
  ON public.tenant_integrations FOR SELECT TO authenticated
  USING (
    (public.is_manager(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()))
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Tenant admins can create their integrations"
  ON public.tenant_integrations FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_manager(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()))
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "Tenant admins can update their integrations"
  ON public.tenant_integrations FOR UPDATE TO authenticated
  USING (
    (public.is_manager(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()))
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    (public.is_manager(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()))
    OR public.is_super_admin(auth.uid())
  );

CREATE TRIGGER update_tenant_integrations_updated_at
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();