-- Mention notifications know which checklist item they belong to but not which
-- comment, so opening one could only scroll to the item. Storing the comment id
-- lets the notification link land on the exact comment.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS comment_id uuid;
