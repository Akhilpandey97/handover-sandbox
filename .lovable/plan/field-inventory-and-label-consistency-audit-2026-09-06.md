# Field inventory and label-consistency audit

## Part 1 — What fields exist, and what can be renamed

### A. Project fields (the core record behind every tab)

Renameable in Settings → Field Labels (26 labels, saved per workspace):

| Group | Fields |
|---|---|
| Identity | Merchant Name, MID, Category, Platform, Integration Type, Brand URL |
| Commercial | ARR, Txns/Day, AOV, PG Onboarding, Go-Live % |
| People | Sales SPOC, Assigned Owner |
| Dates | Start Date (Kick Off), Expected Go-Live Date, Actual Go-Live Date |
| Links | JIRA Link, BRD Link, MINT Checklist Link, Integration Checklist Link |
| Notes | Project Notes, MINT Notes, Current Phase Comment, Phase 2 Comment |

Also renameable elsewhere in Settings: team names (Team Management), project
states and stage names (Project Stages / Workflow), responsibility parties
(internal / merchant / neutral), all colours, checklist templates and checklist
forms, and which tabs and sub-tabs are visible (Navigation).

Fully customer-defined: **Custom Fields** (Settings → Custom Fields) — the
customer adds their own fields with their own names, types and options.

Not renameable (fixed by the system):

- The underlying data itself — a renamed "ARR" is still the same number, and
  removing a field is not possible, only relabelling it.
- Merchant Name and MID are always required to create a project.
- Portal credential fields (sandbox/production IDs, keys, base URLs).
- Jira ticket fields (key, status, assignee, priority) — these come from Jira.
- Email/parsed-mail fields, notification text, activity-log wording.
- Report metric names (TAT, weeks-per-checklist, movement counts).
- The CRM API field names (`merchant_name`, `mid`, `arr`, …) — deliberately
  stable so customer integrations don't break when labels change.

### B. Where each tab draws its fields

- Dashboard, Projects (Board / List / Go-Live / Kanban), Calendar, Risks,
  Archived, Go-Live Tracker → project fields + custom fields.
- Project detail page → project fields, checklist items (title, owner team,
  responsibility, due date, comments, attachments), tasks, activity, Jira, notes.
- Reports → project fields plus computed metrics.
- Settings → configuration of everything above.
- Users / Tenants → name, email, team, role.
- Customer Portal → a read-only subset: merchant name, platform, ARR, expected
  go-live, checklist with due dates, credentials, notes.

## Part 2 — Are renamed fields actually reflected everywhere?

Mostly yes, with four confirmed gaps.

Reflecting correctly today: add/edit project, bulk edit, project detail page,
project cards, Kanban, project list dialog, calendar, transfers, checklists,
all reports, report builder, pivot settings, CSV exports, users screen, and
both the team and sales dashboards.

Confirmed gaps:

1. **Customer Portal ignores renamed fields entirely.** The portal has no link
   to the label settings at all — it hardcodes "Platform", "ARR",
   "Expected Go-Live Date", "MERCHANT ID (MID)". A workspace that renames ARR to
   "Annual Contract Value" still shows "ARR" to its customers.
2. **Manager List View column headers are hardcoded** (Merchant Name, MID,
   Platform, ARR, Owner, Sales SPOC, Start Date, and 14 more). These headers
   also drive the column picker and the exported column names.
3. **Custom fields are missing from the project detail page and the portal.**
   They appear in add/edit/bulk/list/reports but not on the main project page a
   user opens most often.
4. **Custom fields are not workspace-scoped when read** — the list is fetched
   without filtering to the current workspace, so a multi-workspace setup can
   show another workspace's field names.

Minor: the default name for the internal responsibility party is still
"GoKwik" until a workspace overrides it.

## Part 3 — Proposed fixes

1. Route the Customer Portal through the same label configuration as the rest of
   the product (portal data endpoint returns the workspace's labels; portal
   renders them) so renamed fields reach customers too.
2. Replace the hardcoded List View column labels with the configured ones, so
   headers, the column picker and exports all follow the rename.
3. Render custom fields on the project detail page (and, for fields marked
   visible, in the portal overview).
4. Scope the custom-fields read to the current workspace.
5. Change the default internal-party name from "GoKwik" to "Internal Team".
6. **One place for team names.** Team names are edited in two places today —
   Settings → General → "Team Names" and Settings → Checklist → Team Management.
   Remove the "Team Names" boxes from General and make Team Management the only
   source, so a team renamed there shows up on every dashboard, badge, checklist
   group, transfer screen, report and export. Existing custom names already
   entered in General are carried over into Team Management so nothing is lost.

## Technical notes

- Labels live in `app_settings` (key/value per `tenant_id`) and are read through
  `LabelsContext` → `getLabel("field_*")`. 38 files consume it;
  `src/page-views/MerchantPortal.tsx` consumes none.
- Hardcoded column list: `src/components/ManagerDashboard.tsx` (the
  `merchantName … phase2Comment` array).
- Portal labels would come from `src/routes/api/public/merchant-portal-data.ts`
  (token-scoped) rather than a client read, since the portal is unauthenticated.
- `src/hooks/useCustomFields.ts` selects `custom_fields` with no `tenant_id`
  filter on read.
- `src/pages/ProjectWorkspace.tsx` does not import `CustomFieldsRenderer`.
- Team names: drop the `team_*` group from `SETTINGS_GROUPS` in
  `src/components/SettingsPanel.tsx` and build `teamLabels` in
  `LabelsContext` from `useTeams().teamLabelMap` (teams table) instead of the
  `team_mint / team_integration / team_ms` keys, keeping manager, super_admin
  and general as fixed role labels. Any existing `app_settings` team_* override
  is migrated into the matching `teams` row once.
