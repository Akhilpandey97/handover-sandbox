UPDATE public.checklist_items ci
SET due_date = (p.kick_off_date + (t.standard_duration || ' days')::interval)::date
FROM public.projects p, public.checklist_templates t
WHERE ci.project_id = p.id
  AND t.tenant_id IS NOT DISTINCT FROM ci.tenant_id
  AND t.title = ci.title
  AND ci.due_date IS NULL
  AND t.standard_duration IS NOT NULL
  AND t.standard_duration > 0;