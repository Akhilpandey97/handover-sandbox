REVOKE EXECUTE ON FUNCTION public.checklist_items_sync_egl() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.projects_mark_manual_egl() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.projects_refill_auto_egl() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_expected_go_live(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_last_activity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_last_activity(uuid) TO authenticated;