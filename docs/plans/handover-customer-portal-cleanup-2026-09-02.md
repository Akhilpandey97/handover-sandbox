# Handover Customer Portal cleanup

## 1. Remove GoKwik branding
The portal still carries GoKwik naming and logo colours in `src/page-views/MerchantPortal.tsx`:
- Login/header logo renders "Kwik" + "Assist" wordmark, and "Powered by GoKwik · KwikAssist AI".
- Default org name falls back to "GoKwik".
- Copy in explainer panel, login helper text, FAQ/AI chat prompts, docs and validator pages mention GoKwik.

Change: replace the wordmark with a Handover logo/wordmark, fall back to "Handover" as the org name, and rewrite all visible GoKwik copy to Handover / "your integration team". GoKwik product-specific pages (KwikPass, MCP, credentials base URLs) keep their technical URLs where they are real API endpoints, but their descriptive text drops the GoKwik brand name.

## 2. Colour theme #30658F
Repoint the portal `BRAND` palette to the dashboard navy: `primary: #30658F`, a lighter hover shade, and a matching soft tint. This automatically updates the sidebar active state, header icons, buttons, progress bars, chat widget, login card, and guided tour highlight, since every one of them reads from `BRAND`.

## 3. Removals
- Sidebar "Developer Tools" heading and the "Merchant Validator" item; the validator page component and its route case are dropped along with its tour step.
- Sidebar "Environment" block with the Sandbox ACTIVE / Production PENDING rows.

## 4. Checklist visibility + due dates
The portal API (`src/routes/api/public/merchant-portal-data.ts`) filters checklist items down to a hard-coded list of nine standard MINT titles, so any other checklist item on the project is hidden.

Change: return all non-task checklist items for the project (ordered by phase then sort order) instead of the nine-title whitelist, keeping the existing progress calculation over the full set. `due_date` is already returned but is not rendered — the integration page checklist/stage list will show each item's due date (formatted, with an overdue/incomplete emphasis when the date has passed).

## 5. Right information panel
Remove `SideExplainerPanel` entirely — the component, its `PAGE_EXPLAINERS` data, the render slot, and the related guided-tour step — letting main content span full width.

## Technical notes
- Files: `src/page-views/MerchantPortal.tsx` (majority), `src/routes/api/public/merchant-portal-data.ts` (checklist query/filter).
- The stage tracker derives stages from the returned checklist, so it will grow to cover all items once the filter is lifted.
- No schema or data changes; no dashboard files touched.
