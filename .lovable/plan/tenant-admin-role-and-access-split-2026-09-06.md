# Tenant Admin role and access split

## What the audit found today

User management
- Users are listed from the profiles table, joined with their role. Visibility is already limited to the signed-in person's own organisation (super admin sees all).
- Anyone with the Manager role can create, edit, delete users and reset passwords.
- The create/update/delete user endpoints check only that the caller is Manager or Super Admin. They do not verify the target user belongs to the caller's organisation, and the edit endpoint does not re-stamp the organisation on role changes. This is a real cross-tenant gap to close.
- Role choices come from the team list, so today "Manager" is effectively the tenant owner and there is no separate Admin.

Tenant management
- Only Super Admin sees the Tenants area; they can create organisations, edit them, and create a manager for a tenant.
- Integrations (email, Gmail, Jira, Slack) and API keys are limited to Manager or Super Admin within the organisation.
- Settings (general, labels, checklists, stages, colours, navigation and so on) are readable by everyone in the organisation and editable by Manager or Super Admin.

## What will change

1. Add a new per-organisation role: **Admin** (tenant owner).
2. Split access:
   - **Admin** — everything inside their organisation: all settings, integrations, API keys, organisation branding, and full user administration (create, edit, delete, reset passwords, assign roles).
   - **Manager** — all operational tenant settings (labels, custom fields, checklists, forms, stages, colours, navigation, reports, workflows, activity log) plus full project work. Cannot manage users, integrations, API keys or organisation branding.
   - Team roles (Sales, MINT, Merchant Success, General) unchanged.
   - **Super Admin** unchanged: everything, across all organisations.
3. The 2 existing Manager accounts are promoted to Admin so nothing they can do today is lost.
4. Close the cross-tenant gaps in the user endpoints so an Admin can only touch users inside their own organisation.

## Access matrix

```text
Area                          Super Admin  Admin  Manager  Team roles
Organisations (tenants)            yes      no      no        no
Users & roles                      yes     yes      no        no
Integrations / API keys            yes     yes      no        no
Organisation branding              yes     yes      no        no
All other settings                 yes     yes     yes        no
Projects, checklists, reports      yes     yes     yes       yes (own scope)
```

## Technical notes

- Add `admin` to the role vocabulary (`user_roles.role` text, team list, labels, colours) and a database helper `is_tenant_admin(uuid)`; extend `is_manager` checks in policies for user_roles, profiles, app_settings and tenant_integrations to accept Admin, and narrow the ones that should be Admin-only (tenant_integrations, api_keys) so Manager loses them.
- Data change (separate step): update the 2 existing manager rows in `user_roles` and their profile team to `admin`.
- Server endpoints `create-user`, `update-user`, `delete-user`, `set-password`: allow Admin and Super Admin only, and enforce that requester tenant equals target tenant (Super Admin exempt); stamp tenant on role updates.
- Frontend: a small `usePermissions` helper derived from the auth context (`canManageUsers`, `canManageIntegrations`, `canManageSettings`, `isTenantAdmin`). Manager dashboard hides the Users and Integrations settings sections for Managers; the Add User role dropdown offers Admin only to Admin/Super Admin; Super Admin keeps the Tenants tab.
- No new tables. Role stays in `user_roles`, never on profiles as the source of truth.
