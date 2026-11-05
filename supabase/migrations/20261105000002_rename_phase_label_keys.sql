-- Rename phase_* and field_current_phase_* label keys in app_settings so that
-- existing tenant label customisations carry over to the new key names.
--
-- app_settings is a (tenant_id, key, value) table, so we update the key column.

UPDATE public.app_settings
SET key = CASE key
  WHEN 'phase_mint'                   THEN 'stage_mint'
  WHEN 'phase_integration'            THEN 'stage_integration'
  WHEN 'phase_ms'                     THEN 'stage_ms'
  WHEN 'phase_completed'              THEN 'stage_completed'
  WHEN 'field_current_phase_comment'  THEN 'field_current_stage_comment'
  WHEN 'field_phase2_comment'         THEN 'field_stage2_comment'
  ELSE key
END
WHERE key IN (
  'phase_mint',
  'phase_integration',
  'phase_ms',
  'phase_completed',
  'field_current_phase_comment',
  'field_phase2_comment'
);
