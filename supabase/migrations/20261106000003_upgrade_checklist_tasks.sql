-- §12.1 Upgrade checklist_tasks schema
-- Adds: start_date, sort_order, assigned_to_ext, is_client_visible, estimated_hours
ALTER TABLE public.checklist_tasks
  ADD COLUMN IF NOT EXISTS start_date        date          DEFAULT null,
  ADD COLUMN IF NOT EXISTS sort_order        int           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_to_ext   text          DEFAULT null,
  ADD COLUMN IF NOT EXISTS is_client_visible boolean       DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_hours   numeric(5,1)  DEFAULT null;
