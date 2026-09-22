# Compact draggable manager and user dashboards

## What will change

- Keep the existing KPI cards and add Not Started, Blocked and On-Hold boxes, renaming "In delivery" to "In Progress".
- Let each KPI box be dragged within the KPI bar and remember its position separately for managers and users.
- Split every combined dashboard section into its own draggable dashlet, including Team Workload, Incoming Projects, TAT, Delivery Stages, and Delivery Health.
- Rename “TAT booklet” to “TAT” everywhere it appears on these dashboards.
- Use a consistent two-column grid with equal-height dashlets, tighter headers, spacing, rows, and scrollable content where needed. - shrink size of the box too slightly length wise
- Keep manager data tenant-scoped and user data user-scoped, with all existing drill-downs and AI actions intact.

## Technical details

- Extend the saved ordering helper to support separate storage keys for each dashboard and for the KPI bar.
- Preserve accessible drag handles so buttons, tables, scrolling, and other controls continue to work normally.
- Make the manager and user dashboard structures match while retaining their different Team Workload/Incoming Projects content.
- Validate both signed-in dashboard variants at desktop size and run the relevant type checks.

## Security maintenance

- Restrict private BRD exports, checklist attachments, and merchant portal file reads to the matching tenant/project ownership, then close the three active storage findings.