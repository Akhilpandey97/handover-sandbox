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

## In progress
- [ ] Restrict private storage reads to the matching tenant or project.

## Done (later)
- [x] Customer portal branding/roadmap cleanup: organisation logo, bottom-right
      chat, full checklist names, no stage badge, and project-only FAQs.
- [x] Aligned all remaining tabs with the Dashboard and Projects visual system.
- [x] Rebuilt Settings → Integrations as one compact card per integration.
- [x] Revamped the standard user dashboard with the manager shell, user-scoped
      Workbench, incoming-project acceptance, Kanban, Go-Live Tracker, and Buddy
- [x] Team Management synced: custom teams from Settings now flow into every
      team dropdown/label across dashboards, checklists, transfers, exports
- [x] Removed stale GoKwik-era team names and the @gokwik.co signup restriction

- [x] Removed stale `qa_team` checklist template + all project copies
- [x] CRM integration API live: tenant API keys (Settings → Integrations →
      API Keys) + `/api/public/v1/{projects,projects/:id,users,health}`,
      `external_id` idempotency. Docs: `docs/handover-crm-api.md`

## Notes
- Cron dispatcher auth: `x-cron-token` header, validated against a private
  admin-only table (`private.cron_config`) or `LOVABLE_CRON_SECRET`.
- Roles are single-role per user (`user_roles` is read with `.single()` by the
  ported functions) — do not add a second role row for the same user.
