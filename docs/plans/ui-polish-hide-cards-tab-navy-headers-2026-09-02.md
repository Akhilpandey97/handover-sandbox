# UI Polish: Hide Cards Tab + Navy Headers

## Goal

Tidy the Projects tab switcher and unify Kanban, List view, and Go-Live Tracker headers with the same navy sidebar tone used in the main navigation.

## Changes

1. **Hide the "Cards" sub-tab**
  - File: `src/components/ManagerDashboard.tsx`
  - Remove the `{ value: "board", label: "Cards", ... }` entry from the Projects view switcher (around line 1176).
  - Keep Kanban, List, and Go-Live Tracker visible.
2. **Navy header styling**
  - **Kanban columns**: `src/components/KanbanBoard.tsx`
    - Replace the column header background (`col.bg`) on the `border-b` header row with `bg-sidebar` and use `text-sidebar-foreground` for the title/count text.
  - **List view table**: `src/components/ManagerDashboard.tsx`
    - Apply `bg-sidebar text-sidebar-foreground` to the `TableHeader` / `TableRow` used in the List view (around line 1991).
  - **Go-Live Tracker table**: `src/components/MonthlyGoLiveTracker.tsx`
    - Apply `bg-sidebar text-sidebar-foreground` to both `TableHeader` instances (around lines 358 and 482).

## Out of scope

- No data, filters, sorting, or navigation behavior changes.
- No other tabs or dashboards touched.

## Verification

- TypeScript typecheck passes.
- App root returns HTTP 200.
- UI review confirms the Cards tab is gone and the three views show navy headers with readable text.  
