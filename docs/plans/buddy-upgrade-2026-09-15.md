# Buddy upgrade

Proposal page with mockups: "Buddy Upgrade Proposal" (artifact).

## Problem

From a read of `AiChatBot.tsx`, `BuddyBubble.tsx`, `ai-chat.ts`, `ai-actions.ts`:

- Buddy saw a one-line summary of the first 20 projects, sent by the browser;
  no checklists, tasks, risks, meetings, emails or Jira.
- It didn't know which page or project was open.
- Approvals showed database field names and IDs, with no before value.
- Chat history stored message text only; approvals and results were lost on reload.
- The floating bubble also rendered on the Buddy tab (two assistants on one screen).
- Whether actions were allowed was decided in the browser and passed to the
  server; roles needed enforcing server-side for every action.

## Phase 1 — Correct answers, clear actions

- [x] Server-side read tools (`src/lib/buddy/read-tools.server.ts`): search projects, get project (checklist with item ids, tasks with ids, checklist comments, risks, transfers, notes, meetings with minutes, Jira), portfolio stats, list people. Service role with explicit workspace filter from `resolveUserScope`, and assigned-only scope for non-portfolio roles
- [x] Model loop runs on the server (`ai-chat.ts`): read tools execute and loop; proposed changes stream back for approval as events (step, sources, report, delta, actions, error)
- [x] Page context: the drawer sends the open path and project id; the server resolves the project itself
- [x] Action cards: plain labels, names not IDs, before → after, bulk list with count, typed confirmation above the limit
- [x] Persist actions, approvals, results, steps, sources, reports and feedback with chat messages (`metadata` column, migration `20260915100000_buddy_chat_metadata.sql`; falls back to text-only until applied)
- [x] Server enforces action roles, workspace ownership, allowed fields, workspace-disabled actions and the bulk limit; client-sent `enableActions` removed
- [x] Undo for reversible actions within 10 minutes, using before-values stored in the activity log (restores updates, removes created rows, puts back deleted rows)
- [x] Side drawer replaces the floating bubble; ⌘J / Ctrl+J; not rendered on the Buddy tab
- [x] Buddy tab: chat history with search, date groups, pins and delete-with-undo; context panel (scope, projects in chat, steps)
- [x] Answer styling: full-width assistant text, no read ticks or pattern background, steps and sources lines, markdown tables, copy / ask again / 👍👎, stop button, slash commands

Done when:
- [ ] Questions about project 21+ answer correctly on a 60-project workspace
- [ ] Buddy opened on a project page needs no project name
- [ ] No IDs or database field names in any approval
- [ ] A reloaded thread shows every approved action and its result
- [ ] The server refuses action requests from roles without permission

## Phase 2 — Proactive and more actions

- [x] Daily brief (`/api/public/buddy-brief`, computed without the model; max 5 items, each with one next step; dismiss for the day)
- [x] Project-page suggestions in the drawer: status line plus next steps (slipping, merchant follow-up, meeting prep, recap, handover, transfer)
- [x] Handover summary, meeting prep and meeting recap: prompts and slash commands (`/handover`, `/prep`, `/recap`) backed by get_project, which includes meetings and minutes
- [x] Actions: mark checklist item done / reopen, change due date, transfer to next team (mirrors the transfer dialog: pending acceptance, transfer history, email + notification), archive / restore, flag a risk
- [x] Create meeting link (Google Meet / Zoom / Teams) through the workspace's own account; with a checklist item it's saved there and calendar invites go out
- [x] Send email (merchant or anyone; editable subject and body in the card; nothing sends without approval; copy added to the project notes timeline)
- [x] Send notification to teammates (notification bell, optionally email)
- [x] Tasks: create (with assignee notification), complete or change status, delete — all with Undo
- [x] Comment on a checklist item (posted as the user; Undo removes it)
- [x] Toggle who holds a checklist item (internal team / merchant / neutral), with the same responsibility-log bookkeeping as the checklist; project-level toggle kept
- [x] @ in the composer tags checklist items of the open project, or of any project already @-mentioned in the message
- [x] Brief views and next steps taken are logged for the usage view

Not undoable by design: transfers (the receiving team accepts or returns), emails, notifications, meeting links, BRD forms, automations, new projects.

Done when:
- [ ] Brief counts match the dashboard's overdue and go-live figures (definitions in `buddy-brief.ts`)
- [ ] Merchant email cannot send without preview and approval
- [ ] Undo restores previous values and logs both steps
- [ ] Brief open rate and actions taken are visible in Settings → Buddy

## Phase 3 — Reports and admin control

- [x] Report answers: `build_report` returns a table and chart (bar, or line for go-live months), shown in the chat with CSV download
- [x] Save to Reports for project lists (column keys match the Reports builder). Saved reports store columns only, so filters from the question aren't kept — the card says so
- [x] More chart forms: column, horizontal bar, line, area, pie, donut, stacked, grouped and multi-line (with a second dimension), plus headline number tiles; a switcher offers only the forms that fit the data, and the table is always there. Colours are the validated categorical palette (`--series-1…8`, checked against the light and dark card surfaces); pies cap at 6 slices and splits at 8 series, the rest folding into "Other"
- [x] Usage view (Settings → Buddy): questions (counted without text), people, actions done / cancelled / undone / failed, approval rate, most used actions, brief use, 👎 answers with question and answer
- [x] Per-workspace settings (admins): switch actions off, bulk limit, instructions for Buddy, daily brief on/off — all enforced on the server

Done when:
- [ ] "Go-lives by month" builds a chart that matches the Reports tab counts
- [ ] Switching off an action stops Buddy offering or running it
- [ ] 👎 answers are reviewable with the question and answer

## Decisions (applied as recommended)

- [x] Bulk change limit without typed confirmation: 25 projects (adjustable per workspace)
- [x] Merchant emails: allowed, always with an editable preview and approval
- [x] Undo window: 10 minutes
- [x] Daily brief: everyone, on by default, dismissible per day; workspace switch in Settings → Buddy
- [x] Model: Gemini 3 Flash via the Lovable gateway

## To apply

- [x] Run `supabase/migrations/20260915100000_buddy_chat_metadata.sql` (adds `chat_messages.metadata` and an update policy) — applied 2026-09-15
- [ ] Walk through the "Done when" checks above in the app

## Risks

- Wrong changes → approval on every action, bulk limit, undo, activity log
- AI cost growth → narrow lookups, brief computed without the model, usage tracked per question
- Cross-workspace data → every lookup and action filters by the caller's workspace, including support sessions
- Brief noise → max 5 items; views and next steps taken are tracked
