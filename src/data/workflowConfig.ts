/**
 * What a workflow can be: the triggers, events, fields and actions the runner
 * in src/lib/workflows.server.ts actually implements.
 *
 * Pure module shared by Settings → Workflows and Buddy, so neither can offer a
 * rule the runner ignores. Before this, Settings listed events nothing emitted
 * and Buddy described config keys the runner never read.
 */

export const WORKFLOW_TRIGGER_TYPES = [
  { value: "event", label: "Event" },
  { value: "field_change", label: "Field change" },
  { value: "time_based", label: "Time-based" },
  { value: "manual", label: "Manual" },
] as const;

export const WORKFLOW_EVENTS = [
  { value: "project_created", label: "Project created" },
  { value: "project_state_changed", label: "Project state changed" },
  { value: "project_transferred", label: "Project transferred" },
  { value: "checklist_completed", label: "Checklist step completed" },
  { value: "go_live_date_passed", label: "Go-live date passed" },
] as const;

/** Project fields a workflow may watch or write. */
export const WORKFLOW_FIELDS = [
  { value: "project_state", label: "Project State" },
  { value: "current_owner_team", label: "Current Team" },
  { value: "assigned_owner", label: "Assigned Owner" },
  { value: "expected_go_live_date", label: "Expected Go-Live Date" },
  { value: "go_live_percent", label: "Go-Live %" },
  { value: "integration_type", label: "Integration Type" },
  { value: "pg_onboarding", label: "PG Onboarding" },
] as const;

export const WORKFLOW_ACTIONS = [
  { value: "assign_owner", label: "Assign owner" },
  { value: "update_field", label: "Update field" },
  { value: "send_notification", label: "Send notification" },
  { value: "transfer_project", label: "Transfer project" },
] as const;

export const WORKFLOW_FREQUENCIES = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
] as const;

export const PROJECT_STATES = ["not_started", "on_hold", "in_progress", "live", "blocked"] as const;

export const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

type Config = Record<string, unknown>;

const has = <T extends readonly { value: string }[]>(list: T, v: unknown) =>
  typeof v === "string" && list.some((x) => x.value === v);

/**
 * The first reason a workflow can't run as configured, or null when it can.
 * Same checks for the Settings dialog and for Buddy.
 */
export function workflowProblem(w: {
  trigger_type: string;
  trigger_config: Config;
  action_type: string;
  action_config: Config;
}): string | null {
  const t = w.trigger_config || {};
  const a = w.action_config || {};

  if (!has(WORKFLOW_TRIGGER_TYPES, w.trigger_type)) return "Choose how the workflow starts.";
  if (w.trigger_type === "event" && !has(WORKFLOW_EVENTS, t.event_name)) return "Choose the event that starts this workflow.";
  if (w.trigger_type === "field_change") {
    if (!has(WORKFLOW_FIELDS, t.field)) return "Choose the field to watch.";
    if (t.field === "project_state" && t.to_value && !PROJECT_STATES.includes(t.to_value as never)) return "Choose a valid project state.";
  }
  if (w.trigger_type === "time_based") {
    const days = Number(t.days_in_state);
    if (!Number.isFinite(days) || days < 0) return "Set how many days a project must be in its state.";
    if (t.frequency !== undefined && !has(WORKFLOW_FREQUENCIES, t.frequency)) return "Choose how often to check.";
    if (t.project_state && !PROJECT_STATES.includes(t.project_state as never)) return "Choose a valid project state.";
  }

  if (!has(WORKFLOW_ACTIONS, w.action_type)) return "Choose what the workflow does.";
  if (w.action_type === "assign_owner" && !a.owner_id) return "Choose who to assign.";
  if (w.action_type === "transfer_project" && !a.to_team) return "Choose the team to transfer to.";
  if (w.action_type === "update_field") {
    if (!has(WORKFLOW_FIELDS, a.field)) return "Choose the field to set.";
    if (a.value === undefined || a.value === null || a.value === "") return "Choose the value to set.";
    if (a.field === "project_state" && !PROJECT_STATES.includes(a.value as never)) return "Choose a valid project state.";
  }
  if (w.action_type === "send_notification" && !a.message) return "Write the notification message.";
  return null;
}
