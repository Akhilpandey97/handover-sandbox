# Migration roadmap

## Done
- [x] Database schema (42 tables, RLS, grants, triggers, storage policies)
- [x] Frontend port (all screens, routes, providers, design tokens)
- [x] 31 edge functions ported to `/api/public/*` routes
- [x] `tenant_integrations` table (per-tenant credentials, admin-only secrets)
- [x] Credential resolver + all routes read tenant creds (env fallback)
- [x] Settings → Integrations tab for tenant admins (Resend, Gmail, Jira, Slack)
- [x] Scheduled jobs: `/api/public/cron` dispatcher (token-auth, per-tenant fan-out)
      + 8 pg_cron schedules (3 mail pollers, 3 report senders, Slack digest, overdue tasks)
- [x] Bootstrap: Default Organisation tenant, super-admin user, 18 starter checklist templates
- [x] Auth flows verified: sign-in, admin create-user, delete-user, set-password,
      tenant-integrations read/write

## Remaining (needs the customer, not code)
- [ ] Tenant admins enter real credentials in Settings → Integrations
      (Resend, Gmail, Jira, Slack). Until then those jobs return
      "not configured" instead of running.
- [ ] MCP server function (intentionally skipped — unused by the UI)

## Notes
- Cron dispatcher auth: `x-cron-token` header, validated against a private
  admin-only table (`private.cron_config`) or `LOVABLE_CRON_SECRET`.
- Roles are single-role per user (`user_roles` is read with `.single()` by the
  ported functions) — do not add a second role row for the same user.
