# Reliable return navigation for Projects

## Goal
Make the **Projects** breadcrumb always return to the exact Projects screen that opened the project, without relying on browser history.

## Implementation
1. Add stable routes for the three manager Projects views:
   - `/projects/kanban`
   - `/projects/list`
   - `/projects/go-live`
2. Make the Projects tabs update the URL when switching views, while preserving the existing search, filters, sorting, and screen layouts.
3. Update project links from Kanban, List, and Go-Live Tracker to include their source view when opening `/projects/$projectId`.
4. Replace the breadcrumb’s browser-history behavior with deterministic navigation back to the recorded source route.
5. Use `/projects/kanban` as the fallback when a project detail page is opened directly or from a notification without a Projects source.
6. Keep links opened from non-Projects areas, such as team dashboards, returning to their appropriate existing screen rather than forcing a manager-only view.

## Technical details
- Add route files for each new static Projects URL; the existing `/projects/$projectId` detail route remains unchanged and static routes take precedence.
- Extend the project-detail search validation with a small validated return-view value rather than accepting an arbitrary redirect URL.
- Replace in-memory-only project view changes with TanStack Router navigation so refreshes, copied links, and browser navigation preserve the selected view.
- Update all project-opening controls in the three Projects views, including row, card, title, and tracker links.

## Verification
- Open a project from Kanban, List, and Go-Live Tracker, click **Projects**, and confirm each returns to its originating view.
- Refresh each Projects URL and confirm the same view remains selected.
- Open a project detail URL directly and confirm **Projects** falls back to Kanban.
- Confirm checklist notification deep links still open the intended project, checklist item, and task.
