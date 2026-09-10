import { createFileRoute } from "@tanstack/react-router";
import { adminClient, tenantIdFromRequest } from "@/lib/tenant-integrations.server";
import { notifyAssignment } from "@/lib/notify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Runs the workflows configured in Settings → Workflows.
 *
 * Project changes are queued by a database trigger, so a rule fires however the
 * row changed — the app, the SQL editor, an import, an AI action. This drains
 * that queue: match active rules against each event, perform the action, record
 * the outcome.
 *
 * Called by the app right after it changes a project (so rules feel immediate)
 * and by cron (so nothing is stranded if that call never happens).
 */

/** Cap per call: a long backlog drains over several calls rather than timing out. */
const BATCH = 50;

type WorkflowEvent = {
  id: string;
  tenant_id: string | null;
  project_id: string;
  event_name: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
};

type Workflow = {
  id: string;
  tenant_id: string | null;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
  action_type: string;
  action_config: Record<string, unknown> | null;
  trigger_count: number | null;
};

/** The scheduler's token, matching cron.ts. */
async function cronToken(req: Request): Promise<boolean> {
  const provided =
    req.headers.get("x-cron-token") || new URL(req.url).searchParams.get("token") || "";
  if (!provided) return false;
  if (process.env["LOVABLE_CRON_SECRET"] && provided === process.env["LOVABLE_CRON_SECRET"]) return true;
  const { data } = await adminClient().rpc("cron_token_matches", { _token: provided });
  return data === true;
}

/** Does this rule apply to this event? */
function matches(wf: Workflow, ev: WorkflowEvent): boolean {
  const cfg = wf.trigger_config || {};

  if (wf.trigger_type === "event") {
    return typeof cfg.event_name === "string" && cfg.event_name === ev.event_name;
  }

  if (wf.trigger_type === "field_change") {
    const field = typeof cfg.field === "string" ? cfg.field : "";
    if (!field) return false;
    // A creation has no previous value, so nothing "changed" into anything.
    if (!ev.old_row) return false;
    const before = (ev.old_row as Record<string, unknown>)[field];
    const after = (ev.new_row as Record<string, unknown>)?.[field];
    if (before === after) return false;
    if (typeof cfg.to_value === "string" && cfg.to_value !== "") {
      return String(after ?? "") === cfg.to_value;
    }
    return true;
  }

  // time_based runs on its own pass; manual only ever runs on request.
  return false;
}

async function runAction(
  req: Request,
  supabase: ReturnType<typeof adminClient>,
  wf: Workflow,
  projectId: string,
  tenantId: string | null,
): Promise<string> {
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

async function processEvent(
  req: Request,
  supabase: ReturnType<typeof adminClient>,
  ev: WorkflowEvent,
  workflows: Workflow[],
): Promise<number> {
  let fired = 0;

  for (const wf of workflows) {
    if (wf.tenant_id !== ev.tenant_id) continue;
    if (!matches(wf, ev)) continue;

    let status = "success";
    let detail = "";
    try {
      detail = await runAction(req, supabase, wf, ev.project_id, ev.tenant_id);
    } catch (err) {
      status = "failed";
      detail = (err as Error).message;
      // One broken rule must not stop the others, or stall the queue.
      console.error(`workflow ${wf.id} failed:`, detail);
    }

    await supabase.from("workflow_runs").insert({
      workflow_id: wf.id,
      tenant_id: ev.tenant_id,
      project_id: ev.project_id,
      event_id: ev.id,
      status,
      detail,
    } as never);

    await supabase.from("activity_logs").insert({
      tenant_id: ev.tenant_id,
      user_name: "Workflow",
      action_type: "workflow",
      category: "project",
      description: `Workflow "${wf.name}": ${detail}`,
      entity_type: "project",
      entity_id: ev.project_id,
      metadata: { workflow_id: wf.id, event: ev.event_name, status },
      status: status === "success" ? "success" : "failed",
    } as never);

    if (status === "success") {
      await supabase
        .from("ai_workflows")
        .update({ last_triggered_at: new Date().toISOString(), trigger_count: (wf.trigger_count || 0) + 1 })
        .eq("id", wf.id);
      fired += 1;
    }
  }

  return fired;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    console.error("run-workflows: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    return json({ error: "Server is not configured for workflows" }, 500);
  }

  try {
    // Either the scheduler, or a signed-in user — who only ever drains their
    // own tenant's events.
    const isCron = await cronToken(req);
    const tenantId = isCron ? null : await tenantIdFromRequest(req);
    if (!isCron && !tenantId) return json({ error: "Unauthorized" }, 401);

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
    if (pending.length === 0) return json({ processed: 0, fired: 0 });

    let wq = supabase
      .from("ai_workflows")
      .select("id, tenant_id, name, trigger_type, trigger_config, action_type, action_config, trigger_count")
      .eq("is_active", true);
    if (tenantId) wq = wq.eq("tenant_id", tenantId);

    const { data: wfRows } = await wq;
    const workflows = (wfRows || []) as Workflow[];

    let fired = 0;
    for (const ev of pending) {
      try {
        fired += await processEvent(req, supabase, ev, workflows);
        await supabase
          .from("workflow_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", ev.id);
      } catch (err) {
        // Mark it processed with the error rather than leaving it to be retried
        // forever at the head of the queue.
        await supabase
          .from("workflow_events")
          .update({ processed_at: new Date().toISOString(), error: (err as Error).message.slice(0, 300) })
          .eq("id", ev.id);
      }
    }

    return json({ processed: pending.length, fired });
  } catch (err) {
    console.error("run-workflows error:", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/run-workflows")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
