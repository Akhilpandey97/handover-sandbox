-- §8.5 SLA tracking: add sla_days column to checklist_items
-- Populated by seed trigger from templates.standard_duration at project creation.
-- After item completion, actual_days = completed_at - start_date is compared to sla_days.
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS sla_days int DEFAULT null;
