-- Allow checklist_comments to be linked to a specific checklist_task.
-- checklist_item_id stays required (comment always belongs to a milestone).
-- checklist_task_id is optional — set only when the comment came from a task completion note.
-- Comments with a task_id appear in the parent item's comment thread with a task attribution label.

ALTER TABLE public.checklist_comments
  ADD COLUMN checklist_task_id uuid DEFAULT NULL
  REFERENCES public.checklist_tasks(id) ON DELETE CASCADE;

CREATE INDEX checklist_comments_task_id_idx
  ON public.checklist_comments(checklist_task_id);
