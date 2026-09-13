# Super admin workspace scoping

## Problem

A super admin sees every workspace's data mixed together. The screens read
tables without a tenant filter and rely on RLS to hide other workspaces, and
RLS carries `OR is_super_admin(auth.uid())`, so for a super admin nothing is
hidden. Reaching a customer's data this way is silent: it leaves no record.

Survey (2026-09-13): 50 of 52 tables carry `tenant_id`; 35 of 103 client reads
have no tenant, project, user or id filter, across 25 tables.

## Goal

Every screen shows the workspace being worked in — your own, or the customer's
during a support session. Reaching another workspace goes through Tenants →
Set up (support access), which is logged. Nothing changes for non-super-admins.

## Phase 1 — Screens filter by the current workspace

- [x] Add `tenantScope` helper (`src/lib/tenant-scope.ts`): the current tenant, or an id matching no row, so a missing tenant shows nothing rather than everything
- [x] Projects list: `projects`, `project_credentials`, `profiles`, checklist items, responsibility logs, transfer history (`useProjects`)
- [x] Projects cache keys include the tenant
- [x] People pickers: `profiles` in AiChatBot, AssignOwnerDialog, ProjectAssignment, TransferDialog, WorkflowConfigFields, PlatformMerchants, ManagerDashboard, useProfilesLookup, useProjects (previous owner). `user_roles` lookups only yield ids, which then pass through the scoped profile lookup
- [x] User management: `profiles`; `user_roles` limited to those profiles
- [x] Activity: `useActivityLogs`, `useMovementReport` (activity, project comments, checklist comments)
- [x] Reports: `saved_reports` (ReportScheduler, ReportsBuilder, PivotTableSettings), `report_executions`, movement and TAT report schedules, portal visits
- [x] Settings: `custom_fields`, all custom field values, `ai_workflows`, checklist form templates and assignments, `checklist_templates` (ChecklistManagement, ChecklistFormsManager, template titles lookup), `teams`. `workflow_runs` and form fields are read by parent id, already scoped
- [x] Remove the super-admin cross-tenant template merge in ChecklistManagement
- [x] Email / merchant tabs: `parsed_emails`, `platform_merchants`, `shopify_sme_merchants`, `shopify_lt_thread_status`
- [x] Sales dashboard task stats: `checklist_tasks`; monthly go-live tracker projects
- [x] CSV upload duplicate-MID check scoped to the workspace
- [x] Re-run the survey with a stricter scan (filter calls only, not column names): only intended reads remain — Tenants page list and role-to-id lookups. The first scan missed 14 reads; all fixed
- [x] Typecheck, push (0 type errors; tenant added to hook dependencies so screens refetch on a workspace change)

## Phase 2 — The database enforces it

- [ ] `tenant_stats()` RPC for the Tenants page counts (super admin only)
- [ ] `create_tenant()` RPC so default teams are inserted server-side, not by the browser
- [ ] Confirm "Create Manager" goes through a service-role route
- [ ] Restrictive policy on the 48 tenant tables (not `tenant_access_grants` / `tenant_access_events`): super admins limited to `get_user_tenant_id(auth.uid())`
- [ ] Rollback script (drop the restrictive policies)
- [ ] Hand over the SQL, apply, verify

## Verification

- [ ] Super admin sees only their workspace; Tenants page counts correct
- [ ] Creating a tenant works
- [ ] Entering a customer via Set up shows only that customer
- [ ] Normal admin sees no change
- [ ] Merchant portal still loads
