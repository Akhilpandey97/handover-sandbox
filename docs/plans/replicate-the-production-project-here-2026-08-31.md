# Replicate the production project here

Goal: rebuild the uploaded app (Kwik project/merchant delivery tracker) in this project — database, backend logic, integrations, and full UI — with an empty database (no production data copied).

## What the source app contains

- 42 tables (projects, checklists + forms + responses, custom fields, teams, tenants, profiles/user_roles, emails, Jira tickets, risks, reports/schedules, merchant portal, Shopify SME/LT, activity logs, AI workflows), 66 migrations, 4 storage buckets, 2 cron jobs.
- ~30 backend functions: AI chat/insights/actions/field-mapping, user admin (create/update/delete/set-password), email polling (Gmail), Jira sync, Resend notifications and scheduled reports (movement/TAT), Slack digests, merchant portal + BRD form APIs, MCP server, PDF upload.
- ~80 screens/components: kanban board, dashboards (manager, team, sales, executive, risk), calendar, reports suite, settings (custom fields, funnel stages, workflows, checklist forms, themes, Slack alerts), tenant/user management, merchant portal, BRD form, guided tour, AI chatbot.

## Stack translation

This project runs TanStack Start (React 19, TanStack Router, Tailwind v4). The source is a Vite SPA on React Router with Supabase Edge Functions. Behaviour and UI stay identical; the plumbing is ported:

- Pages `src/pages/*` and the React Router tree become file routes under `src/routes/`; protected screens go under `_authenticated/`.
- All components, hooks, contexts, utils and the design system are copied nearly verbatim (shadcn/Tailwind, tokens migrated from `tailwind.config.ts` into `src/styles.css` `@theme`).
- Edge functions become TanStack server functions (`*.functions.ts`) for app-internal logic, and server routes under `src/routes/api/public/*` for external callers: BRD form API, merchant portal data, Slack, MCP, cron-triggered reports/polling.
- AI functions move to the Lovable AI gateway (no key needed from you).
- Cron jobs (`pg_cron`) re-created to call the new public endpoints.

## Phases

### Phase 1 — Backend (first)
1. Enable Lovable Cloud.
2. Apply the full schema as consolidated migrations: enums, 42 tables with grants, RLS policies, `has_role`-style security-definer functions, triggers, views, 4 storage buckets + their policies.
3. Port user/auth backend: profiles + user_roles, signup trigger, admin create/update/delete user, set-password.
4. Port the remaining backend functions in groups: projects/checklists/custom fields, AI, email polling + parsing, Jira, reports + scheduling, merchant portal + BRD, Slack digest, MCP server.
5. Re-create the 2 scheduled jobs.
6. Collect integration keys: Resend, Jira (token, base URL, email), Google Mail API key, Slack, MCP auth token. AI needs no key.
7. Verify: run each endpoint once and confirm responses.

### Phase 2 — UI
1. Auth/login screen and route guards.
2. Core: Index shell, kanban, project dialogs, project details, calendar.
3. Dashboards: manager, team, sales, executive, risk, monthly go-live tracker.
4. Reports suite incl. exports (xlsx/CSV) and schedulers.
5. Settings, tenant/user management, checklist management, AI chatbot, guided tour.
6. Public pages: merchant portal, BRD form.
7. Per-route head metadata, theme presets, dark mode.

## Notes

- Database starts empty; you'll need to create the first admin user (or I can seed one via a migration on request). If you later want production data, export it from the source project and upload the dump — I'll import it.
- Any behaviour that depended on Deno-only APIs in edge functions is re-implemented with Worker-compatible equivalents.
- This is a large port; I'll work in the phase order above and report progress as each group lands.
