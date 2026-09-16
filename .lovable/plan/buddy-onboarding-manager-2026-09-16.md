# Buddy as the workspace onboarding manager

Plan page: "Buddy Onboarding Manager Plan" (artifact).

## Decisions

- Keys and secrets may be pasted into chat. They're masked on the approval card,
  in the activity log and in the saved chat once approved; secret changes aren't undoable.
- Deleting teams and checklist steps is allowed, with the affected project count typed to confirm.
- Same permissions as Settings: managers set up processes; branding, email sending,
  people, integrations and Buddy's settings are admin-only.
- Automations that never ran are fixed, and Buddy only offers triggers the runner implements.

## Phase 1 — Core setup

- [x] Setup catalogue (`src/lib/buddy/setup-catalog.server.ts`): 15 areas, every key/value setting and integration field with label, type, validation, default and role
- [x] `get_workspace_setup` read tool (`setup-read.server.ts`): per-area status, current values, defaults, options, who can change it
- [x] Onboarding script in `ai-chat.ts`: progress, one area per message with every field, one approval per area, resume from live setup, admin-only areas handed off
- [x] Workspace terminology (renamed labels and team names) passed to Buddy so answers use the workspace's words
- [x] `/onboard` command; "Set up this workspace" card in Buddy while areas remain
- [x] Actions: update_workspace_settings, manage_teams, manage_checklist_steps, manage_custom_fields, set_project_stages, set_risk_rules
- [x] Per-action roles (`requires`), enforced in `ai-actions.ts` and used to filter the tools offered in chat
- [x] Undo across several tables per action (settings, teams, fields, steps, forms, automations, integrations, roles)
- [x] Labels load through the query cache (`LabelsContext`), so approved changes show without a reload; defaults moved to `src/data/defaultLabels.ts`

## Phase 2 — Admin areas

- [x] manage_checklist_forms (forms, questions, attach to steps)
- [x] create_workflow rebuilt with checked configs; manage_automations; run_automation
- [x] invite_people (account + set-password email) and change_user_role, via shared `src/lib/users.server.ts` (Settings → Users uses it too)
- [x] update_integration_settings, including secrets, masked everywhere after approval
- [x] update_buddy_settings (can't switch off its own settings action)

## Phase 3 — Automations that never ran

- [x] Runner moved to `src/lib/workflows.server.ts`, shared by run-workflows, Settings and Buddy
- [x] Time-based rules: run once a project has been in its state N days, then each check period while it stays
- [x] "Go-live date passed": once per expected go-live date
- [x] "Checklist step completed" queued by a checklist_items trigger, optionally narrowed to a step name
- [x] Manual rules can be run on chosen projects (Buddy's run_automation)
- [x] Scheduler job for run-workflows every 10 minutes; Buddy's approved changes drain the queue straight away
- [x] Shared option lists and checks (`src/data/workflowConfig.ts`) for Settings and Buddy; "New workflow" button in Settings → Workflows
- [x] Rename and recolour teams in Settings → Checklist → Team Management

## To apply

- [ ] Run `supabase/migrations/20260916120000_workflow_triggers_and_schedule.sql` (checklist-completed trigger and the run-workflows schedule). Until then, checklist-completed rules don't fire and time-based / go-live rules run only from "Run now" in Settings → Workflows.
- [ ] Walk through onboarding end to end in a test workspace, as an admin and as a manager

## Risks

- Adding a checklist step to existing projects reads up to 1,000 projects per workspace, as Settings does.
- Time-based rules use the latest recorded state change; projects whose state changed before the workflow engine existed count from creation.
