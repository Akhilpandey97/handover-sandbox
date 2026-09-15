import type { BuddyAction } from "./types";

export const ACTION_LABELS: Record<string, string> = {
  assign_owner: "Assign owner",
  update_project_field: "Update project",
  bulk_update_projects: "Update several projects",
  toggle_responsibility: "Change who a project is waiting on",
  trigger_brd: "Send BRD form",
  create_workflow: "Create automation",
  create_project: "Create project",
  complete_checklist_item: "Mark checklist items done",
  set_checklist_due_date: "Change checklist due dates",
  toggle_item_responsibility: "Change who holds a checklist item",
  add_checklist_comment: "Comment on checklist items",
  add_task: "Add tasks",
  update_task_status: "Complete or reopen tasks",
  delete_task: "Delete tasks",
  transfer_project: "Transfer to next team",
  archive_project: "Archive projects",
  flag_risk: "Flag risks",
  create_meeting_link: "Create meeting links",
  send_email: "Send emails",
  send_notification: "Send notifications",
};

/** The card title for an action: the server's preview title, or a readable fallback. */
export const actionTitle = (a: BuddyAction) => a.preview?.title || ACTION_LABELS[a.name] || a.name.replace(/_/g, " ");
