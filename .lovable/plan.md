# Project Phases logic — no code changes

## Goal
Answer the user's question about how Project Phases work in Handover. No implementation is required.

## Current logic

1. **Data model**
   - `ProjectPhase` is a hard-coded enum in `src/data/projectsData.ts`: `mint | integration | ms | completed`.
   - Each project stores its phase in `projects.current_phase` (mapped to `project.currentPhase`).

2. **Display labels**
   - The names shown in the UI come from `LabelsContext` (`src/contexts/LabelsContext.tsx`):
     - `phase_mint` → "MINT"
     - `phase_integration` → "Integration"
     - `phase_ms` → "MS"
     - `phase_completed` → "Completed"
   - These can be renamed per tenant in **Settings → Workflow → Project Phases** (`src/components/SettingsPanel.tsx`).

3. **Phase transitions**
   - Phases advance automatically when a project is transferred to the next owning team (`src/hooks/useProjects.ts`, `useTransferProject`):
     - `mint` → `integration`
     - `integration` → `ms`
   - Rejecting a transfer moves the project back (`useRejectProject`):
     - `ms` → `integration`
     - `integration` → `mint`
   - `completed` is a terminal phase used for filtering and reporting; it is not set automatically by transfer.

4. **Relation to other concepts**
   - **Team ownership:** `currentOwnerTeam` mirrors the phase (`mint`, `integration`, `ms`).
   - **Checklists:** Default checklist items are grouped by phase in `createDefaultChecklist()` — MINT items first, then Integration items.
   - **Funnel stages:** The Sales / Pre Integration / Under Integration / Live funnel is computed separately in `src/data/funnelConfig.ts` from checklist completion and project state. It is not the same as `currentPhase`.

## Outcome
No code changes. The user now has a map of where phases are defined, how they move, and how they differ from funnel stages.
