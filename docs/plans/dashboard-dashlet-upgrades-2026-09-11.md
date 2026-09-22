# Dashboard dashlet upgrades

## What will change

### 1. TAT dashlet — stage breakdown

- Add a summary row of average turnaround per configured project stage (stages come from each tenant's own stage settings, so every tenant sees its own list).
- Add per-stage day columns to the merchant list, next to the existing total TAT, so you can see where the time went for each live merchant.
- Keep the existing Merchants / Total ARR / Avg TAT boxes, the scrolling list and the compact card size.

### 2. Team workload uses the full space (managers only)

- The manager Team workload dashlet becomes a full-width section so its rows use the whole row instead of leaving the lower half empty.
- Rows stretch to fill the available height; content stays scrollable when there are many teams.

### 3. Incoming projects — simplified (users only)

- The user dashboard Incoming projects dashlet shows just the project name with Accept and Reject buttons per row.
- No cards, badges or extra metrics; both actions work inline without leaving the dashboard.

### 4. Dashlet builder

- An "Edit dashboard" button in the dashboard header opens a small panel listing every available dashlet with a show/hide toggle.
- Hidden dashlets disappear from the grid immediately; visible ones stay draggable as today.
- Choices are remembered per browser, separately for the manager and user dashboards, alongside the existing order preference.
- Everything happens in place — the panel is an overlay on the dashboard, no navigation away.
- Give an option to create the dashlet as from from all the availalable fields in the product each tenant

## Technical details

- Extend `useDashletOrder` with a hidden-set stored under a sibling localStorage key, exposing `visible`, `toggle` and `reset`; both dashboards render only visible ids.
- Add a `DashletBuilder` sheet/popover component listing dashlet ids with friendly labels, reused by `ManagerDashboard` and `TeamDashboard`.
- `TATDashlet` derives per-stage durations from checklist item completion timestamps grouped by the tenant's funnel stages (`useFunnelConfig` / `getActiveFunnelStages`), falling back to blank cells when timestamps are missing.
- Team workload slot gets `lg:col-span-2` and loses the fixed `max-h-[24rem]` cap.
- Incoming projects rows call the existing accept/reject project actions already used elsewhere in the app.
- Validate with a typecheck and a desktop-size render of both dashboards.