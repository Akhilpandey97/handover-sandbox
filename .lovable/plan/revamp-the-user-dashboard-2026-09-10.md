# Revamp the user dashboard

## Goal
Rebuild the standard user dashboard with the manager dashboard’s exact visual structure and interaction patterns, while keeping every data view limited to what the signed-in user is allowed to see.

## What will change

### Shared dashboard shell
- Replace the current persistent top bar and older fixed sidebar with the manager-style full-height, collapsible navy sidebar.
- Put Search, Notifications, and the collapse control beside the logo at the top-left.
- Put the user account, dark-mode control, and Logout at the bottom-left, matching the manager dashboard.
- Preserve the same compact collapsed rail, spacing, active states, icon treatment, surfaces, and responsive behavior.

### Left navigation
- Add **Workbench** as the user landing page.
- Add **Projects**, containing only **Kanban** and **Go-Live Tracker** views with the same controls, filters, grouping, column selection, and layout as the manager dashboard.
- Rename **Hi There** to **Buddy** everywhere it appears in navigation, headings, and page metadata.
- Remove the entire **AI Alerts** area, including Generate/Refresh and its empty-state text.

### Workbench
- Reuse the manager dashboard’s dashboard cards and dashlets, with all values computed only from the user-visible project set.
- Exclude the manager-only Team Workload dashlet.
- Add an **Incoming projects** dashlet showing projects assigned to the signed-in user that are awaiting acceptance, with the existing accept/reject workflow available from each project.
- Keep the manager dashboard’s drill-down behavior, risk indicators, TAT, attention, EGL, and delivery views where the user has access.

### User-scoped Projects
- Feed both Kanban and Go-Live Tracker only projects assigned to the signed-in user and allowed by their role/team.
- Ensure search, filters, counts, risk badges, month selection, sorting, selected columns, project links, and saved Kanban arrangement operate on that scoped set.
- Prevent the Go-Live Tracker’s direct data load from widening the user’s view beyond their assigned projects.

### Buddy language by role
- Keep the existing Buddy assistant and chat history.
- Change its visible welcome/help language according to the signed-in user’s role: operational users receive project-focused wording, while Manager/Admin/Super Admin retain portfolio and action-oriented wording.
- Keep existing action permissions unchanged.

## Technical approach
- Refactor shared manager-style shell and dashboard presentation into reusable pieces rather than maintaining two visually divergent copies.
- Make the user dashboard URL-aware for Workbench, Projects/Kanban, Projects/Go-Live, and Buddy using the existing dashboard routes.
- Add scoped project inputs to shared dashlets and trackers where they currently read the full project collection internally.
- Preserve all current manager/admin screens and permissions.
- Add focused tests for project scoping, incoming acceptance, and route/view selection; verify desktop and mobile layouts in the running preview.

## Security hardening
- Restrict authenticated reads for BRD exports, checklist attachments, and merchant portal files to the matching tenant/project ownership instead of allowing every signed-in user to read every file.
- Validate the updated policies against the existing upload and signed-link flows so legitimate users retain access.
