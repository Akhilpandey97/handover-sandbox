-- S1: add start_date and status to checklist_items for Kanban/Gantt views.
-- checklist_status enum is shared with checklist_tasks (created here if not existing).
-- completed boolean stays as-is for backward compatibility; app layer keeps them in sync.

DO $$ BEGIN
  CREATE TYPE public.checklist_status AS ENUM ('todo', 'in_progress', 'blocked', 'done');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS start_date date     DEFAULT null,
  ADD COLUMN IF NOT EXISTS status    public.checklist_status DEFAULT 'todo';

-- Back-fill: items already marked completed should be 'done'
UPDATE public.checklist_items SET status = 'done' WHERE completed = true;
