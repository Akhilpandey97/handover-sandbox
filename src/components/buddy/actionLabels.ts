import type { BuddyAction } from "./types";

const ACTION_LABELS: Record<string, string> = {
  assign_owner: "Assign owner",
  update_project_field: "Update project",
  bulk_update_projects: "Update several projects",
  toggle_responsibility: "Change who it's waiting on",
  trigger_brd: "Send BRD form",
  create_workflow: "Create automation",
  create_project: "Create project",
};

/** The card title for an action: the server's preview title, or a readable fallback. */
export const actionTitle = (a: BuddyAction) => a.preview?.title || ACTION_LABELS[a.name] || a.name.replace(/_/g, " ");
