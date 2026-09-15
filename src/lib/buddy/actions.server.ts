import {
  type BuddyCaller,
  PHASE_LABELS,
  RESPONSIBILITY_LABELS,
  STATE_LABELS,
} from "@/lib/buddy/scope.server";
import { getTenantIntegrations, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { brdUrl } from "@/lib/app-links.server";
import { notifyAssignment } from "@/lib/notify.server";

/**
 * Everything Buddy can change, in one registry.
 *
 * Each action has a preview (what the approval card shows: plain labels, names
 * rather than ids, before → after) and an execute step that validates again on
 * the server, records "before" values for Undo, and returns a link to the
 * result. The chat route only proposes; nothing here runs without approval.
 */

export const DEFAULT_BULK_LIMIT = 25;
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface PreviewRow {
  label: string;
  before?: string | null;
  after: string;
}

export interface ActionPreview {
  action: string;
  title: string;
  target?: { id: string; label: string };
  rows: PreviewRow[];
  items?: { label: string; detail?: string }[];
  count?: number;
  notes?: string[];
  warnings?: string[];
  /** Above the bulk limit: the person must type the count to approve. */
  requiresTypedConfirm?: boolean;
  undoable: boolean;
  email?: { to: string[]; cc?: string[]; subject: string; body: string };
}

export interface UndoPlan {
  table: "projects" | "checklist_items" | "checklist_tasks" | "project_risks" | "checklist_comments";
  /**
   * "update" restores before-values; "delete" removes rows the action created;
   * "insert" puts back rows the action deleted (before holds the whole row).
   */
  op: "update" | "delete" | "insert";
  rows: { id: string; before?: Record<string, unknown> }[];
}

export interface ActionOutcome {
  message: string;
  link?: { label: string; href: string };
  undo?: UndoPlan;
  log: { description: string; category: string; entityType: string; entityId: string };
}

export interface ActionContext {
  req: Request;
  bulkLimit: number;
}

interface ActionDef {
  label: string;
  preview: (c: BuddyCaller, p: Record<string, any>, ctx: ActionContext) => Promise<ActionPreview>;
  execute: (c: BuddyCaller, p: Record<string, any>, ctx: ActionContext) => Promise<ActionOutcome>;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

class ActionError extends Error {}
export const isActionError = (e: unknown): e is Error => e instanceof ActionError;
const fail = (msg: string): never => {
  throw new ActionError(msg);
};

const projectLink = (id: string, label = "Open project") => ({ label, href: `/projects/${id}` });

async function loadProject(c: BuddyCaller, id: string, cols = "id, merchant_name, mid") {
  if (!id) fail("No project was given.");
  const { data, error } = await c.client.from("projects").select(cols).eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) fail("That project isn't in this workspace.");
  return data as any;
}

async function loadPerson(c: BuddyCaller, id: string) {
  if (!id) fail("No person was given.");
  const { data } = await c.client.from("profiles").select("id, name, email, team").eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  if (!data) fail("That person isn't in this workspace.");
  return data as { id: string; name: string; email: string; team: string };
}

async function personName(c: BuddyCaller, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await c.client.from("profiles").select("name").eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name || null;
}

const FIELDS: Record<string, { label: string; kind: "enum" | "text" | "number" | "date" | "percent" | "note"; values?: Record<string, string> }> = {
  project_state: { label: "State", kind: "enum", values: STATE_LABELS },
  current_phase: { label: "Phase", kind: "enum", values: PHASE_LABELS },
  platform: { label: "Platform", kind: "text" },
  category: { label: "Category", kind: "text" },
  arr: { label: "ARR (₹ Cr)", kind: "number" },
  txns_per_day: { label: "Transactions per day", kind: "number" },
  aov: { label: "Average order value", kind: "number" },
  sales_spoc: { label: "Sales SPOC", kind: "text" },
  integration_type: { label: "Integration type", kind: "text" },
  pg_onboarding: { label: "PG onboarding", kind: "text" },
  go_live_percent: { label: "Go-live %", kind: "percent" },
  expected_go_live_date: { label: "Expected go-live", kind: "date" },
  project_notes: { label: "Project notes", kind: "note" },
  mint_notes: { label: "Sales notes", kind: "note" },
  current_phase_comment: { label: "Phase comment", kind: "note" },
};

const fmtDate = (v: unknown) => {
  if (!v) return "Not set";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

function showValue(field: string, v: unknown): string {
  const f = FIELDS[field];
  if (v === null || v === undefined || v === "") return "Not set";
  if (!f) return String(v);
  if (f.kind === "enum") return f.values?.[String(v)] || String(v);
  if (f.kind === "date") return fmtDate(v);
  if (f.kind === "percent") return `${v}%`;
  return String(v);
}

/** Validate and coerce a value for an updatable field. */
function coerce(field: string, value: unknown): unknown {
  const f = FIELDS[field];
  if (!f) fail(`${field.replace(/_/g, " ")} can't be changed by Buddy.`);
  const s = value === null || value === undefined ? "" : String(value).trim();
  switch (f!.kind) {
    case "enum":
      if (!f!.values![s]) fail(`${f!.label} must be one of: ${Object.values(f!.values!).join(", ")}.`);
      return s;
    case "number": {
      const n = Number(s);
      if (s === "" || Number.isNaN(n)) fail(`${f!.label} must be a number.`);
      return n;
    }
    case "percent": {
      const n = Number(s.replace("%", ""));
      if (Number.isNaN(n) || n < 0 || n > 100) fail(`${f!.label} must be between 0 and 100.`);
      return Math.round(n);
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`${f!.label} must be a date (YYYY-MM-DD).`);
      return s;
    default:
      if (!s) fail(`${f!.label} can't be empty.`);
      return s;
  }
}

async function sendResendEmail(
  c: BuddyCaller,
  opts: { to: string[]; cc?: string[]; subject: string; html: string; fromName?: string },
) {
  const creds = await getTenantIntegrations(c.tenantId);
  if (!creds.resend_api_key) fail("Email isn't set up for this workspace. An admin can add Resend under Settings → Integrations.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.resend_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resendFrom(creds, opts.fromName || "Handover"),
      ...resendReplyTo(creds),
      to: opts.to,
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    fail(`The email service rejected the message: ${(body as { message?: string }).message || res.status}`);
  }
  return creds;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const plainTextToHtml = (body: string) =>
  `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#11263b;max-width:640px">${body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;

// ── Tool definitions the model sees ────────────────────────────────────────

export const ACTION_TOOL_DEFS: any[] = [
  {
    type: "function",
    function: {
      name: "assign_owner",
      description: "Assign a project to a person. Get project_id from search_projects/get_project and owner_id from list_people.",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" }, owner_id: { type: "string" } },
        required: ["project_id", "owner_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project_field",
      description:
        "Change one field on a project. Fields: project_state (not_started|on_hold|in_progress|live|blocked), current_phase (mint|integration|ms|completed), platform, category, arr (₹ Cr), txns_per_day, aov, sales_spoc, integration_type, pg_onboarding, go_live_percent (0-100), expected_go_live_date (YYYY-MM-DD), project_notes, mint_notes, current_phase_comment (notes are appended).",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" }, field: { type: "string" }, value: { type: "string" } },
        required: ["project_id", "field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_update_projects",
      description: "Change the same field on several projects. Same fields as update_project_field except notes.",
      parameters: {
        type: "object",
        properties: {
          project_ids: { type: "array", items: { type: "string" } },
          field: { type: "string" },
          value: { type: "string" },
        },
        required: ["project_ids", "field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_responsibility",
      description: "Set who the project is currently waiting on: gokwik (internal team), merchant, or neutral.",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" }, party: { type: "string", enum: ["gokwik", "merchant", "neutral"] } },
        required: ["project_id", "party"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_brd",
      description: "Email the merchant the BRD form for a project, using the workspace's BRD template and the project's contact email.",
      parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_workflow",
      description:
        "Create an automation rule. trigger_type: time_based {delay_hours, condition_field, condition_value} | field_change {field, from_value, to_value} | event {event_name}. action_type: assign_owner {owner_id, owner_name} | update_field {field, value} | send_notification {message} | transfer_project {to_team}.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          trigger_type: { type: "string", enum: ["time_based", "field_change", "event"] },
          trigger_config: { type: "object" },
          action_type: { type: "string", enum: ["assign_owner", "update_field", "send_notification", "transfer_project"] },
          action_config: { type: "object" },
        },
        required: ["name", "trigger_type", "trigger_config", "action_type", "action_config"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a project. Required: merchant_name, mid (unique), kick_off_date (YYYY-MM-DD, default today). Ask for the MID if missing.",
      parameters: {
        type: "object",
        properties: {
          merchant_name: { type: "string" },
          mid: { type: "string" },
          kick_off_date: { type: "string" },
          platform: { type: "string" },
          category: { type: "string" },
          arr: { type: "number" },
          contact_email: { type: "string" },
          sales_spoc: { type: "string" },
          integration_type: { type: "string" },
          expected_go_live_date: { type: "string" },
          project_notes: { type: "string" },
        },
        required: ["merchant_name", "mid", "kick_off_date"],
      },
    },
  },
];

// ── Actions ────────────────────────────────────────────────────────────────

const ACTIONS: Record<string, ActionDef> = {
  assign_owner: {
    label: "Assign owner",
    async preview(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, assigned_owner");
      const owner = await loadPerson(c, p.owner_id);
      const before = await personName(c, project.assigned_owner);
      return {
        action: "assign_owner",
        title: "Assign owner",
        target: { id: project.id, label: project.merchant_name },
        rows: [{ label: "Owner", before: before || "Unassigned", after: owner.name }],
        notes: [`${owner.name} gets an email about the assignment.`],
        warnings: project.assigned_owner === owner.id ? [`${owner.name} already owns this project.`] : undefined,
        undoable: true,
      };
    },
    async execute(c, p, ctx) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, assigned_owner");
      const owner = await loadPerson(c, p.owner_id);
      const { error } = await c.client.from("projects").update({ assigned_owner: owner.id }).eq("id", project.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      await notifyAssignment(ctx.req, { tenantId: c.tenantId, projectId: project.id, ownerId: owner.id, assignedBy: c.name });
      return {
        message: `${project.merchant_name} is now owned by ${owner.name}.`,
        link: projectLink(project.id),
        undo: { table: "projects", op: "update", rows: [{ id: project.id, before: { assigned_owner: project.assigned_owner } }] },
        log: { description: `Buddy assigned ${project.merchant_name} to ${owner.name}`, category: "project", entityType: "project", entityId: project.id },
      };
    },
  },

  update_project_field: {
    label: "Update project",
    async preview(c, p) {
      const f = FIELDS[p.field];
      if (!f) fail(`${String(p.field).replace(/_/g, " ")} can't be changed by Buddy.`);
      const value = coerce(p.field, p.value);
      const project = await loadProject(c, p.project_id, `id, merchant_name, ${p.field}`);
      if (f!.kind === "note") {
        return {
          action: "update_project_field",
          title: `Add to ${f!.label.toLowerCase()}`,
          target: { id: project.id, label: project.merchant_name },
          rows: [{ label: f!.label, after: String(value) }],
          notes: ["Added as a new timestamped note. Existing notes stay."],
          undoable: false,
        };
      }
      return {
        action: "update_project_field",
        title: `Change ${f!.label.toLowerCase()}`,
        target: { id: project.id, label: project.merchant_name },
        rows: [{ label: f!.label, before: showValue(p.field, project[p.field]), after: showValue(p.field, value) }],
        undoable: true,
      };
    },
    async execute(c, p) {
      const f = FIELDS[p.field];
      if (!f) fail(`${String(p.field).replace(/_/g, " ")} can't be changed by Buddy.`);
      const value = coerce(p.field, p.value);
      const project = await loadProject(c, p.project_id, `id, merchant_name, ${p.field}`);
      if (f!.kind === "note") {
        await c.client.from("project_comment_logs").insert({
          project_id: project.id,
          author_name: `Buddy (for ${c.name})`,
          author_type: "ai",
          field_name: p.field,
          content: String(value),
          tenant_id: c.tenantId,
        });
        const stamp = new Date().toLocaleString("en-IN");
        const existing = project[p.field] || "";
        const next = existing ? `${existing}\n\n[${stamp} - Buddy] ${value}` : `[${stamp} - Buddy] ${value}`;
        const { error } = await c.client.from("projects").update({ [p.field]: next }).eq("id", project.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
        return {
          message: `Added a note to ${project.merchant_name}.`,
          link: projectLink(project.id),
          log: { description: `Buddy added ${f!.label.toLowerCase()} on ${project.merchant_name}`, category: "project", entityType: "project", entityId: project.id },
        };
      }
      const { error } = await c.client.from("projects").update({ [p.field]: value }).eq("id", project.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `${f!.label} on ${project.merchant_name} is now ${showValue(p.field, value)}.`,
        link: projectLink(project.id),
        undo: { table: "projects", op: "update", rows: [{ id: project.id, before: { [p.field]: project[p.field] ?? null } }] },
        log: {
          description: `Buddy changed ${f!.label.toLowerCase()} on ${project.merchant_name} from ${showValue(p.field, project[p.field])} to ${showValue(p.field, value)}`,
          category: "project",
          entityType: "project",
          entityId: project.id,
        },
      };
    },
  },

  bulk_update_projects: {
    label: "Update several projects",
    async preview(c, p, ctx) {
      const f = FIELDS[p.field];
      if (!f || f.kind === "note") fail(`${String(p.field).replace(/_/g, " ")} can't be changed in bulk.`);
      const value = coerce(p.field, p.value);
      const ids = Array.isArray(p.project_ids) ? p.project_ids.map(String) : [];
      if (ids.length === 0) fail("No projects were given.");
      const { data } = await c.client.from("projects").select(`id, merchant_name, ${p.field}`).eq("tenant_id", c.tenantId).in("id", ids);
      const rows = (data || []) as any[];
      const missing = ids.length - rows.length;
      return {
        action: "bulk_update_projects",
        title: `Change ${f!.label.toLowerCase()}`,
        rows: [{ label: f!.label, after: showValue(p.field, value) }],
        count: rows.length,
        items: rows.slice(0, 12).map((r) => ({ label: r.merchant_name, detail: showValue(p.field, r[p.field]) })),
        warnings: [
          ...(missing > 0 ? [`${missing} of the requested projects aren't in this workspace and will be skipped.`] : []),
          ...(rows.length > ctx.bulkLimit ? [`This changes ${rows.length} projects, above the limit of ${ctx.bulkLimit}. Type the number to approve.`] : []),
        ],
        requiresTypedConfirm: rows.length > ctx.bulkLimit,
        undoable: true,
      };
    },
    async execute(c, p, ctx) {
      const f = FIELDS[p.field];
      if (!f || f.kind === "note") fail(`${String(p.field).replace(/_/g, " ")} can't be changed in bulk.`);
      const value = coerce(p.field, p.value);
      const ids = Array.isArray(p.project_ids) ? p.project_ids.map(String) : [];
      const { data } = await c.client.from("projects").select(`id, merchant_name, ${p.field}`).eq("tenant_id", c.tenantId).in("id", ids);
      const rows = (data || []) as any[];
      if (rows.length === 0) fail("None of those projects are in this workspace.");
      if (rows.length > ctx.bulkLimit && Number(p.confirm_count) !== rows.length) {
        fail(`Changing ${rows.length} projects needs the count typed to confirm.`);
      }
      const { error } = await c.client.from("projects").update({ [p.field]: value }).eq("tenant_id", c.tenantId).in("id", rows.map((r) => r.id));
      if (error) throw error;
      return {
        message: `${f!.label} is now ${showValue(p.field, value)} on ${rows.length} projects.`,
        undo: { table: "projects", op: "update", rows: rows.map((r) => ({ id: r.id, before: { [p.field]: r[p.field] ?? null } })) },
        log: {
          description: `Buddy changed ${f!.label.toLowerCase()} to ${showValue(p.field, value)} on ${rows.length} projects`,
          category: "project",
          entityType: "project",
          entityId: rows.map((r) => r.id).join(","),
        },
      };
    },
  },

  toggle_responsibility: {
    label: "Change who it's waiting on",
    async preview(c, p) {
      if (!RESPONSIBILITY_LABELS[p.party]) fail("Waiting on must be internal team, merchant or neutral.");
      const project = await loadProject(c, p.project_id, "id, merchant_name, current_responsibility");
      return {
        action: "toggle_responsibility",
        title: "Change who it's waiting on",
        target: { id: project.id, label: project.merchant_name },
        rows: [{ label: "Waiting on", before: RESPONSIBILITY_LABELS[project.current_responsibility] || "Not set", after: RESPONSIBILITY_LABELS[p.party]! }],
        undoable: true,
      };
    },
    async execute(c, p) {
      if (!RESPONSIBILITY_LABELS[p.party]) fail("Waiting on must be internal team, merchant or neutral.");
      const project = await loadProject(c, p.project_id, "id, merchant_name, current_responsibility");
      const { error } = await c.client.from("projects").update({ current_responsibility: p.party }).eq("id", project.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `${project.merchant_name} is now waiting on ${RESPONSIBILITY_LABELS[p.party]!.toLowerCase()}.`,
        link: projectLink(project.id),
        undo: { table: "projects", op: "update", rows: [{ id: project.id, before: { current_responsibility: project.current_responsibility } }] },
        log: { description: `Buddy set ${project.merchant_name} to waiting on ${RESPONSIBILITY_LABELS[p.party]}`, category: "project", entityType: "project", entityId: project.id },
      };
    },
  },

  trigger_brd: {
    label: "Send BRD form",
    async preview(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, contact_email");
      const { data: template } = await c.client.from("checklist_form_templates").select("name").eq("tenant_id", c.tenantId).ilike("name", "%BRD%").limit(1).maybeSingle();
      const warnings: string[] = [];
      if (!project.contact_email) warnings.push("This project has no merchant contact email. Add one before sending.");
      if (!template) warnings.push("No BRD form template found. Create one in Settings → Checklist Forms.");
      return {
        action: "trigger_brd",
        title: "Send BRD form",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Form", after: (template as { name?: string } | null)?.name || "BRD form" },
          { label: "To", after: project.contact_email || "No contact email" },
        ],
        warnings: warnings.length ? warnings : undefined,
        undoable: false,
      };
    },
    async execute(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, mid, contact_email");
      if (!project.contact_email) fail("This project has no merchant contact email. Add one before sending.");
      const { data: template } = await c.client.from("checklist_form_templates").select("id, name").eq("tenant_id", c.tenantId).ilike("name", "%BRD%").limit(1).maybeSingle();
      if (!template) fail("No BRD form template found. Create one in Settings → Checklist Forms.");
      const t = template as { id: string; name: string };
      const { data: session, error } = await c.client
        .from("brd_sessions")
        .insert({ project_id: project.id, form_template_id: t.id, merchant_email: project.contact_email, tenant_id: c.tenantId })
        .select("token")
        .single();
      if (error || !session) fail("Couldn't create the BRD form link.");
      const creds = await getTenantIntegrations(c.tenantId);
      const link = brdUrl(creds, (session as { token: string }).token);
      await sendResendEmail(c, {
        to: [project.contact_email],
        subject: `BRD form for ${project.merchant_name}`,
        fromName: "MINT Updates",
        html: plainTextToHtml(
          `Hi,\n\nPlease complete the ${t.name} for ${project.merchant_name} (MID ${project.mid}). Your answers are saved as you go.\n\n${link}\n\nThanks`,
        ),
      });
      return {
        message: `BRD form sent to ${project.contact_email}.`,
        link: projectLink(project.id),
        log: { description: `Buddy sent the BRD form for ${project.merchant_name} to ${project.contact_email}`, category: "project", entityType: "project", entityId: project.id },
      };
    },
  },

  create_workflow: {
    label: "Create automation",
    async preview(_c, p) {
      if (!p.name) fail("The automation needs a name.");
      return {
        action: "create_workflow",
        title: "Create automation",
        rows: [
          { label: "Name", after: String(p.name) },
          { label: "When", after: `${String(p.trigger_type || "").replace(/_/g, " ")} ${JSON.stringify(p.trigger_config || {})}` },
          { label: "Then", after: `${String(p.action_type || "").replace(/_/g, " ")} ${JSON.stringify(p.action_config || {})}` },
        ],
        notes: ["Starts active. You can pause or edit it under Settings → Workflows."],
        undoable: false,
      };
    },
    async execute(c, p) {
      if (!p.name) fail("The automation needs a name.");
      const { data, error } = await c.client
        .from("ai_workflows")
        .insert({
          tenant_id: c.tenantId,
          name: p.name,
          description: p.description || null,
          trigger_type: p.trigger_type,
          trigger_config: p.trigger_config || {},
          action_type: p.action_type,
          action_config: p.action_config || {},
          created_by: c.userId,
          created_by_name: c.name,
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        message: `Automation "${p.name}" is set up.`,
        link: { label: "Open workflows", href: "/settings/workflows" },
        log: { description: `Buddy created automation "${p.name}"`, category: "workflow", entityType: "workflow", entityId: (data as { id: string }).id },
      };
    },
  },

  create_project: {
    label: "Create project",
    async preview(c, p) {
      if (!p.merchant_name || !p.mid) fail("A project needs a merchant name and MID.");
      const { data: existing } = await c.client.from("projects").select("id").eq("tenant_id", c.tenantId).eq("mid", p.mid).maybeSingle();
      return {
        action: "create_project",
        title: "Create project",
        rows: [
          { label: "Merchant", after: String(p.merchant_name) },
          { label: "MID", after: String(p.mid) },
          { label: "Kick-off", after: fmtDate(p.kick_off_date) },
          ...(p.platform ? [{ label: "Platform", after: String(p.platform) }] : []),
          ...(p.expected_go_live_date ? [{ label: "Expected go-live", after: fmtDate(p.expected_go_live_date) }] : []),
          ...(p.contact_email ? [{ label: "Merchant contact", after: String(p.contact_email) }] : []),
        ],
        notes: ["The standard checklist is added automatically."],
        warnings: existing ? [`A project with MID ${p.mid} already exists.`] : undefined,
        undoable: false,
      };
    },
    async execute(c, p) {
      const allowed = ["merchant_name", "mid", "kick_off_date", "platform", "category", "arr", "contact_email", "sales_spoc", "integration_type", "expected_go_live_date", "project_notes"];
      const row: Record<string, unknown> = { tenant_id: c.tenantId, created_by: c.userId };
      for (const k of allowed) if (p[k] !== undefined && p[k] !== null && p[k] !== "") row[k] = p[k];
      if (!row.merchant_name || !row.mid || !row.kick_off_date) fail("A project needs a merchant name, MID and kick-off date.");
      const { data: existing } = await c.client.from("projects").select("id").eq("tenant_id", c.tenantId).eq("mid", row.mid).maybeSingle();
      if (existing) fail(`A project with MID ${row.mid} already exists.`);
      const { data, error } = await c.client.from("projects").insert(row).select("id, merchant_name, mid").single();
      if (error) throw error;
      const created = data as { id: string; merchant_name: string; mid: string };
      return {
        message: `${created.merchant_name} (MID ${created.mid}) is created.`,
        link: projectLink(created.id),
        log: { description: `Buddy created project ${created.merchant_name} (MID ${created.mid})`, category: "project", entityType: "project", entityId: created.id },
      };
    },
  },
};

export function registerActions(extra: Record<string, ActionDef>, defs: any[]) {
  Object.assign(ACTIONS, extra);
  ACTION_TOOL_DEFS.push(...defs);
}

export const getAction = (name: string) => ACTIONS[name];
export const actionLabel = (name: string) => ACTIONS[name]?.label || name.replace(/_/g, " ");

// ── Undo ───────────────────────────────────────────────────────────────────

const UNDO_TABLES = new Set(["projects", "checklist_items", "checklist_tasks", "project_risks", "checklist_comments"]);

export async function undoAction(c: BuddyCaller, logId: string) {
  const { data: log } = await c.client
    .from("activity_logs")
    .select("id, user_id, tenant_id, created_at, description, metadata")
    .eq("id", logId)
    .maybeSingle();
  const row = log as any;
  if (!row || row.tenant_id !== c.tenantId || row.user_id !== c.userId) fail("That action wasn't found.");
  const meta = (row.metadata || {}) as Record<string, any>;
  const plan = meta.undo as UndoPlan | undefined;
  if (!plan) fail("That action can't be undone.");
  if (meta.undone_at) fail("That action was already undone.");
  if (Date.now() - new Date(row.created_at).getTime() > UNDO_WINDOW_MS) fail("Undo is only available for 10 minutes after an action.");
  if (!UNDO_TABLES.has(plan!.table)) fail("That action can't be undone.");

  for (const r of plan!.rows) {
    if (plan!.op === "delete") {
      const { error } = await c.client.from(plan!.table).delete().eq("id", r.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
    } else if (plan!.op === "insert") {
      // Put back a row the action deleted, only into this workspace.
      if (!r.before || (r.before as { tenant_id?: string }).tenant_id !== c.tenantId) fail("That action can't be undone.");
      const { error } = await c.client.from(plan!.table).insert(r.before!);
      if (error) throw error;
    } else {
      const { error } = await c.client.from(plan!.table).update(r.before || {}).eq("id", r.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
    }
  }

  await c.client
    .from("activity_logs")
    .update({ metadata: { ...meta, undone_at: new Date().toISOString(), undone_by: c.userId } })
    .eq("id", row.id);
  await c.client.from("activity_logs").insert({
    tenant_id: c.tenantId,
    user_id: c.userId,
    user_name: c.name,
    action_type: "ai",
    category: row.metadata?.log_category || "project",
    description: `Undid: ${row.description}`,
    entity_type: "activity_log",
    entity_id: row.id,
    metadata: { undo_of: row.id },
    status: "success",
  });
  return { message: "Undone. The previous values are back." };
}

// Shared with more-actions.server.ts, which registers the rest of Buddy's actions.
export { fail, fmtDate, loadPerson, loadProject, projectLink, sendResendEmail };
export type { ActionDef };
