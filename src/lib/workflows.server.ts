import { adminClient } from "@/lib/tenant-integrations.server";
import { notifyAssignment } from "@/lib/notify.server";
import { FREQUENCY_MS } from "@/data/workflowConfig";

/**
 * The workflow runner, shared by /api/public/run-workflows (app and scheduler)
 * and Buddy.
 *
 * Three ways a rule fires:
 *   queued events   project and checklist changes recorded by database triggers
 *   scheduled pass  time-based rules and "go-live date passed", which have no
 *                   change to react to, so they are checked on a schedule
 *   manual          a person runs a rule on chosen projects
 */

/** Cap per call: a long backlog drains over several calls rather than timing out. */
const BATCH = 50;
/** Cap on actions a scheduled pass performs per call. */
const PASS_LIMIT = 200;
const DAY = 86_400_000;

type Db = ReturnType<typeof adminClient>;

export type WorkflowEvent = {
  id: string;
  tenant_id: string | null;
  project_id: string;
  event_name: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
};

export type Workflow = {
  id: string;
  tenant_id: string | null;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
  action_type: string;
  action_config: Record<string, unknown> | null;
  trigger_count: number | null;
};

const WORKFLOW_COLS = "id, tenant_id, name, trigger_type, trigger_config, action_type, action_config, trigger_count";

/** Does this rule apply to this queued event? */
export function matches(wf: Workflow, ev: WorkflowEvent): boolean {
  const cfg = wf.trigger_config || {};

  if (wf.trigger_type === "event") {
    if (typeof cfg.event_name !== "string" || cfg.event_name !== ev.event_name) return false;
    // "Checklist step completed" can be narrowed to one step, matched the way
    // project stages match step names: case-insensitive, contains.
    if (ev.event_name === "checklist_completed" && typeof cfg.checklist_title === "string" && cfg.checklist_title.trim()) {
      const title = String((ev.new_row as Record<string, unknown> | null)?.title ?? "").toLowerCase();
      return title.includes(cfg.checklist_title.trim().toLowerCase());
    }
    return true;
  }

  if (wf.trigger_type === "field_change") {
    // Checklist events carry a checklist row, not a project row.
    if (ev.event_name === "checklist_completed") return false;
    const field = typeof cfg.field === "string" ? cfg.field : "";
    if (!field) return false;
    // A creation has no previous value, so nothing "changed" into anything.
    if (!ev.old_row) return false;
    const before = (ev.old_row as Record<string, unknown>)[field];
    const after = (ev.new_row as Record<string, unknown>)?.[field];
    if (before === after) return false;
    if (typeof cfg.from_value === "string" && cfg.from_value !== "" && String(before ?? "") !== cfg.from_value) return false;
    if (typeof cfg.to_value === "string" && cfg.to_value !== "") {
      return String(after ?? "") === cfg.to_value;
    }
    return true;
  }

  // time_based and go_live_date_passed run on the scheduled pass; manual on request.
  return false;
}

async function runAction(req: Request, supabase: Db, wf: Workflow, projectId: string, tenantId: string | null): Promise<string> {
  const cfg = wf.action_config || {};

  if (wf.action_type === "assign_owner") {
    const ownerId = typeof cfg.owner_id === "string" ? cfg.owner_id : "";
    if (!ownerId) throw new Error("No owner configured");
    const { error } = await supabase.rpc("workflow_update_project", {
      _project_id: projectId,
      _patch: { assigned_owner: ownerId },
    });
    if (error) throw new Error(error.message);
    await notifyAssignment(req, {
      tenantId,
      projectId,
      ownerId,
      assignedBy: `Workflow "${wf.name}"`,
    });
    return `Assigned to ${cfg.owner_name || ownerId}`;
  }

  if (wf.action_type === "update_field") {
    const field = typeof cfg.field === "string" ? cfg.field : "";
    if (!field) throw new Error("No field configured");
    const { error } = await supabase.rpc("workflow_update_project", {
      _project_id: projectId,
      _patch: { [field]: cfg.value },
    });
    if (error) throw new Error(error.message);
    return `Set ${field} to ${String(cfg.value)}`;
  }

  if (wf.action_type === "transfer_project") {
    const toTeam = typeof cfg.to_team === "string" ? cfg.to_team : "";
    if (!toTeam) throw new Error("No team configured");
    const { error } = await supabase.rpc("workflow_transfer_project", {
      _project_id: projectId,
      _to_team: toTeam,
    });
    if (error) throw new Error(error.message);
    return `Transferred to ${toTeam}`;
  }

  if (wf.action_type === "send_notification") {
    const message = typeof cfg.message === "string" ? cfg.message : "";
    if (!message) throw new Error("No message configured");

    const { data: project } = await supabase
      .from("projects")
      .select("merchant_name, assigned_owner")
      .eq("id", projectId)
      .maybeSingle();
    const p = project as { merchant_name: string; assigned_owner: string | null } | null;

    const recipient = typeof cfg.recipient === "string" ? cfg.recipient : "assigned_owner";
    let userIds: string[] = [];

    if (recipient === "assigned_owner") {
      userIds = p?.assigned_owner ? [p.assigned_owner] : [];
    } else if (recipient === "managers") {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("team", ["manager", "admin", "super_admin"]);
      userIds = ((data || []) as Array<{ id: string }>).map((r) => r.id);
    } else {
      userIds = [recipient];
    }

    if (userIds.length === 0) return "No recipient to notify";

    const { error } = await supabase.from("notifications").insert(
      userIds.map((user_id) => ({
        user_id,
        tenant_id: tenantId,
        type: "workflow",
        title: wf.name,
        body: message,
        project_id: projectId,
        project_name: p?.merchant_name ?? null,
        actor_name: "Workflow",
      })) as never,
    );
    if (error) throw new Error(error.message);
    return `Notified ${userIds.length} recipient${userIds.length === 1 ? "" : "s"}`;
  }

  throw new Error(`Unsupported action: ${wf.action_type}`);
}

/** Perform one rule on one project and record the outcome everywhere Settings looks. */
async function fire(
  req: Request,
  supabase: Db,
  wf: Workflow,
  projectId: string,
  tenantId: string | null,
  source: { eventId?: string | null; label: string },
): Promise<boolean> {
  let status = "success";
  let detail = "";
  try {
    detail = await runAction(req, supabase, wf, projectId, tenantId);
  } catch (err) {
    status = "failed";
    detail = (err as Error).message;
    // One broken rule must not stop the others, or stall the queue.
    console.error(`workflow ${wf.id} failed:`, detail);
  }

  await supabase.from("workflow_runs").insert({
    workflow_id: wf.id,
    tenant_id: tenantId,
    project_id: projectId,
    event_id: source.eventId ?? null,
    status,
    detail,
  } as never);

  await supabase.from("activity_logs").insert({
    tenant_id: tenantId,
    user_name: "Workflow",
    action_type: "workflow",
    category: "project",
    description: `Workflow "${wf.name}": ${detail}`,
    entity_type: "project",
    entity_id: projectId,
    metadata: { workflow_id: wf.id, event: source.label, status },
    status: status === "success" ? "success" : "failed",
  } as never);

  if (status === "success") {
    wf.trigger_count = (wf.trigger_count || 0) + 1;
    await supabase
      .from("ai_workflows")
      .update({ last_triggered_at: new Date().toISOString(), trigger_count: wf.trigger_count })
      .eq("id", wf.id);
  }
  return status === "success";
}

async function activeWorkflows(supabase: Db, tenantId: string | null, triggerType: string): Promise<Workflow[]> {
  let q = supabase.from("ai_workflows").select(WORKFLOW_COLS).eq("is_active", true).eq("trigger_type", triggerType);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  return (data || []) as Workflow[];
}

/** Drain queued project and checklist events. */
export async function drainQueue(req: Request, tenantId: string | null): Promise<{ processed: number; fired: number }> {
  const supabase = adminClient();
  let q = supabase
    .from("workflow_events")
    .select("id, tenant_id, project_id, event_name, old_row, new_row")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (tenantId) q = q.eq("tenant_id", tenantId);

  const { data: events, error: eventsError } = await q;
  if (eventsError) throw new Error(eventsError.message);
  const pending = (events || []) as WorkflowEvent[];
  if (pending.length === 0) return { processed: 0, fired: 0 };

  let wq = supabase.from("ai_workflows").select(WORKFLOW_COLS).eq("is_active", true).in("trigger_type", ["event", "field_change"]);
  if (tenantId) wq = wq.eq("tenant_id", tenantId);
  const { data: wfRows } = await wq;
  const workflows = (wfRows || []) as Workflow[];

  let fired = 0;
  for (const ev of pending) {
    try {
      for (const wf of workflows) {
        if (wf.tenant_id !== ev.tenant_id || !matches(wf, ev)) continue;
        if (await fire(req, supabase, wf, ev.project_id, ev.tenant_id, { eventId: ev.id, label: ev.event_name })) fired += 1;
      }
      await supabase.from("workflow_events").update({ processed_at: new Date().toISOString() }).eq("id", ev.id);
    } catch (err) {
      // Mark it processed with the error rather than leaving it to be retried
      // forever at the head of the queue.
      await supabase
        .from("workflow_events")
        .update({ processed_at: new Date().toISOString(), error: (err as Error).message.slice(0, 300) })
        .eq("id", ev.id);
    }
  }
  return { processed: pending.length, fired };
}

/** Latest run time per project for one workflow, since a given moment. */
async function lastRuns(supabase: Db, workflowId: string, projectIds: string[], sinceIso: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (let i = 0; i < projectIds.length; i += 200) {
    const { data } = await supabase
      .from("workflow_runs")
      .select("project_id, created_at")
      .eq("workflow_id", workflowId)
      .in("project_id", projectIds.slice(i, i + 200))
      .gte("created_at", sinceIso);
    for (const r of (data || []) as { project_id: string; created_at: string }[]) {
      map.set(r.project_id, Math.max(map.get(r.project_id) || 0, new Date(r.created_at).getTime()));
    }
  }
  return map;
}

/**
 * Time-based rules and "go-live date passed". Each fires once per occurrence:
 *   time-based        once per stint in a state, then again every check
 *                     interval (hourly/daily/weekly) while the project stays there
 *   go-live passed    once per expected go-live date; moving the date re-arms it
 */
export async function runScheduledPass(req: Request, tenantId: string | null): Promise<{ fired: number }> {
  const supabase = adminClient();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  let fired = 0;

  // ── Time-based ────────────────────────────────────────────────────────
  for (const wf of await activeWorkflows(supabase, tenantId, "time_based")) {
    if (fired >= PASS_LIMIT) break;
    const cfg = wf.trigger_config || {};
    const days = Number(cfg.days_in_state);
    if (!Number.isFinite(days) || days < 0) continue;
    const interval = FREQUENCY_MS[String(cfg.frequency || "daily")] || FREQUENCY_MS.daily;

    let pq = supabase
      .from("projects")
      .select("id, project_state, created_at")
      .eq("tenant_id", wf.tenant_id)
      .eq("archived", false);
    pq = typeof cfg.project_state === "string" && cfg.project_state ? pq.eq("project_state", cfg.project_state) : pq.neq("project_state", "live");
    const { data: projectRows } = await pq.limit(2000);
    const projects = (projectRows || []) as { id: string; project_state: string; created_at: string }[];
    if (projects.length === 0) continue;
    const ids = projects.map((p) => p.id);

    // When each project entered its current state: its latest state change or
    // creation event, else when the project was created.
    const enteredAt = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase
        .from("workflow_events")
        .select("project_id, created_at")
        .in("project_id", ids.slice(i, i + 200))
        .in("event_name", ["project_state_changed", "project_created"]);
      for (const e of (data || []) as { project_id: string; created_at: string }[]) {
        enteredAt.set(e.project_id, Math.max(enteredAt.get(e.project_id) || 0, new Date(e.created_at).getTime()));
      }
    }

    const runs = await lastRuns(supabase, wf.id, ids, new Date(now - interval).toISOString());
    for (const p of projects) {
      if (fired >= PASS_LIMIT) break;
      const entered = enteredAt.get(p.id) || new Date(p.created_at).getTime();
      if (now - entered < days * DAY) continue;
      const last = runs.get(p.id) || 0;
      if (last >= Math.max(entered, now - interval)) continue;
      if (await fire(req, supabase, wf, p.id, wf.tenant_id, { label: "time_based" })) fired += 1;
    }
  }

  // ── Go-live date passed ───────────────────────────────────────────────
  const goLiveRules = (await activeWorkflows(supabase, tenantId, "event")).filter(
    (wf) => (wf.trigger_config || {}).event_name === "go_live_date_passed",
  );
  for (const wf of goLiveRules) {
    if (fired >= PASS_LIMIT) break;
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, expected_go_live_date")
      .eq("tenant_id", wf.tenant_id)
      .eq("archived", false)
      .neq("project_state", "live")
      .lt("expected_go_live_date", today)
      .limit(2000);
    const projects = (projectRows || []) as { id: string; expected_go_live_date: string }[];
    if (projects.length === 0) continue;
    const earliest = projects.reduce((min, p) => (p.expected_go_live_date < min ? p.expected_go_live_date : min), today);
    const runs = await lastRuns(supabase, wf.id, projects.map((p) => p.id), `${earliest}T00:00:00Z`);
    for (const p of projects) {
      if (fired >= PASS_LIMIT) break;
      if ((runs.get(p.id) || 0) >= new Date(`${p.expected_go_live_date}T00:00:00Z`).getTime()) continue;
      if (await fire(req, supabase, wf, p.id, wf.tenant_id, { label: "go_live_date_passed" })) fired += 1;
    }
  }

  return { fired };
}

/** Run one rule on chosen projects, as a person asked. Projects outside the workspace are skipped. */
export async function runWorkflowOnProjects(
  req: Request,
  tenantId: string,
  workflowId: string,
  projectIds: string[],
): Promise<{ ran: number; failed: number; skipped: number }> {
  const supabase = adminClient();
  const { data: wfRow } = await supabase.from("ai_workflows").select(WORKFLOW_COLS).eq("id", workflowId).eq("tenant_id", tenantId).maybeSingle();
  if (!wfRow) throw new Error("That workflow isn't in this workspace.");
  const wf = wfRow as Workflow;
  const { data: rows } = await supabase.from("projects").select("id").eq("tenant_id", tenantId).in("id", projectIds);
  const valid = ((rows || []) as { id: string }[]).map((r) => r.id);
  let ran = 0;
  let failed = 0;
  for (const id of valid) {
    if (await fire(req, supabase, wf, id, tenantId, { label: "manual" })) ran += 1;
    else failed += 1;
  }
  return { ran, failed, skipped: projectIds.length - valid.length };
}
