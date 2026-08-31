# Migration roadmap

## Done
- [x] Database schema (42 tables, RLS, grants, triggers, storage policies)
- [x] Frontend port (all screens, routes, providers, design tokens)
- [x] 31 edge functions ported to `/api/public/*` routes
- [x] `tenant_integrations` table (per-tenant credentials, admin-only secrets)
- [x] Credential resolver + all routes read tenant creds (env fallback)
- [x] Settings → Integrations tab for tenant admins (Resend, Gmail, Jira, Slack)

## Remaining
- [ ] Tenant admins enter real credentials in Settings → Integrations
- [ ] pg_cron schedules for: poll-emails, poll-shopify-sme-emails,
      poll-platform-golive-emails, send-scheduled-report,
      send-scheduled-tat-report, send-scheduled-movement-report,
      slack-stuck-merchants-digest
- [ ] Bootstrap: first super-admin user + tenant, checklist templates seed
- [ ] Auth flows end-to-end check (invite, reset password, create-user)
- [ ] MCP server function (skipped — unused by UI)
