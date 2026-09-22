# Per-Tenant Integration Credentials + Remaining Migration Scope

## Part 1 — Tenant-level integration settings (replaces global keys)

Yes: every integration credential except the Lovable AI key becomes a per-tenant setting that a tenant admin configures in the app. No global keys are required for a tenant to work.

### Where they live

A new `tenant_integrations` table (one row per tenant), separate from `app_settings` because `app_settings` is readable by every authenticated user and these are secrets.

Fields per tenant:

| Group | Fields | Secret? |
|---|---|---|
| Email (Resend) | `resend_api_key`, `from_email`, `from_name`, `reply_to` | key only |
| Gmail polling | `google_mail_api_key`, `gmail_monitor_address` | key only |
| Jira | `jira_base_url`, `jira_email`, `jira_api_token` | token only |
| Slack | `slack_webhook_url`, `slack_bot_token`, `slack_channel` | webhook/token |
| App | `app_base_url` (links in emails) | no |

Access rules: only a tenant's manager/super admin can read or write their own tenant's row; nobody else can see any row. Secret values are never sent to the browser — the settings UI reads a masked summary (`configured: true/false`, last-updated, plus the non-secret fields) and writes new values one-way.

### Settings UI

New "Integrations" section in Settings, one card per group (Email, Gmail, Jira, Slack), each with:
- placeholder-styled inputs (`re_...`, `https://yourcompany.atlassian.net`, `https://hooks.slack.com/services/...`)
- status badge: Not configured / Configured
- "Test connection" button per integration (sends a test email, lists 1 Gmail thread, fetches Jira myself, posts a Slack test message)
- Clear/remove button

### Backend changes

- Shared resolver `getTenantIntegration(tenantId)` used by every API route: reads the tenant row, falls back to the platform env var if present, and returns a clear "Integration not configured for this tenant" error otherwise (currently routes assume a global env var).
- Update the 20 routes that read `RESEND_API_KEY`, `GOOGLE_MAIL_API_KEY`, `JIRA_*`, Slack, `APP_URL` / `APP_BASE_URL` to resolve per tenant. Routes that today operate across all tenants (pollers, scheduled reports, digests) loop tenants and skip ones without credentials.
- `LOVABLE_API_KEY` stays platform-level (already provisioned) — AI features work for all tenants with no setup.

## Part 2 — What is left in the migration

Done: database (42 tables, RLS, grants, triggers, realtime), storage buckets + policies, full UI port (~80 components, routes, theme tokens), all 31 backend functions ported to `/api/public/*` and wired to the UI, typecheck clean.

Remaining:

1. **Tenant integration settings** — Part 1 above.
2. **Scheduled jobs** — 7 recurring jobs are not scheduled yet: email pollers (`poll-emails`, `poll-shopify-sme-emails`, `poll-platform-golive-emails`), `check-overdue-tasks`, the three scheduled report senders, and the Slack stuck-merchants digest. Wire via pg_cron hitting the stable app URL with a shared cron secret.
3. **Auth configuration** — email/password + Google sign-in setup, redirect URLs, password-reset and invite email templates, and the admin user-creation flow (`create-user` / `set-password` / `update-user` / `delete-user`) verified end to end.
4. **Route coverage audit** — the port created routes for `/`, `/brd`, `/portal`, `/portal/:mid`; confirm every screen reachable in the source app (auth callback, reset password, 404) has a route here, and replace remaining router-compat shims where they change behaviour.
5. **First tenant + admin bootstrap** — create the first tenant, super-admin user, and the checklist templates that new projects seed from (the DB is currently schema-only, so a new project seeds an empty checklist).
6. **End-to-end verification** — signed-in walkthrough with Playwright: create project, checklist, comments/tags, merchant portal magic-link flow, BRD form, reports, AI chat/insights, file uploads.
7. **Known small fixes** — `ai-chat` returns 500 on malformed input; error-shape parity pass across routes.
8. **Not ported** — the MCP server function (`mcp-server`), which no UI screen calls. Say the word if you want it.

## Technical notes

- Table: `public.tenant_integrations` keyed by `tenant_id`, RLS via existing `is_manager` / `is_super_admin` helpers plus `get_user_tenant_id`, grants to `authenticated` and `service_role`. Backend routes read it with the service-role client.
- Secrets are stored in the database rather than the platform secret store because they are per tenant; the platform store holds only one value per name.
- Reads/writes from the settings UI go through server routes that return masked values, so no secret is exposed to the client bundle or over the wire.
