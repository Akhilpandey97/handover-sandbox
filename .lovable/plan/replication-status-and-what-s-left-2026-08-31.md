# Replication status and what's left

## Done

- **Database**: all 42 tables, enums, RLS policies, grants, 11 functions, 17 triggers, realtime on risks. Schema only (no rows), as agreed.
- **Storage**: 4 buckets live (brd-exports, checklist-attachments, merchant-portal-files, org-logos) with policies.
- **Frontend**: all 49 components, hooks, contexts, data, utils and the 4 page views ported. Routes `/`, `/brd`, `/portal`, `/portal/:mid` render; design tokens migrated to Tailwind v4; no type errors.
- **Auth**: signup/login wired through the app's own auth context, profile + role auto-created on signup.

## Not done yet — the whole backend logic layer

31 backend functions (~8,300 lines) from the original are not ported. Every screen that calls one still fails. Grouped by what they power:

1. **AI features** (ai-chat, kwikassist-ai-chat, ai-actions, ai-project-insights, ai-field-mapping) — the chat bot, insights and AI actions. Runs on Lovable AI, no key needed.
2. **User admin** (create-user, update-user, delete-user, set-password) — Tenant/User Management screens.
3. **Merchant-facing** (merchant-portal-data, brd-form-api, get-project-links, upload-project-pdf, send-platform-welcome) — the portal and BRD form.
4. **Email polling & Jira** (poll-emails, poll-platform-golive-emails, poll-shopify-sme-emails, fetch-project-emails, fetch-project-jira-tickets, shopify-lt-email-comms, enrich-golive-tracker) — needs Gmail + Jira credentials.
5. **Reports & notifications** (send-scheduled-report, send-scheduled-movement-report, send-scheduled-tat-report, send-movement-report, send-notification, check-overdue-tasks, slack-stuck-merchants-digest) — needs Resend + Slack.
6. **Shopify SME assignment** (assign-shopify-sme-owner, backfill-shopify-sme-assignments) and **sandbox-test**, **mcp-server**.

Also pending: 2 scheduled jobs (every 2h and every 4h pollers), and third-party credentials.

## How I'll port them

- Each becomes a TanStack server route under `src/routes/api/public/<same-name>` keeping the exact request/response shape, so the existing frontend calls keep working with a one-line base-URL change (`/functions/v1/x` → `/api/public/x`).
- Auth-sensitive ones verify the caller's bearer token inside the handler; cron-triggered ones check the shared cron secret.
- Deno APIs swapped for the Node/Workers equivalents (`Deno.env` → `process.env`, `npm:` imports → normal imports).
- AI calls repointed at the Lovable AI gateway (already has a key).
- The 2 cron jobs recreated against the new endpoints.

## Order of work

1. AI features + user admin (unblocks the main dashboards).
2. Merchant portal, BRD form, project links, PDF upload.
3. Reports, notifications, Slack digest, overdue checks.
4. Email polling, Jira sync, Shopify SME assignment, cron jobs.

## Credentials I'll need from you

- `RESEND_API_KEY` — outbound email
- `GOOGLE_MAIL_API_KEY` — Gmail polling
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` — Jira sync
- Slack webhook/token for the stuck-merchants digest

Everything else (AI, database, storage) runs on built-in credentials. I'll build each group so it degrades gracefully until its key is supplied.
