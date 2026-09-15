# Buddy upgrade

Proposal page with mockups: "Buddy Upgrade Proposal" (artifact).

## Problem

From a read of `AiChatBot.tsx`, `BuddyBubble.tsx`, `ai-chat.ts`, `ai-actions.ts`:

- Buddy sees a one-line summary of the first 20 projects, sent by the browser;
  no checklists, tasks, risks, meetings, emails or Jira.
- It doesn't know which page or project is open.
- Approvals show database field names and IDs, with no before value.
- Chat history stores message text only; approvals and results are lost on reload.
- The floating bubble also renders on the Buddy tab (two assistants on one screen).
- Whether actions are allowed is decided in the browser and passed to the
  server; roles need enforcing server-side for every action.

## Phase 1 — Correct answers, clear actions (~2 weeks)

- [x] Server-side read tools (`src/lib/buddy/read-tools.server.ts`): search projects, get project (checklist, tasks, risks, transfers, notes, meetings with minutes, Jira), portfolio stats, list people. Service role with explicit workspace filter from `resolveUserScope`, and assigned-only scope for non-portfolio roles
- [x] Model loop runs on the server (`ai-chat.ts`): read tools execute and loop; proposed changes stream back for approval as events (step, sources, delta, actions, error)
- [x] Page context: the drawer sends the open path and project id; the server resolves the project itself
- [x] Action cards: plain labels, names not IDs, before → after, bulk list with count, typed confirmation above the limit
- [x] Persist actions, approvals, results, steps, sources and feedback with chat messages (`metadata` column, migration `20260915100000_buddy_chat_metadata.sql`; falls back to text-only until applied)
- [x] Server enforces action roles, workspace ownership, allowed fields and the bulk limit (25); client-sent `enableActions` removed
- [x] Undo for reversible actions within 10 minutes, using before-values stored in the activity log
- [x] Side drawer replaces the floating bubble; ⌘J / Ctrl+J; not rendered on the Buddy tab
- [x] Buddy tab: chat history with search, date groups, pins and delete-with-undo; context panel (scope, projects in chat, steps)
- [x] Answer styling: full-width assistant text, no read ticks or pattern background, steps and sources lines, markdown tables, copy / ask again / 👍👎, stop button, slash commands

Done when:
- [ ] Questions about project 21+ answer correctly on a 60-project workspace
- [ ] Buddy opened on a project page needs no project name
- [ ] No IDs or database field names in any approval
- [ ] A reloaded thread shows every approved action and its result
- [ ] The server refuses action requests from roles without permission

## Phase 2 — Proactive and more actions (~3 weeks)

- [ ] Daily brief (server-computed, once a day, max 5 items, each with one action)
- [ ] Project-page suggestions when items slip
- [ ] Handover summary on team transfer
- [ ] Meeting prep and recap from existing meetings and transcripts
- [ ] Actions: complete checklist item, add/assign task, set due date, transfer, archive, flag risk, schedule meeting, draft and send merchant email (preview required)
- [ ] Undo for recent actions using stored before-values

Done when:
- [ ] Brief counts match the dashboard's overdue and go-live figures
- [ ] Merchant email cannot send without preview and approval
- [ ] Undo restores previous values and logs both steps
- [ ] Brief open rate and actions taken are tracked

## Phase 3 — Reports and admin control (~2 weeks)

- [ ] Chart/table answers saved as reports; scheduling via existing report scheduler
- [ ] Usage view: questions, approvals/rejections, 👎 answers with context
- [ ] Per-workspace settings: allowed actions, bulk limit, custom instructions

Done when:
- [ ] "Go-lives by month" saves as a report that matches the Reports tab
- [ ] Switching off an action stops Buddy offering it
- [ ] 👎 answers are reviewable with the full conversation

## Decisions for sign-off (recommendations)

- [ ] Bulk change limit without second confirmation: 25 projects
- [ ] Merchant emails: allowed, always with preview and approval
- [ ] Undo window: 10 minutes
- [ ] Daily brief: everyone, on by default, switchable; managers see their team
- [ ] Model: keep Gemini 3 Flash via Lovable gateway for Phase 1; revisit after measuring

## Risks

- Wrong changes → approval on every action, bulk cap, undo, activity log
- AI cost growth → narrow lookups, brief computed without the model, usage tracked from Phase 1
- Cross-workspace data → lookups run under the same workspace rules, including support sessions
- Brief noise → max 5 items; open and dismiss rates decide the default
