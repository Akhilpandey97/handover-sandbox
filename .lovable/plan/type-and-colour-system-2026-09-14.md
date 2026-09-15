# Type and colour system cleanup

## Problem

Audit (2026-09-14, published as "Handover Type & Colour Audit"):

- 30% of colour classes (1,066) used raw Tailwind hues; the theme's success,
  warning, info and pending tokens had zero uses. The same state got different
  colours on different screens, and 217 lines had no dark-mode colour.
- 91 text uses of hand-picked status colours measured below 4.5:1 contrast;
  muted text on muted backgrounds failed at 4.36:1.
- 217 one-off pixel text sizes, down to 8px; the Badge component was 11px.
- Headings had no levels (`h1` in 7 size/weight combinations).
- Hard-coded hex palettes in the project workspace, guided tour and merchant
  portal; duplicated font stacks and 7 one-off letter-spacing values.

## Fixes

### 1. Status colours through theme tokens

- [x] Add `-soft` (tinted background) and `-strong` (text on soft or card, ≥ 4.5:1) variants for success, warning, destructive, info and pending, light and dark. All ten text pairs measured 5.8–9.5:1
- [x] Rewrite raw status hues by role: emerald/green → success, amber/yellow/orange → warning, red/rose → destructive, blue/cyan → info, sky → pending. Pale backgrounds → `-soft`, text → `-strong`, solids → base, borders → base at low opacity. 573 classes in 72 files, plus 3 bracket-prefixed toggle/tab states by hand
- [x] Drop the matching `dark:` hue overrides (285; tokens switch themselves)
- [x] White text on a solid status fill → that tone's `-foreground` (22). Warning's foreground is dark ink: white on amber was 2.46:1
- [x] Leave categorical hues alone: purple, indigo, violet, teal, lime, slate, gray; team colour maps (`data/teams.ts`, `UserManagement`) and the activity-type map in `ActivityLogViewer`

### 2. Text size floor

- [x] Add `text-2xs` (11px / 16px line) to `@theme`
- [x] Replace `text-[8px]`, `[9px]`, `[10px]`, `[11px]` with `text-2xs`; `[13px]` → `text-sm`; `[16px]` → `text-base`; `[0.8rem]` → `text-xs` (217 → 0)

### 3. Heading levels

- [x] `@utility` classes: `heading-page` (24px semibold), `heading-section` (18px semibold), `heading-card` (14px semibold), `eyebrow` (11px uppercase, wide tracking, muted)
- [x] Applied to 50 raw `h1`–`h3` headings; brand names, the 404 display and BRD completion screens keep their own treatment
- [x] Dialog titles 18px → 16px. Changed from the audit's 14px: at 14px a dialog title matches its body text and loses its hierarchy
- [x] Card and dialog titles keep plain Tailwind classes (not the utilities) so `cn()` overrides passed by callers still merge

### 4. Muted text contrast

- [x] `--muted-foreground` 205 16% 45% → 205 18% 40% (4.36 → 5.25:1 on muted, 5.72:1 on cards)

### 5. Hard-coded palettes onto tokens

- [x] Project workspace status, activity and panel hex classes → tokens (all removed)
- [x] Guided tour panel → `popover` / `border` / `muted` tokens
- [x] Merchant portal `BRAND`: status colours → theme tokens; unused keys removed. Primary/accent stay hex (Handover navy; some styles append alpha digits)
- [x] Left as is: movement report email HTML, Google logo, standalone error page, per-workspace colour presets, shadcn toast destructive variant, BRD form chat background

### 6. Font setup

- [x] Font stacks only in `@theme`; base styles use `var(--font-sans)` / `var(--font-mono)`
- [x] Remove unused `--font-display`
- [x] Drop Inter 800 from the Google Fonts request (no `font-extrabold` in use)
- [x] One-off letter-spacing → named `tracking-*` steps (15 → 0)

## How it was applied

Raw-text codemod on exact class names, never tokenising strings; every changed
line checked to differ from HEAD only in class names (0 exceptions). A first
attempt that tokenised string literals broke `AiChatBot.tsx`; all files were
restored from HEAD and redone with the safer codemod.

### 7. Emails and standalone HTML (missed by the first pass)

The first audit only scanned the app UI; server routes under `src/routes/api`
were excluded, and email HTML was wrongly marked "left as is". Emails can't read
CSS variables, but they can use the same hex values as the light theme.

- [x] 11 templates onto Handover hex: notifications (assignment, transfer, rejection), scheduled report, movement report (server + in-app copy), TAT report, password reset, meeting invite, platform welcome, merchant portal magic link, stuck-merchants digest, error page
- [x] Gradients → solid: headers `#1d3a5c` (navy), buttons and links `#24598a` (primary), rejection / blocked `#ad1f1f`
- [x] Text `#11263b` / `#3b5466` / `#546978`; lines `#d5e0e6`; grounds `#f7fafc` / `#eef3f6`; status pairs from the theme. Faint greys (`#94a3b8`) moved up to muted: they measured below 4.5:1
- [x] Emoji removed from email subjects and headings
- [x] Guided tour default `brandColor` `#1e3a8a` → `#24598a`
- [ ] Sender names still say "MINT Updates" / "MINT Alerts"

## Verification

- [x] Typecheck 0 errors; production build passes; new utilities present in built CSS
- [x] Lint: no new non-formatting findings across 78 files
- [x] Re-run audit counts: raw status hues ~900 → categorical only; low-contrast status text 91 → 0; pixel sizes 217 → 0; hex classes ~50 → 1 (decorative)
- [ ] Light and dark: dashboard, project cards, project workspace, BRD form, merchant portal, dialogs
