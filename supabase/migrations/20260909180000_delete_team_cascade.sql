-- Deleting a team, atomically and in the right order.
--
-- The app issued three separate deletes: templates, then items, then the team.
-- checklist_items has four dependent tables whose foreign keys do not cascade,
-- so the items delete fails as soon as an item has a comment, task,
-- responsibility log or form response — which is true of any team that has been
-- used. With no transaction the templates were already gone by then, leaving the
-- team's items on every project with no template behind them.
--
-- The order below is the one the manual qa_team cleanup migration had to use.

CREATE OR REPLACE FUNCTION public.delete_team_cascade(_slug text, _team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _super  boolean;
BEGIN
  _tenant := public.get_user_tenant_id(auth.uid());
  _super  := public.is_super_admin(auth.uid());

  IF _tenant IS NULL AND NOT _super THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  -- Children of the checklist items, innermost first.
  DELETE FROM public.checklist_comments
   WHERE checklist_item_id IN (
     SELECT id FROM public.checklist_items
      WHERE owner_team = _slug AND (_super OR tenant_id = _tenant));

  DELETE FROM public.checklist_responsibility_logs
   WHERE checklist_item_id IN (
     SELECT id FROM public.checklist_items
      WHERE owner_team = _slug AND (_super OR tenant_id = _tenant));

  DELETE FROM public.checklist_tasks
   WHERE checklist_item_id IN (
     SELECT id FROM public.checklist_items
      WHERE owner_team = _slug AND (_super OR tenant_id = _tenant));

  DELETE FROM public.checklist_form_responses
   WHERE checklist_item_id IN (
     SELECT id FROM public.checklist_items
      WHERE owner_team = _slug AND (_super OR tenant_id = _tenant));

  DELETE FROM public.checklist_items
   WHERE owner_team = _slug AND (_super OR tenant_id = _tenant);

  -- Then the templates and what hangs off them.
  DELETE FROM public.checklist_form_assignments
   WHERE checklist_template_id IN (
     SELECT id FROM public.checklist_templates
      WHERE owner_team = _slug AND (_super OR tenant_id = _tenant));

  DELETE FROM public.checklist_templates
   WHERE owner_team = _slug AND (_super OR tenant_id = _tenant);

  DELETE FROM public.teams
   WHERE id = _team_id AND (_super OR tenant_id = _tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_team_cascade(text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_team_cascade(text, uuid) TO authenticated;
