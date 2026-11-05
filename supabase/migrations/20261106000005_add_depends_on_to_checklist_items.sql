-- §7.4 Dependency arrows: add depends_on column to checklist_items
-- uuid[] array — each element is an id of a checklist_item this item depends on.
-- No FK array constraints in Postgres; application-level validation is sufficient.
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS depends_on uuid[] DEFAULT null;
