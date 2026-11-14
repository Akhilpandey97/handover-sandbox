-- Add is_client_visible to checklist_items.
-- NULL = visible (default, matches existing behavior).
-- FALSE = explicitly hidden from the merchant portal.

ALTER TABLE checklist_items
  ADD COLUMN IF NOT EXISTS is_client_visible boolean DEFAULT NULL;
