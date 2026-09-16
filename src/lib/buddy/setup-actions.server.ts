import {
  type ActionDef,
  type ActionPreview,
  type PreviewRow,
  type UndoPlan,
  fail,
  loadPerson,
} from "@/lib/buddy/actions.server";
import type { BuddyCaller } from "@/lib/buddy/scope.server";
import {
  INTEGRATION_BY_KEY,
  NAV_TABS,
  SETTING_BY_KEY,
  hasRole,
  isSecretIntegration,
  maskSecret,
  normaliseSetting,
  settingDefault,
  type AreaId,
} from "@/lib/buddy/setup-catalog.server";
import { SYSTEM_TEAM_DEFAULTS, currentSetting, teamNameMap } from "@/lib/buddy/setup-read.server";
import { FUNNEL_SETTINGS_KEY, parseFunnelStages, type FunnelMatchType, type FunnelStageRule } from "@/data/funnelConfig";
import {
  RISK_SETTINGS_KEY,
  newRiskRuleId,
  parseRiskRules,
  type RiskRule,
  type RiskRuleType,
  type RiskSeverity,
} from "@/data/riskRules";
import { EGL_SETTINGS_KEY, parseEglRules, type EglRule } from "@/data/eglRisk";
import { BUDDY_SETTINGS_KEY, parseBuddySettings } from "@/lib/buddy/settings.server";
import { PROJECT_STATES, WORKFLOW_EVENTS, WORKFLOW_FIELDS, workflowProblem } from "@/data/workflowConfig";
import { checklistDueDate } from "@/lib/checklistDueDate";
import { teamToProjectPhase } from "@/data/projectsData";
import { invalidateTenantIntegrations } from "@/lib/tenant-integrations.server";
import { runWorkflowOnProjects } from "@/lib/workflows.server";
import { createWorkspaceUser, sendInviteEmail, setUserRole } from "@/lib/users.server";

/**
 * Buddy's setup actions: everything under Settings, so Buddy can onboard a
 * workspace and change any setting when asked.
 *
 * Each action builds one plan from the request, used both for the approval
 * card and, rebuilt and re-checked on approval, for the write. Nothing is
 * trusted from the preview. Every read and write is filtered to the caller's
 * workspace, and each change records how to undo it where that's possible.
 */

type P = Record<string, any>;
type Db = BuddyCaller["client"];

const STATE_NAMES: Record<string, string> = {
  not_started: "Not started",
  on_hold: "On hold",
  in_progress: "In progress",
  live: "Live",
  blocked: "Blocked",
};

const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const asArray = (v: unknown, what: string): P[] => {
  if (!Array.isArray(v) || v.length === 0) fail(`No ${what} were given.`);
  if ((v as unknown[]).length > 150) fail(`That's more than 150 ${what} at once. Split it into several cards.`);
  return v as P[];
};
const hex = (v: unknown, fallback?: string) => {
  const s = String(v ?? "").trim();
  if (!s && fallback) return fallback;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) fail(`"${s}" isn't a colour. Use a hex colour like #255A87.`);
  return s.toLowerCase();
};
const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
const chunks = <T,>(list: T[], size = 200) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const SETTINGS_PAGE: Partial<Record<AreaId, string>> = {
  branding: "/settings/general",
  terminology: "/settings/fields",
  email_intake: "/settings/email",
  alerts: "/settings/slack-alerts",
  look_and_buddy: "/settings/navigation",
};

// ── app_settings rows, with undo ──────────────────────────────────────────

/** Write key/value rows and return how to put the previous values back. */
async function writeSettings(c: BuddyCaller, writes: { key: string; value: string }[], resets: string[] = []): Promise<UndoPlan[]> {
  const keys = [...writes.map((w) => w.key), ...resets];
  if (keys.length === 0) return [];
  const { data } = await c.client.from("app_settings").select("*").eq("tenant_id", c.tenantId).in("key", keys);
  const existing = new Map(((data || []) as any[]).map((r) => [r.key as string, r]));
  const restore: UndoPlan = { table: "app_settings", op: "update", rows: [] };
  const remove: UndoPlan = { table: "app_settings", op: "delete", rows: [] };
  const putBack: UndoPlan = { table: "app_settings", op: "insert", rows: [] };

  for (const w of writes) {
    const row = existing.get(w.key);
    if (row) {
      if (row.value === w.value) continue;
      const { error } = await c.client.from("app_settings").update({ value: w.value, updated_at: new Date().toISOString() }).eq("id", row.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      restore.rows.push({ id: row.id, before: { value: row.value } });
    } else {
      const category = w.key.includes("_") ? w.key.slice(0, w.key.indexOf("_")) : "general";
      const { data: inserted, error } = await c.client
        .from("app_settings")
        .insert({ key: w.key, value: w.value, category, tenant_id: c.tenantId })
        .select("id")
        .single();
      if (error) throw error;
      remove.rows.push({ id: (inserted as { id: string }).id });
    }
  }
  for (const key of resets) {
    const row = existing.get(key);
    if (!row) continue;
    const { error } = await c.client.from("app_settings").delete().eq("id", row.id).eq("tenant_id", c.tenantId);
    if (error) throw error;
    putBack.rows.push({ id: row.id, before: row });
  }
  return [restore, remove, putBack].filter((plan) => plan.rows.length > 0);
}

async function settingsMap(c: BuddyCaller): Promise<Map<string, string>> {
  const { data } = await c.client.from("app_settings").select("key, value").eq("tenant_id", c.tenantId);
  return new Map(((data || []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

const undoablePlans = (plans: UndoPlan[]) => (plans.length ? plans : undefined);

// ── Shared lookups ────────────────────────────────────────────────────────

async function teamRows(c: BuddyCaller) {
  const { data } = await c.client.from("teams").select("*").eq("tenant_id", c.tenantId).order("sort_order");
  return (data || []) as { id: string; slug: string; name: string; color: string; is_system: boolean; sort_order: number; tenant_id: string }[];
}

/** A team by slug, current name, default name, or "stage 1/2/3". */
async function resolveTeamSlug(c: BuddyCaller, ref: unknown): Promise<{ slug: string; name: string }> {
  const names = await teamNameMap(c);
  const r = lc(ref);
  if (!r) fail("No team was given.");
  const stage = r.match(/^stage\s*([123])$/);
  if (stage) {
    const d = SYSTEM_TEAM_DEFAULTS[Number(stage[1]) - 1];
    return { slug: d.slug, name: names[d.slug] };
  }
  const hit =
    Object.entries(names).find(([slug]) => slug === r) ||
    Object.entries(names).find(([, name]) => lc(name) === r) ||
    SYSTEM_TEAM_DEFAULTS.filter((d) => lc(d.name) === r).map((d) => [d.slug, names[d.slug]] as [string, string])[0];
  if (!hit) fail(`There's no team called "${ref}". Teams: ${Object.values(names).join(", ")}.`);
  return { slug: hit![0], name: hit![1] };
}

/** Delete checklist items and everything that hangs off them. Mirrors delete_team_cascade. */
async function deleteItemsCascade(db: Db, itemIds: string[]) {
  for (const ids of chunks(itemIds)) {
    for (const table of ["checklist_comments", "checklist_responsibility_logs", "checklist_tasks", "checklist_form_responses", "checklist_meetings"]) {
      const { error } = await db.from(table).delete().in("checklist_item_id", ids);
      if (error) throw error;
    }
    const { error } = await db.from("checklist_items").delete().in("id", ids);
    if (error) throw error;
  }
}

/** Items for a team's step (or whole team) in this workspace, with the projects they sit on. */
async function itemsFor(c: BuddyCaller, team: string, title?: string) {
  const rows: { id: string; project_id: string; sort_order: number | null; title: string }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = c.client.from("checklist_items").select("id, project_id, sort_order, title").eq("tenant_id", c.tenantId).eq("owner_team", team);
    if (title !== undefined) q = q.eq("title", title);
    const { data } = await q.order("id").range(from, from + 999);
    rows.push(...((data || []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const typedConfirm = (p: P, projects: number) => {
  if (projects > 0 && Number(p.confirm_count) !== projects) fail(`This affects ${plural(projects, "project")}. Type ${projects} to approve.`);
};

// ── update_workspace_settings ─────────────────────────────────────────────

function planSettings(c: BuddyCaller, p: P, m: Map<string, string>) {
  const changes = p.changes && typeof p.changes === "object" && !Array.isArray(p.changes) ? (p.changes as P) : null;
  if (!changes || Object.keys(changes).length === 0) fail("No settings were given.");
  const errors: string[] = [];
  const writes: { key: string; value: string }[] = [];
  const resets: string[] = [];
  const rows: PreviewRow[] = [];
  const areas = new Set<AreaId>();

  for (const [key, raw] of Object.entries(changes!)) {
    const def = SETTING_BY_KEY.get(key);
    if (!def) {
      errors.push(`"${key}" isn't a setting Buddy can change.`);
      continue;
    }
    if (!hasRole(c.roles, def.role)) {
      errors.push(`${def.label} can only be changed by a workspace admin.`);
      continue;
    }
    areas.add(def.area);
    const before = currentSetting(m, key);
    if (raw === null || lc(raw) === "reset" || lc(raw) === "default") {
      if (key.startsWith("nav:")) writes.push({ key, value: "true" });
      else resets.push(key);
      rows.push({ label: def.label, before, after: `Default (${settingDefault(key) || "empty"})` });
      continue;
    }
    const result = normaliseSetting(def, raw);
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    if (result.value === before) continue;
    writes.push({ key, value: result.value });
    rows.push({ label: def.label, before, after: def.kind === "bool" ? (result.value === "true" ? "Yes" : "No") : result.value });
  }
  if (errors.length) fail(errors.join(" "));
  return { writes, resets, rows, areas };
}

const updateWorkspaceSettings: ActionDef = {
  label: "Change workspace settings",
  async preview(c, p) {
    const plan = planSettings(c, p, await settingsMap(c));
    return {
      action: "update_workspace_settings",
      title: "Change workspace settings",
      rows: plan.rows.length ? plan.rows : [{ label: "Changes", after: "Nothing to change: these values are already set" }],
      notes: ["Applies to everyone in this workspace straight away."],
      undoable: true,
    };
  },
  async execute(c, p) {
    const m = await settingsMap(c);
    const plan = planSettings(c, p, m);
    // Tab visibility lives in one JSON row.
    const nav = plan.writes.filter((w) => w.key.startsWith("nav:"));
    const writes = plan.writes.filter((w) => !w.key.startsWith("nav:"));
    if (nav.length) {
      const visibility = Object.fromEntries(NAV_TABS.map((t) => [t.key, currentSetting(m, `nav:${t.key}`) === "true"]));
      for (const w of nav) visibility[w.key.slice(4)] = w.value === "true";
      writes.push({ key: "nav_visibility", value: JSON.stringify(visibility) });
    }
    const undo = await writeSettings(c, writes, plan.resets);
    const first = [...plan.areas][0];
    const count = plan.writes.length + plan.resets.length;
    return {
      message: count ? `Updated ${plural(count, "setting")}.` : "Those settings were already set.",
      link: first && SETTINGS_PAGE[first] ? { label: "Open settings", href: SETTINGS_PAGE[first]! } : undefined,
      undo: undoablePlans(undo),
      log: { description: `Buddy changed ${plural(count, "workspace setting")}: ${plan.rows.map((r) => r.label).join(", ")}`, category: "settings", entityType: "settings", entityId: c.tenantId },
    };
  },
};

// ── manage_teams ──────────────────────────────────────────────────────────

async function planTeams(c: BuddyCaller, p: P) {
  const changes = asArray(p.changes, "team changes");
  const rows = await teamRows(c);
  const names = await teamNameMap(c);
  const preview: PreviewRow[] = [];
  const warnings: string[] = [];
  const ops: { op: string; slug?: string; name?: string; color?: string; row?: (typeof rows)[number]; stage?: (typeof SYSTEM_TEAM_DEFAULTS)[number] }[] = [];
  let affectedProjects = 0;
  const takenNames = new Set(Object.values(names).map(lc));

  for (const ch of changes) {
    const op = lc(ch.op);
    if (op === "add") {
      const name = String(ch.name || "").trim();
      if (!name) fail("A new team needs a name.");
      if (takenNames.has(lc(name))) fail(`There's already a team called ${name}.`);
      const slug = slugify(name);
      if (!slug || names[slug]) fail(`Choose a different name for ${name}; it clashes with an existing team.`);
      takenNames.add(lc(name));
      const color = hex(ch.color, "#64748b");
      ops.push({ op, slug, name, color });
      preview.push({ label: "Add team", after: `${name} (${color})` });
      continue;
    }
    const { slug, name: currentName } = await resolveTeamSlug(c, ch.team);
    const row = rows.find((r) => r.slug === slug);
    const stage = SYSTEM_TEAM_DEFAULTS.find((d) => d.slug === slug);
    if (op === "update") {
      const name = ch.name ? String(ch.name).trim() : undefined;
      if (name && lc(name) !== lc(currentName) && takenNames.has(lc(name))) fail(`There's already a team called ${name}.`);
      const color = ch.color ? hex(ch.color) : undefined;
      if (!name && !color) fail(`Say what to change about ${currentName}: its name or colour.`);
      ops.push({ op, slug, name, color, row, stage });
      if (name && name !== currentName) preview.push({ label: `Rename ${stage ? `stage ${stage.stage} team` : "team"}`, before: currentName, after: name });
      if (color) preview.push({ label: `${name || currentName} colour`, before: row?.color || stage?.color || "Not set", after: color });
      continue;
    }
    if (op === "delete") {
      if (stage) fail(`${currentName} is the stage ${stage.stage} team and receives handoffs, so it can't be deleted. Rename it instead.`);
      if (!row) fail(`${currentName} can't be deleted.`);
      const items = await itemsFor(c, slug);
      const projects = new Set(items.map((i) => i.project_id)).size;
      affectedProjects += projects;
      ops.push({ op, slug, row });
      preview.push({ label: "Delete team", after: currentName });
      warnings.push(
        `Deleting ${currentName} removes its ${plural(items.length, "checklist item")} from ${plural(projects, "project")}, with their comments, tasks, meetings and form answers. This can't be undone.`,
      );
      continue;
    }
    fail(`"${ch.op}" isn't a team change. Use add, update or delete.`);
  }
  return { ops, preview, warnings, affectedProjects };
}

const manageTeams: ActionDef = {
  label: "Manage teams",
  async preview(c, p) {
    const plan = await planTeams(c, p);
    const deletes = plan.ops.some((o) => o.op === "delete");
    return {
      action: "manage_teams",
      title: "Change teams",
      rows: plan.preview,
      warnings: plan.warnings.length ? plan.warnings : undefined,
      notes: ["Team names show everywhere: dashboards, checklists, transfers and exports."],
      ...(deletes && plan.affectedProjects > 0 ? { count: plan.affectedProjects, requiresTypedConfirm: true } : {}),
      undoable: !deletes,
    };
  },
  async execute(c, p) {
    const plan = await planTeams(c, p);
    typedConfirm(p, plan.ops.some((o) => o.op === "delete") ? plan.affectedProjects : 0);
    const undo: UndoPlan[] = [];
    const rows = await teamRows(c);
    for (const o of plan.ops) {
      if (o.op === "add") {
        const { data, error } = await c.client
          .from("teams")
          .insert({ name: o.name, slug: o.slug, color: o.color, is_system: false, sort_order: rows.length + undo.length, tenant_id: c.tenantId })
          .select("id")
          .single();
        if (error) throw error;
        undo.push({ table: "teams", op: "delete", rows: [{ id: (data as { id: string }).id }] });
      } else if (o.op === "update") {
        const patch: P = {};
        if (o.name) patch.name = o.name;
        if (o.color) patch.color = o.color;
        if (o.row) {
          const { error } = await c.client.from("teams").update(patch).eq("id", o.row.id).eq("tenant_id", c.tenantId);
          if (error) throw error;
          undo.push({ table: "teams", op: "update", rows: [{ id: o.row.id, before: { name: o.row.name, color: o.row.color } }] });
        } else {
          // A stage team still on its built-in name has no row yet.
          const { data, error } = await c.client
            .from("teams")
            .insert({ slug: o.slug, name: o.name || o.stage!.name, color: o.color || o.stage!.color, is_system: true, sort_order: o.stage!.stage - 1, tenant_id: c.tenantId })
            .select("id")
            .single();
          if (error) throw error;
          undo.push({ table: "teams", op: "delete", rows: [{ id: (data as { id: string }).id }] });
        }
      } else if (o.op === "delete") {
        const items = await itemsFor(c, o.slug!);
        await deleteItemsCascade(c.client, items.map((i) => i.id));
        const { data: templates } = await c.client.from("checklist_templates").select("id").eq("tenant_id", c.tenantId).eq("owner_team", o.slug!);
        const templateIds = ((templates || []) as { id: string }[]).map((t) => t.id);
        if (templateIds.length) {
          await c.client.from("checklist_form_assignments").delete().in("checklist_template_id", templateIds);
          await c.client.from("checklist_templates").delete().in("id", templateIds);
        }
        const { error } = await c.client.from("teams").delete().eq("id", o.row!.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
      }
    }
    const hasDelete = plan.ops.some((o) => o.op === "delete");
    return {
      message: `Teams updated: ${plan.preview.map((r) => (r.before ? `${r.before} → ${r.after}` : `${r.label.toLowerCase()} ${r.after}`)).join("; ")}.`,
      link: { label: "Open team management", href: "/settings/checklist" },
      undo: hasDelete ? undefined : undoablePlans(undo),
      log: { description: `Buddy changed teams: ${plan.preview.map((r) => `${r.label} ${r.after}`).join("; ")}`, category: "settings", entityType: "teams", entityId: c.tenantId },
    };
  },
};

// ── manage_checklist_steps ────────────────────────────────────────────────

type Template = { id: string; title: string; owner_team: string; sort_order: number; standard_duration: number | null; phase: string; tenant_id: string };

async function templatesFor(c: BuddyCaller): Promise<Template[]> {
  const { data } = await c.client.from("checklist_templates").select("*").eq("tenant_id", c.tenantId).order("sort_order");
  return (data || []) as Template[];
}

const durationOf = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "" || lc(v) === "none") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 365) fail("A step's duration must be a number of days between 0 and 365.");
  return Math.round(n);
};
const showDays = (d: number | null | undefined) => (d ? `${plural(d, "day")} after kick-off` : "No due date");

async function planSteps(c: BuddyCaller, p: P) {
  const changes = asArray(p.changes, "checklist changes");
  const applyExisting = p.apply_to_existing !== false;
  const templates = await templatesFor(c);
  const sim = templates.map((t) => ({ ...t }));
  const rows: PreviewRow[] = [];
  const warnings: string[] = [];
  const ops: P[] = [];
  let affectedProjects = 0;

  const findStep = (team: string, ref: P) => {
    const byId = ref.step_id ? sim.find((t) => t.id === ref.step_id) : undefined;
    const byTitle = sim.filter((t) => t.owner_team === team && lc(t.title) === lc(ref.step));
    const hit = byId || byTitle[0];
    if (!hit) fail(`There's no step "${ref.step || ref.step_id}" in that team.`);
    return hit!;
  };

  for (const ch of changes) {
    const op = lc(ch.op);
    const team = await resolveTeamSlug(c, ch.team);
    if (op === "add") {
      const title = String(ch.title || "").trim();
      if (!title) fail("A new step needs a name.");
      if (sim.some((t) => t.owner_team === team.slug && lc(t.title) === lc(title))) fail(`${team.name} already has a step called ${title}.`);
      const duration = durationOf(ch.duration_days);
      const position = ch.position ? Number(ch.position) : undefined;
      sim.push({ id: `new:${title}`, title, owner_team: team.slug, sort_order: Number.MAX_SAFE_INTEGER, standard_duration: duration, phase: "", tenant_id: c.tenantId });
      ops.push({ op, team: team.slug, title, duration, position });
      rows.push({ label: `Add to ${team.name}`, after: `${title} · ${showDays(duration)}${position ? ` · position ${position}` : ""}` });
    } else if (op === "update") {
      const step = findStep(team.slug, ch);
      const title = ch.title ? String(ch.title).trim() : undefined;
      const hasDuration = ch.duration_days !== undefined;
      const duration = hasDuration ? durationOf(ch.duration_days) : undefined;
      if (!title && !hasDuration) fail(`Say what to change about ${step.title}: its name or duration.`);
      if (title && title !== step.title && sim.some((t) => t.owner_team === team.slug && lc(t.title) === lc(title))) fail(`${team.name} already has a step called ${title}.`);
      ops.push({ op, team: team.slug, step_id: step.id, old_title: step.title, title, duration, hasDuration });
      if (title && title !== step.title) rows.push({ label: `Rename in ${team.name}`, before: step.title, after: title });
      if (hasDuration) rows.push({ label: `${title || step.title} due`, before: showDays(step.standard_duration), after: showDays(duration) });
      if (title) step.title = title;
    } else if (op === "move") {
      const step = findStep(team.slug, ch);
      const list = sim.filter((t) => t.owner_team === team.slug).sort((a, b) => a.sort_order - b.sort_order);
      const from = list.indexOf(step) + 1;
      const to = Math.max(1, Math.min(list.length, Number(ch.position) || 0));
      if (!ch.position) fail(`Say which position ${step.title} should move to.`);
      ops.push({ op, team: team.slug, step_id: step.id, title: step.title, position: to });
      rows.push({ label: `Move in ${team.name}`, before: `${step.title} · position ${from}`, after: `position ${to}` });
    } else if (op === "delete") {
      const step = findStep(team.slug, ch);
      if (step.id.startsWith("new:")) fail(`${step.title} is being added in the same change; leave it out instead.`);
      const items = await itemsFor(c, team.slug, step.title);
      const projects = new Set(items.map((i) => i.project_id)).size;
      affectedProjects += projects;
      ops.push({ op, team: team.slug, step_id: step.id, title: step.title });
      rows.push({ label: `Remove from ${team.name}`, after: step.title });
      warnings.push(`Removing ${step.title} deletes it from ${plural(projects, "project")}, with its comments, tasks, meetings and form answers. This can't be undone.`);
      sim.splice(sim.indexOf(step), 1);
    } else {
      fail(`"${ch.op}" isn't a checklist change. Use add, update, move or delete.`);
    }
  }
  return { ops, rows, warnings, affectedProjects, applyExisting };
}

/** Renumber a team's templates to match a new order, and their items with them. */
async function reorderTeam(c: BuddyCaller, team: string, order: Template[], undo: UndoPlan[]) {
  const tplUndo: UndoPlan = { table: "checklist_templates", op: "update", rows: [] };
  const itemUndo: UndoPlan = { table: "checklist_items", op: "update", rows: [] };
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    if (t.sort_order === i) continue;
    await c.client.from("checklist_templates").update({ sort_order: i }).eq("id", t.id).eq("tenant_id", c.tenantId);
    tplUndo.rows.push({ id: t.id, before: { sort_order: t.sort_order } });
    const items = await itemsFor(c, team, t.title);
    for (const ids of chunks(items)) {
      await c.client.from("checklist_items").update({ sort_order: i }).in("id", ids.map((x) => x.id)).eq("tenant_id", c.tenantId);
    }
    itemUndo.rows.push(...items.map((x) => ({ id: x.id, before: { sort_order: x.sort_order } })));
  }
  if (tplUndo.rows.length) undo.push(tplUndo);
  if (itemUndo.rows.length) undo.push(itemUndo);
}

const manageChecklistSteps: ActionDef = {
  label: "Manage checklist steps",
  async preview(c, p) {
    const plan = await planSteps(c, p);
    const adds = plan.ops.filter((o) => o.op === "add").length;
    const { count: projects } = await c.client.from("projects").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId);
    const deletes = plan.ops.some((o) => o.op === "delete");
    return {
      action: "manage_checklist_steps",
      title: "Change checklist steps",
      rows: plan.rows,
      notes: [
        adds && plan.applyExisting ? `New steps are also added to ${plural(projects || 0, "existing project")}, due the set number of days after each project's kick-off.` : "",
        adds && !plan.applyExisting ? "New steps apply to new projects only." : "",
        plan.ops.some((o) => o.op === "update" && o.title) ? "Renamed steps are renamed on existing projects too." : "",
      ].filter(Boolean),
      warnings: plan.warnings.length ? plan.warnings : undefined,
      ...(deletes && plan.affectedProjects > 0 ? { count: plan.affectedProjects, requiresTypedConfirm: true } : {}),
      undoable: !deletes,
    };
  },
  async execute(c, p) {
    const plan = await planSteps(c, p);
    typedConfirm(p, plan.ops.some((o) => o.op === "delete") ? plan.affectedProjects : 0);
    const undo: UndoPlan[] = [];
    for (const o of plan.ops) {
      const templates = await templatesFor(c);
      const team = templates.filter((t) => t.owner_team === o.team).sort((a, b) => a.sort_order - b.sort_order);
      if (o.op === "add") {
        const sortOrder = team.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
        const phase = teamToProjectPhase(o.team);
        const { data, error } = await c.client
          .from("checklist_templates")
          .insert({ title: o.title, owner_team: o.team, phase, sort_order: sortOrder, standard_duration: o.duration, tenant_id: c.tenantId })
          .select("*")
          .single();
        if (error) throw error;
        undo.push({ table: "checklist_templates", op: "delete", rows: [{ id: (data as Template).id }] });
        if (plan.applyExisting) {
          const { data: projects } = await c.client.from("projects").select("id, kick_off_date").eq("tenant_id", c.tenantId);
          const inserts = ((projects || []) as { id: string; kick_off_date: string | null }[]).map((pr) => ({
            project_id: pr.id,
            title: o.title,
            owner_team: o.team,
            phase,
            sort_order: sortOrder,
            completed: false,
            current_responsibility: "neutral" as const,
            tenant_id: c.tenantId,
            due_date: checklistDueDate(pr.kick_off_date, o.duration),
          }));
          const created: { id: string }[] = [];
          for (const batch of chunks(inserts, 500)) {
            const { data: ins, error: insError } = await c.client.from("checklist_items").insert(batch).select("id");
            if (insError) throw insError;
            created.push(...((ins || []) as { id: string }[]));
          }
          if (created.length) undo.push({ table: "checklist_items", op: "delete", rows: created });
        }
        if (o.position) {
          const fresh = (await templatesFor(c)).filter((t) => t.owner_team === o.team).sort((a, b) => a.sort_order - b.sort_order);
          const moved = fresh.find((t) => t.id === (data as Template).id)!;
          const order = fresh.filter((t) => t !== moved);
          order.splice(Math.max(0, Math.min(order.length, o.position - 1)), 0, moved);
          await reorderTeam(c, o.team, order, undo);
        }
      } else if (o.op === "update") {
        const t = templates.find((x) => x.id === o.step_id);
        if (!t) fail("That step no longer exists.");
        const patch: P = {};
        if (o.title) patch.title = o.title;
        if (o.hasDuration) patch.standard_duration = o.duration;
        await c.client.from("checklist_templates").update(patch).eq("id", t!.id).eq("tenant_id", c.tenantId);
        undo.push({ table: "checklist_templates", op: "update", rows: [{ id: t!.id, before: { title: t!.title, standard_duration: t!.standard_duration } }] });
        if (o.title && o.title !== t!.title) {
          const items = await itemsFor(c, o.team, t!.title);
          for (const ids of chunks(items)) {
            await c.client.from("checklist_items").update({ title: o.title }).in("id", ids.map((x) => x.id)).eq("tenant_id", c.tenantId);
          }
          if (items.length) undo.push({ table: "checklist_items", op: "update", rows: items.map((x) => ({ id: x.id, before: { title: t!.title } })) });
        }
      } else if (o.op === "move") {
        const moved = team.find((x) => x.id === o.step_id);
        if (!moved) fail("That step no longer exists.");
        const order = team.filter((x) => x !== moved);
        order.splice(o.position - 1, 0, moved!);
        await reorderTeam(c, o.team, order, undo);
      } else if (o.op === "delete") {
        const items = await itemsFor(c, o.team, o.title);
        await deleteItemsCascade(c.client, items.map((x) => x.id));
        await c.client.from("checklist_form_assignments").delete().eq("checklist_template_id", o.step_id);
        const { error } = await c.client.from("checklist_templates").delete().eq("id", o.step_id).eq("tenant_id", c.tenantId);
        if (error) throw error;
      }
    }
    const hasDelete = plan.ops.some((o) => o.op === "delete");
    return {
      message: `Checklist updated: ${plural(plan.ops.length, "change")}.`,
      link: { label: "Open checklists", href: "/settings/checklist" },
      undo: hasDelete ? undefined : undoablePlans(undo),
      log: { description: `Buddy changed checklist steps: ${plan.rows.map((r) => `${r.label} ${r.after}`).join("; ")}`, category: "settings", entityType: "checklist_templates", entityId: c.tenantId },
    };
  },
};

// ── manage_checklist_forms ────────────────────────────────────────────────

const ANSWER_TYPES = ["text", "textarea", "number", "date", "url", "boolean", "select"];
const optionsOf = (type: string, v: unknown): string[] => {
  const list = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : [];
  const clean = list.map((o) => o.trim()).filter(Boolean);
  if (type === "select" && clean.length === 0) fail("A dropdown needs its options.");
  return type === "select" ? clean : [];
};

async function planForms(c: BuddyCaller, p: P) {
  const changes = asArray(p.changes, "form changes");
  const [{ data: forms }, { data: questions }, { data: steps }, names] = await Promise.all([
    c.client.from("checklist_form_templates").select("*").eq("tenant_id", c.tenantId),
    c.client.from("checklist_form_fields").select("*").eq("tenant_id", c.tenantId),
    c.client.from("checklist_templates").select("id, title, owner_team").eq("tenant_id", c.tenantId),
    teamNameMap(c),
  ]);
  const formList = [...((forms || []) as any[])];
  const questionList = (questions || []) as any[];
  const stepList = (steps || []) as { id: string; title: string; owner_team: string }[];
  const rows: PreviewRow[] = [];
  const warnings: string[] = [];
  const ops: P[] = [];

  const findForm = (ref: P) => {
    const hit = formList.find((f) => (ref.form_id && f.id === ref.form_id) || lc(f.name) === lc(ref.form));
    if (!hit) fail(`There's no form called "${ref.form || ref.form_id}".`);
    return hit;
  };
  const findStep = (ref: P) => {
    const matches = stepList.filter((s) => (ref.step_id && s.id === ref.step_id) || lc(s.title) === lc(ref.step));
    if (matches.length === 0) fail(`There's no checklist step called "${ref.step || ref.step_id}".`);
    if (matches.length > 1 && !ref.team) fail(`More than one team has a step called ${ref.step}. Say which team.`);
    return matches.length > 1 ? matches.find((s) => lc(names[s.owner_team]) === lc(ref.team) || s.owner_team === lc(ref.team)) || fail(`No step ${ref.step} in ${ref.team}.`) : matches[0];
  };

  for (const ch of changes) {
    const op = lc(ch.op);
    if (op === "create_form") {
      const name = String(ch.name || "").trim();
      if (!name) fail("A new form needs a name.");
      if (formList.some((f) => lc(f.name) === lc(name))) fail(`There's already a form called ${name}.`);
      formList.push({ id: `new:${name}`, name, description: ch.description || null });
      ops.push({ op, name, description: ch.description ? String(ch.description) : null });
      rows.push({ label: "New form", after: name });
    } else if (op === "update_form") {
      const f = findForm(ch);
      if (!ch.name && ch.description === undefined) fail(`Say what to change about ${f.name}.`);
      ops.push({ op, form: f, name: ch.name ? String(ch.name).trim() : undefined, description: ch.description });
      if (ch.name) rows.push({ label: "Rename form", before: f.name, after: String(ch.name) });
      if (ch.description !== undefined) rows.push({ label: `${f.name} description`, before: f.description || "None", after: String(ch.description) || "None" });
    } else if (op === "delete_form") {
      const f = findForm(ch);
      const { count } = f.id.startsWith("new:") ? { count: 0 } : await c.client.from("checklist_form_responses").select("id", { count: "exact", head: true }).eq("form_template_id", f.id);
      ops.push({ op, form: f });
      rows.push({ label: "Delete form", after: f.name });
      warnings.push(`Deleting ${f.name} removes its questions${count ? ` and ${plural(count, "saved answer")}` : ""}. This can't be undone.`);
    } else if (op === "add_question" || op === "update_question") {
      const f = findForm(ch);
      const existing = op === "update_question" ? questionList.find((q) => q.id === ch.question_id && q.template_id === f.id) : null;
      if (op === "update_question" && !existing) fail(`That question isn't on ${f.name}. Read the form first to get its question_id.`);
      const type = lc(ch.type || existing?.field_type || "text");
      if (!ANSWER_TYPES.includes(type)) fail(`Answer type must be one of: ${ANSWER_TYPES.join(", ")}.`);
      const text = String(ch.question ?? existing?.question ?? "").trim();
      if (!text) fail("A question needs its wording.");
      const q = {
        category: String(ch.section ?? existing?.category ?? "General").trim() || "General",
        question: text,
        field_type: type,
        options: ch.options !== undefined || type !== existing?.field_type ? optionsOf(type, ch.options ?? existing?.options) : existing?.options || [],
        is_required: ch.required !== undefined ? !!ch.required : !!existing?.is_required,
      };
      ops.push({ op, form: f, q, existing });
      rows.push(
        existing
          ? { label: `Edit question on ${f.name}`, before: existing.question, after: `${q.question} · ${q.field_type}${q.is_required ? " · required" : ""}` }
          : { label: `Add to ${f.name}`, after: `${q.category}: ${q.question} · ${q.field_type}${q.options.length ? ` (${q.options.join(", ")})` : ""}${q.is_required ? " · required" : ""}` },
      );
    } else if (op === "delete_question") {
      const f = findForm(ch);
      const existing = questionList.find((q) => q.id === ch.question_id && q.template_id === f.id);
      if (!existing) fail(`That question isn't on ${f.name}.`);
      ops.push({ op, form: f, existing });
      rows.push({ label: `Remove from ${f.name}`, after: existing.question });
      warnings.push(`Removing "${existing.question}" can't be undone, and any answers to it are lost.`);
    } else if (op === "attach" || op === "detach") {
      const f = findForm(ch);
      const step = findStep(ch);
      ops.push({ op, form: f, step });
      rows.push({ label: op === "attach" ? `Show ${f.name} on` : `Stop showing ${f.name} on`, after: `${step.title} (${names[step.owner_team] || step.owner_team})` });
    } else {
      fail(`"${ch.op}" isn't a form change.`);
    }
  }
  return { ops, rows, warnings };
}

const manageChecklistForms: ActionDef = {
  label: "Manage checklist forms",
  async preview(c, p) {
    const plan = await planForms(c, p);
    const destructive = plan.ops.some((o) => o.op === "delete_form" || o.op === "delete_question");
    return {
      action: "manage_checklist_forms",
      title: "Change checklist forms",
      rows: plan.rows,
      warnings: plan.warnings.length ? plan.warnings : undefined,
      undoable: !destructive,
    };
  },
  async execute(c, p) {
    const plan = await planForms(c, p);
    const undo: UndoPlan[] = [];
    const created = new Map<string, string>();
    const formId = (f: P) => (String(f.id).startsWith("new:") ? created.get(f.id) : f.id);
    for (const o of plan.ops) {
      if (o.op === "create_form") {
        const { data, error } = await c.client.from("checklist_form_templates").insert({ name: o.name, description: o.description, tenant_id: c.tenantId }).select("id").single();
        if (error) throw error;
        created.set(`new:${o.name}`, (data as { id: string }).id);
        undo.push({ table: "checklist_form_templates", op: "delete", rows: [{ id: (data as { id: string }).id }] });
      } else if (o.op === "update_form") {
        const patch: P = {};
        if (o.name) patch.name = o.name;
        if (o.description !== undefined) patch.description = o.description || null;
        await c.client.from("checklist_form_templates").update(patch).eq("id", formId(o.form)).eq("tenant_id", c.tenantId);
        undo.push({ table: "checklist_form_templates", op: "update", rows: [{ id: o.form.id, before: { name: o.form.name, description: o.form.description } }] });
      } else if (o.op === "delete_form") {
        // Same delete as Settings → Checklist Forms; the database removes what hangs off the form.
        const id = formId(o.form);
        const { error } = await c.client.from("checklist_form_templates").delete().eq("id", id).eq("tenant_id", c.tenantId);
        if (error) throw error;
      } else if (o.op === "add_question") {
        const id = formId(o.form);
        const { count } = await c.client.from("checklist_form_fields").select("id", { count: "exact", head: true }).eq("template_id", id);
        const { data, error } = await c.client.from("checklist_form_fields").insert({ ...o.q, template_id: id, sort_order: count || 0, tenant_id: c.tenantId }).select("id").single();
        if (error) throw error;
        undo.push({ table: "checklist_form_fields", op: "delete", rows: [{ id: (data as { id: string }).id }] });
      } else if (o.op === "update_question") {
        await c.client.from("checklist_form_fields").update(o.q).eq("id", o.existing.id).eq("tenant_id", c.tenantId);
        const { category, question, field_type, options, is_required } = o.existing;
        undo.push({ table: "checklist_form_fields", op: "update", rows: [{ id: o.existing.id, before: { category, question, field_type, options, is_required } }] });
      } else if (o.op === "delete_question") {
        const { error } = await c.client.from("checklist_form_fields").delete().eq("id", o.existing.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
      } else if (o.op === "attach") {
        const id = formId(o.form);
        const { data: existing } = await c.client.from("checklist_form_assignments").select("id").eq("form_template_id", id).eq("checklist_template_id", o.step.id).maybeSingle();
        if (existing) continue;
        const { data, error } = await c.client.from("checklist_form_assignments").insert({ form_template_id: id, checklist_template_id: o.step.id, tenant_id: c.tenantId }).select("id").single();
        if (error) throw error;
        undo.push({ table: "checklist_form_assignments", op: "delete", rows: [{ id: (data as { id: string }).id }] });
      } else if (o.op === "detach") {
        const { data: rows } = await c.client.from("checklist_form_assignments").select("*").eq("form_template_id", formId(o.form)).eq("checklist_template_id", o.step.id).eq("tenant_id", c.tenantId);
        for (const r of (rows || []) as any[]) {
          await c.client.from("checklist_form_assignments").delete().eq("id", r.id);
          undo.push({ table: "checklist_form_assignments", op: "insert", rows: [{ id: r.id, before: r }] });
        }
      }
    }
    const destructive = plan.ops.some((o) => o.op === "delete_form" || o.op === "delete_question");
    return {
      message: `Forms updated: ${plural(plan.ops.length, "change")}.`,
      link: { label: "Open checklist forms", href: "/settings/checklist-forms" },
      undo: destructive ? undefined : undoablePlans(undo),
      log: { description: `Buddy changed checklist forms: ${plan.rows.map((r) => `${r.label} ${r.after}`).join("; ")}`, category: "settings", entityType: "checklist_forms", entityId: c.tenantId },
    };
  },
};

// ── manage_custom_fields ──────────────────────────────────────────────────

const FIELD_TYPES = ["text", "number", "date", "url", "boolean", "select"];

async function planCustomFields(c: BuddyCaller, p: P) {
  const changes = asArray(p.changes, "field changes");
  const { data } = await c.client.from("custom_fields").select("*").eq("tenant_id", c.tenantId).order("sort_order");
  const fields = [...((data || []) as any[])];
  const rows: PreviewRow[] = [];
  const ops: P[] = [];
  for (const ch of changes) {
    const op = lc(ch.op);
    if (op === "add") {
      const label = String(ch.label || "").trim();
      if (!label) fail("A new field needs a label.");
      if (fields.some((f) => lc(f.field_label) === lc(label))) fail(`There's already a field called ${label}.`);
      const type = lc(ch.type || "text");
      if (!FIELD_TYPES.includes(type)) fail(`Field type must be one of: ${FIELD_TYPES.join(", ")}.`);
      const options = optionsOf(type, ch.options);
      let key = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      for (let n = 2; fields.some((f) => f.field_key === key); n++) key = `${key.replace(/_\d+$/, "")}_${n}`;
      fields.push({ id: `new:${label}`, field_key: key, field_label: label, field_type: type });
      ops.push({ op, row: { field_key: key, field_label: label, field_type: type, options } });
      rows.push({ label: "Add field", after: `${label} · ${type}${options.length ? ` (${options.join(", ")})` : ""}` });
      continue;
    }
    const f = fields.find((x) => (ch.field_id && x.id === ch.field_id) || lc(x.field_label) === lc(ch.field));
    if (!f || String(f.id).startsWith("new:")) fail(`There's no custom field called "${ch.field || ch.field_id}".`);
    if (op === "update") {
      const type = lc(ch.type || f.field_type);
      if (!FIELD_TYPES.includes(type)) fail(`Field type must be one of: ${FIELD_TYPES.join(", ")}.`);
      const patch: P = {};
      if (ch.label) patch.field_label = String(ch.label).trim();
      if (ch.type) patch.field_type = type;
      if (ch.options !== undefined || ch.type) patch.options = optionsOf(type, ch.options ?? f.options);
      if (Object.keys(patch).length === 0) fail(`Say what to change about ${f.field_label}.`);
      ops.push({ op, f, patch });
      if (patch.field_label) rows.push({ label: "Rename field", before: f.field_label, after: patch.field_label });
      if (patch.field_type && patch.field_type !== f.field_type) rows.push({ label: `${f.field_label} type`, before: f.field_type, after: patch.field_type });
      if (patch.options) rows.push({ label: `${f.field_label} options`, before: (Array.isArray(f.options) ? f.options : []).join(", ") || "None", after: patch.options.join(", ") || "None" });
    } else if (op === "hide" || op === "show") {
      ops.push({ op, f, patch: { is_active: op === "show" } });
      rows.push({ label: op === "hide" ? "Hide field" : "Show field", after: f.field_label });
    } else {
      fail(`"${ch.op}" isn't a field change. Use add, update, hide or show.`);
    }
  }
  return { ops, rows, count: fields.length };
}

const manageCustomFields: ActionDef = {
  label: "Manage custom fields",
  async preview(c, p) {
    const plan = await planCustomFields(c, p);
    return {
      action: "manage_custom_fields",
      title: "Change custom fields",
      rows: plan.rows,
      notes: plan.ops.some((o) => o.op === "hide") ? ["Hidden fields keep the values already entered."] : undefined,
      undoable: true,
    };
  },
  async execute(c, p) {
    const plan = await planCustomFields(c, p);
    const undo: UndoPlan[] = [];
    let order = plan.count;
    for (const o of plan.ops) {
      if (o.op === "add") {
        const { data, error } = await c.client.from("custom_fields").insert({ ...o.row, sort_order: order++, tenant_id: c.tenantId }).select("id").single();
        if (error) throw error;
        undo.push({ table: "custom_fields", op: "delete", rows: [{ id: (data as { id: string }).id }] });
      } else {
        const { error } = await c.client.from("custom_fields").update(o.patch).eq("id", o.f.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
        undo.push({ table: "custom_fields", op: "update", rows: [{ id: o.f.id, before: Object.fromEntries(Object.keys(o.patch).map((k) => [k, o.f[k]])) }] });
      }
    }
    return {
      message: `Custom fields updated: ${plural(plan.ops.length, "change")}.`,
      link: { label: "Open custom fields", href: "/settings/custom-fields" },
      undo: undoablePlans(undo),
      log: { description: `Buddy changed custom fields: ${plan.rows.map((r) => `${r.label} ${r.after}`).join("; ")}`, category: "settings", entityType: "custom_fields", entityId: c.tenantId },
    };
  },
};

// ── set_project_stages ────────────────────────────────────────────────────

const MATCH_TYPES: FunnelMatchType[] = ["project_state", "all_completed", "any_completed", "none_completed"];
const describeStage = (s: FunnelStageRule) =>
  s.matchType === "project_state"
    ? `State is ${(s.projectStates || []).map((x) => STATE_NAMES[x] || x).join(" or ")}`
    : `${s.matchType === "all_completed" ? "All" : s.matchType === "any_completed" ? "Any" : "None"} of: ${(s.titles || []).join(", ")}`;

async function planStages(c: BuddyCaller, p: P) {
  const input = asArray(p.stages, "stages");
  const { data: steps } = await c.client.from("checklist_templates").select("title").eq("tenant_id", c.tenantId);
  const titles = ((steps || []) as { title: string }[]).map((s) => lc(s.title));
  const used = new Set<string>();
  const warnings: string[] = [];
  const stages: FunnelStageRule[] = input.map((s) => {
    const label = String(s.label || "").trim();
    if (!label) fail("Every stage needs a name.");
    const matchType = lc(s.match) as FunnelMatchType;
    if (!MATCH_TYPES.includes(matchType)) fail(`${label}: the rule must be one of ${MATCH_TYPES.join(", ")}.`);
    let id = slugify(label) || "stage";
    for (let n = 2; used.has(id); n++) id = `${slugify(label)}_${n}`;
    used.add(id);
    if (matchType === "project_state") {
      const states = (Array.isArray(s.states) ? s.states : [s.states]).map(lc).filter(Boolean);
      if (states.length === 0 || states.some((x) => !PROJECT_STATES.includes(x as never))) fail(`${label}: states must be from ${PROJECT_STATES.join(", ")}.`);
      return { id, label, matchType, projectStates: states };
    }
    const stepTitles = (Array.isArray(s.steps) ? s.steps : String(s.steps || "").split(",")).map((t: string) => String(t).trim().toLowerCase()).filter(Boolean);
    if (stepTitles.length === 0) fail(`${label}: name the checklist steps the rule checks.`);
    const missing = stepTitles.filter((t: string) => !titles.some((x) => x.includes(t)));
    if (missing.length) warnings.push(`${label} mentions ${missing.map((m: string) => `"${m}"`).join(", ")}, which no checklist step matches, so that part of the rule can never be met.`);
    return { id, label, matchType, titles: stepTitles };
  });
  return { stages, warnings };
}

const setProjectStages: ActionDef = {
  label: "Set project stages",
  async preview(c, p) {
    const plan = await planStages(c, p);
    const m = await settingsMap(c);
    const before = parseFunnelStages(m.get(FUNNEL_SETTINGS_KEY));
    return {
      action: "set_project_stages",
      title: "Set project stages",
      rows: [{ label: "Stages", before: before.map((s) => s.label).join(" → "), after: plan.stages.map((s) => s.label).join(" → ") }],
      items: plan.stages.map((s) => ({ label: s.label, detail: describeStage(s) })),
      notes: ["A project sits in the first stage, in this order, whose rule it matches."],
      warnings: plan.warnings.length ? plan.warnings : undefined,
      undoable: true,
    };
  },
  async execute(c, p) {
    const plan = await planStages(c, p);
    const undo = await writeSettings(c, [{ key: FUNNEL_SETTINGS_KEY, value: JSON.stringify(plan.stages) }]);
    return {
      message: `Project stages set: ${plan.stages.map((s) => s.label).join(" → ")}.`,
      link: { label: "Open project stages", href: "/settings/funnel" },
      undo: undoablePlans(undo),
      log: { description: `Buddy set project stages: ${plan.stages.map((s) => s.label).join(" → ")}`, category: "settings", entityType: "settings", entityId: c.tenantId },
    };
  },
};

// ── set_risk_rules ────────────────────────────────────────────────────────

const RULE_TYPES: RiskRuleType[] = ["checklist_overdue", "golive_missed", "no_activity", "project_state", "pending_acceptance", "unassigned_owner"];
const SEVERITIES: RiskSeverity[] = ["low", "medium", "high", "critical"];
const describeRule = (r: RiskRule) =>
  [r.enabled ? "On" : "Off", r.days !== undefined && ["checklist_overdue", "golive_missed", "no_activity"].includes(r.type) ? plural(r.days, "day") : "", r.states?.length ? r.states.map((s) => STATE_NAMES[s] || s).join("/") : "", r.severity]
    .filter(Boolean)
    .join(" · ");
const describeEgl = (r: EglRule) =>
  [r.enabled ? "On" : "Off", r.id === "stalled" ? plural(r.days ?? 5, "day") : "", r.id === "state" ? (r.states || []).map((s) => STATE_NAMES[s] || s).join("/") : ""].filter(Boolean).join(" · ");

async function planRisk(c: BuddyCaller, p: P) {
  if (!p.attention_rules && !p.golive_rules) fail("No risk rule changes were given.");
  const m = await settingsMap(c);
  const beforeRules = parseRiskRules(m.get(RISK_SETTINGS_KEY));
  const beforeEgl = parseEglRules(m.get(EGL_SETTINGS_KEY));
  const rows: PreviewRow[] = [];
  const writes: { key: string; value: string }[] = [];

  if (p.attention_rules) {
    const input = asArray(p.attention_rules, "attention rules");
    const rules: RiskRule[] = input.map((r) => {
      const type = lc(r.type) as RiskRuleType;
      if (!RULE_TYPES.includes(type)) fail(`Rule type must be one of: ${RULE_TYPES.join(", ")}.`);
      const severity = lc(r.severity || "medium") as RiskSeverity;
      if (!SEVERITIES.includes(severity)) fail(`Severity must be one of: ${SEVERITIES.join(", ")}.`);
      const existing = beforeRules.find((b) => b.id === r.id);
      const rule: RiskRule = { id: existing?.id || newRiskRuleId(), label: String(r.label || existing?.label || type.replace(/_/g, " ")).trim(), type, enabled: r.enabled !== false, severity };
      if (["checklist_overdue", "golive_missed", "no_activity"].includes(type)) {
        const days = Number(r.days ?? existing?.days ?? (type === "no_activity" ? 3 : 0));
        if (!Number.isFinite(days) || days < 0 || days > 365) fail(`${rule.label}: days must be between 0 and 365.`);
        rule.days = Math.round(days);
      }
      if (type === "project_state") {
        const states = (Array.isArray(r.states) ? r.states : [r.states]).map(lc).filter(Boolean);
        if (states.length === 0 || states.some((s) => !PROJECT_STATES.includes(s as never))) fail(`${rule.label}: states must be from ${PROJECT_STATES.join(", ")}.`);
        rule.states = states;
      }
      return rule;
    });
    for (const r of rules) {
      const b = beforeRules.find((x) => x.id === r.id);
      if (!b) rows.push({ label: `New rule: ${r.label}`, after: describeRule(r) });
      else if (describeRule(b) !== describeRule(r) || b.label !== r.label) rows.push({ label: r.label, before: describeRule(b), after: describeRule(r) });
    }
    for (const b of beforeRules) if (!rules.some((r) => r.id === b.id)) rows.push({ label: `Remove rule: ${b.label}`, after: "Removed" });
    writes.push({ key: RISK_SETTINGS_KEY, value: JSON.stringify(rules) });
  }

  if (p.golive_rules) {
    const patches = asArray(p.golive_rules, "go-live rules");
    const next = beforeEgl.map((r) => ({ ...r }));
    for (const patch of patches) {
      const rule = next.find((r) => r.id === patch.id);
      if (!rule) fail(`There's no go-live signal "${patch.id}". Signals: ${next.map((r) => r.id).join(", ")}.`);
      const before = describeEgl(rule!);
      if (patch.enabled !== undefined) rule!.enabled = !!patch.enabled;
      if (patch.days !== undefined) {
        const d = Number(patch.days);
        if (!Number.isFinite(d) || d < 1 || d > 90) fail("Stall days must be between 1 and 90.");
        rule!.days = Math.round(d);
      }
      if (patch.states !== undefined) {
        const states = (Array.isArray(patch.states) ? patch.states : [patch.states]).map(lc).filter(Boolean);
        if (states.some((s: string) => !PROJECT_STATES.includes(s as never))) fail(`States must be from ${PROJECT_STATES.join(", ")}.`);
        rule!.states = states;
      }
      if (describeEgl(rule!) !== before) rows.push({ label: `Go-live signal: ${rule!.label}`, before, after: describeEgl(rule!) });
    }
    writes.push({ key: EGL_SETTINGS_KEY, value: JSON.stringify(next) });
  }
  return { rows, writes };
}

const setRiskRules: ActionDef = {
  label: "Set risk rules",
  async preview(c, p) {
    const plan = await planRisk(c, p);
    return {
      action: "set_risk_rules",
      title: "Change risk rules",
      rows: plan.rows.length ? plan.rows : [{ label: "Changes", after: "Nothing to change" }],
      notes: ["Dashboards, the Risks page and Buddy's daily brief all use these rules."],
      undoable: true,
    };
  },
  async execute(c, p) {
    const plan = await planRisk(c, p);
    const undo = await writeSettings(c, plan.writes);
    return {
      message: `Risk rules updated: ${plural(plan.rows.length, "change")}.`,
      link: { label: "Open risk rules", href: "/settings/risk-rules" },
      undo: undoablePlans(undo),
      log: { description: `Buddy changed risk rules: ${plan.rows.map((r) => r.label).join(", ")}`, category: "settings", entityType: "settings", entityId: c.tenantId },
    };
  },
};

// ── Automations ───────────────────────────────────────────────────────────

const EVENT_NAMES = Object.fromEntries(WORKFLOW_EVENTS.map((e) => [e.value, e.label]));
const FIELD_NAMES = Object.fromEntries(WORKFLOW_FIELDS.map((f) => [f.value, f.label]));

/** Resolve names to ids and check the rule can run. Returns the stored shape. */
async function normaliseWorkflow(c: BuddyCaller, w: P) {
  const trigger_type = lc(w.trigger_type);
  const action_type = lc(w.action_type);
  const trigger_config: P = { ...(w.trigger_config || {}) };
  const action_config: P = { ...(w.action_config || {}) };
  const names = await teamNameMap(c);

  if (trigger_type === "time_based") {
    trigger_config.days_in_state = Number(trigger_config.days_in_state);
    trigger_config.frequency = trigger_config.frequency ? lc(trigger_config.frequency) : "daily";
  }
  const teamSlug = async (v: unknown) => (await resolveTeamSlug(c, v)).slug;
  if (trigger_type === "field_change" && trigger_config.field === "current_owner_team") {
    if (trigger_config.to_value) trigger_config.to_value = await teamSlug(trigger_config.to_value);
    if (trigger_config.from_value) trigger_config.from_value = await teamSlug(trigger_config.from_value);
  }
  if (action_type === "assign_owner" && action_config.owner_id) {
    const person = await loadPerson(c, action_config.owner_id);
    action_config.owner_name = person.name;
  }
  if (action_type === "transfer_project" && action_config.to_team) action_config.to_team = await teamSlug(action_config.to_team);
  if (action_type === "update_field") {
    if (action_config.field === "current_owner_team") action_config.value = await teamSlug(action_config.value);
    if (action_config.field === "assigned_owner") action_config.value = (await loadPerson(c, action_config.value)).id;
  }
  if (action_type === "send_notification") {
    const r = action_config.recipient ? String(action_config.recipient) : "assigned_owner";
    if (!["assigned_owner", "managers"].includes(r)) await loadPerson(c, r);
    action_config.recipient = r;
  }

  const problem = workflowProblem({ trigger_type, trigger_config, action_type, action_config });
  if (problem) fail(problem);

  const when =
    trigger_type === "event"
      ? `${EVENT_NAMES[trigger_config.event_name]}${trigger_config.checklist_title ? ` (steps named "${trigger_config.checklist_title}")` : ""}`
      : trigger_type === "field_change"
        ? `${FIELD_NAMES[trigger_config.field]} changes${trigger_config.from_value ? ` from ${trigger_config.from_value}` : ""}${trigger_config.to_value ? ` to ${STATE_NAMES[trigger_config.to_value] || names[trigger_config.to_value] || trigger_config.to_value}` : ""}`
        : trigger_type === "time_based"
          ? `A project has been ${trigger_config.project_state ? STATE_NAMES[trigger_config.project_state] : "in its state"} for ${plural(trigger_config.days_in_state, "day")} (checked ${trigger_config.frequency})`
          : "Only when someone runs it";
  let then = "";
  if (action_type === "assign_owner") then = `Assign to ${action_config.owner_name}`;
  if (action_type === "transfer_project") then = `Transfer to ${names[action_config.to_team] || action_config.to_team}`;
  if (action_type === "update_field") then = `Set ${FIELD_NAMES[action_config.field]} to ${STATE_NAMES[action_config.value] || names[action_config.value] || action_config.value}`;
  if (action_type === "send_notification") {
    const who = action_config.recipient === "assigned_owner" ? "the owner" : action_config.recipient === "managers" ? "all managers" : (await loadPerson(c, action_config.recipient)).name;
    then = `Notify ${who}: "${action_config.message}"`;
  }
  return { trigger_type, trigger_config, action_type, action_config, when, then };
}

const createWorkflow: ActionDef = {
  label: "Create automation",
  async preview(c, p) {
    if (!String(p.name || "").trim()) fail("The automation needs a name.");
    const w = await normaliseWorkflow(c, p);
    return {
      action: "create_workflow",
      title: "Create automation",
      rows: [
        { label: "Name", after: String(p.name) },
        { label: "When", after: w.when },
        { label: "Then", after: w.then },
      ],
      notes: [
        w.trigger_type === "time_based" || p.trigger_config?.event_name === "go_live_date_passed" ? "Checked every 10 minutes." : "Runs as soon as the change happens.",
        "Starts active. You can pause or edit it under Settings → Workflows.",
      ],
      undoable: true,
    };
  },
  async execute(c, p) {
    if (!String(p.name || "").trim()) fail("The automation needs a name.");
    const w = await normaliseWorkflow(c, p);
    const { data, error } = await c.client
      .from("ai_workflows")
      .insert({
        tenant_id: c.tenantId,
        name: String(p.name).trim(),
        description: p.description || null,
        trigger_type: w.trigger_type,
        trigger_config: w.trigger_config,
        action_type: w.action_type,
        action_config: w.action_config,
        created_by: c.userId,
        created_by_name: c.name,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    return {
      message: `Automation "${p.name}" is set up: ${w.when} → ${w.then}.`,
      link: { label: "Open workflows", href: "/settings/workflows" },
      undo: { table: "ai_workflows", op: "delete", rows: [{ id }] },
      log: { description: `Buddy created automation "${p.name}"`, category: "workflow", entityType: "workflow", entityId: id },
    };
  },
};

async function planAutomations(c: BuddyCaller, p: P) {
  const changes = asArray(p.changes, "automation changes");
  const { data } = await c.client.from("ai_workflows").select("*").eq("tenant_id", c.tenantId);
  const all = (data || []) as any[];
  const rows: PreviewRow[] = [];
  const ops: P[] = [];
  for (const ch of changes) {
    const wf = all.find((w) => w.id === ch.automation_id) || all.find((w) => lc(w.name) === lc(ch.name) && !ch.automation_id);
    if (!wf) fail(`There's no automation "${ch.automation_id || ch.name}".`);
    const op = lc(ch.op);
    if (op === "pause" || op === "resume") {
      ops.push({ op, wf, patch: { is_active: op === "resume" } });
      rows.push({ label: op === "pause" ? "Pause" : "Resume", after: wf.name });
    } else if (op === "delete") {
      ops.push({ op, wf });
      rows.push({ label: "Delete", after: wf.name });
    } else if (op === "update") {
      const merged = {
        trigger_type: ch.trigger_type ?? wf.trigger_type,
        trigger_config: ch.trigger_config ?? wf.trigger_config,
        action_type: ch.action_type ?? wf.action_type,
        action_config: ch.action_config ?? wf.action_config,
      };
      const w = await normaliseWorkflow(c, merged);
      const patch: P = { trigger_type: w.trigger_type, trigger_config: w.trigger_config, action_type: w.action_type, action_config: w.action_config };
      if (ch.new_name) patch.name = String(ch.new_name).trim();
      if (ch.description !== undefined) patch.description = ch.description || null;
      ops.push({ op, wf, patch });
      rows.push({ label: `Update ${wf.name}`, after: `${w.when} → ${w.then}` });
    } else {
      fail(`"${ch.op}" isn't an automation change. Use update, pause, resume or delete.`);
    }
  }
  return { ops, rows };
}

const manageAutomations: ActionDef = {
  label: "Manage automations",
  async preview(c, p) {
    const plan = await planAutomations(c, p);
    return { action: "manage_automations", title: "Change automations", rows: plan.rows, undoable: true };
  },
  async execute(c, p) {
    const plan = await planAutomations(c, p);
    const undo: UndoPlan[] = [];
    for (const o of plan.ops) {
      if (o.op === "delete") {
        const { error } = await c.client.from("ai_workflows").delete().eq("id", o.wf.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
        undo.push({ table: "ai_workflows", op: "insert", rows: [{ id: o.wf.id, before: o.wf }] });
      } else {
        const { error } = await c.client.from("ai_workflows").update({ ...o.patch, updated_at: new Date().toISOString() }).eq("id", o.wf.id).eq("tenant_id", c.tenantId);
        if (error) throw error;
        undo.push({ table: "ai_workflows", op: "update", rows: [{ id: o.wf.id, before: Object.fromEntries(Object.keys(o.patch).map((k) => [k, o.wf[k]])) }] });
      }
    }
    return {
      message: `Automations updated: ${plan.rows.map((r) => `${r.label} ${r.after}`).join("; ")}.`,
      link: { label: "Open workflows", href: "/settings/workflows" },
      undo: undoablePlans(undo),
      log: { description: `Buddy changed automations: ${plan.rows.map((r) => `${r.label} ${r.after}`).join("; ")}`, category: "workflow", entityType: "workflow", entityId: c.tenantId },
    };
  },
};

const runAutomation: ActionDef = {
  label: "Run an automation",
  async preview(c, p, ctx) {
    const { data: wf } = await c.client.from("ai_workflows").select("id, name, action_type, action_config").eq("tenant_id", c.tenantId).eq("id", p.automation_id).maybeSingle();
    if (!wf) fail("That automation isn't in this workspace.");
    const ids = Array.isArray(p.project_ids) ? p.project_ids.map(String) : [];
    if (ids.length === 0) fail("Say which projects to run it on.");
    const { data } = await c.client.from("projects").select("id, merchant_name").eq("tenant_id", c.tenantId).in("id", ids);
    const projects = (data || []) as { id: string; merchant_name: string }[];
    return {
      action: "run_automation",
      title: `Run "${(wf as { name: string }).name}"`,
      rows: [{ label: "Does", after: String((wf as { action_type: string }).action_type).replace(/_/g, " ") }],
      count: projects.length,
      items: projects.slice(0, 12).map((pr) => ({ label: pr.merchant_name })),
      warnings: projects.length > ctx.bulkLimit ? [`This runs on ${projects.length} projects, above the limit of ${ctx.bulkLimit}. Type the number to approve.`] : undefined,
      requiresTypedConfirm: projects.length > ctx.bulkLimit,
      undoable: false,
    };
  },
  async execute(c, p, ctx) {
    const ids = Array.isArray(p.project_ids) ? p.project_ids.map(String) : [];
    if (ids.length > ctx.bulkLimit && Number(p.confirm_count) !== ids.length) fail(`Running on ${ids.length} projects needs the count typed to confirm.`);
    const result = await runWorkflowOnProjects(ctx.req, c.tenantId, String(p.automation_id), ids);
    return {
      message: `Ran on ${plural(result.ran, "project")}${result.failed ? `; ${result.failed} failed (see Settings → Workflows)` : ""}${result.skipped ? `; ${result.skipped} weren't in this workspace` : ""}.`,
      link: { label: "Open workflows", href: "/settings/workflows" },
      log: { description: `Buddy ran an automation on ${plural(result.ran, "project")}`, category: "workflow", entityType: "workflow", entityId: String(p.automation_id) },
    };
  },
};

// ── People ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_ROLE_VALUES = ["admin", "super_admin", "superadmin"];

async function roleOptions(c: BuddyCaller) {
  const names = await teamNameMap(c);
  return { admin: "Workspace admin", manager: "Manager", ...Object.fromEntries(Object.entries(names).map(([slug, name]) => [slug, `${name} team member`])) } as Record<string, string>;
}
const resolveRole = (roles: Record<string, string>, v: unknown) => {
  const r = lc(v);
  const hit = Object.keys(roles).find((k) => k === r) || Object.entries(roles).find(([, l]) => lc(l) === r || lc(l).startsWith(r))?.[0];
  if (!hit) fail(`"${v}" isn't a role. Roles: ${Object.values(roles).join(", ")}.`);
  return hit!;
};

async function planInvites(c: BuddyCaller, p: P) {
  const people = asArray(p.people, "people");
  if (people.length > 100) fail("Invite up to 100 people at a time; propose the rest in another card.");
  const roles = await roleOptions(c);
  const seen = new Set<string>();
  const list = people.map((person) => {
    const name = String(person.name || "").trim();
    const email = lc(person.email);
    if (!name) fail("Every person needs a name.");
    if (!EMAIL_RE.test(email)) fail(`${person.email || name}: that isn't an email address.`);
    if (seen.has(email)) fail(`${email} is listed twice.`);
    seen.add(email);
    return { name, email, role: resolveRole(roles, person.role) };
  });
  const { data: existing } = await c.client.from("profiles").select("email").in("email", list.map((x) => x.email));
  const taken = ((existing || []) as { email: string }[]).map((x) => x.email);
  if (taken.length) fail(`${taken.join(", ")} already ${taken.length === 1 ? "has an account" : "have accounts"}. Change their role instead.`);
  return { list, roles };
}

const invitePeople: ActionDef = {
  label: "Invite people",
  requires: "admin",
  async preview(c, p) {
    const { list, roles } = await planInvites(c, p);
    const { data } = await c.client.from("tenant_integrations").select("resend_api_key").eq("tenant_id", c.tenantId).maybeSingle();
    const canEmail = !!(data as { resend_api_key?: string } | null)?.resend_api_key || !!process.env["RESEND_API_KEY"];
    return {
      action: "invite_people",
      title: `Invite ${plural(list.length, "person")}`,
      rows: [],
      items: list.map((x) => ({ label: `${x.name} · ${x.email}`, detail: roles[x.role] })),
      notes: canEmail ? ["Each person gets an email to set their own password."] : undefined,
      warnings: canEmail ? undefined : ["Email isn't set up, so no invites will be sent. Once it is, they can use Forgot password on the sign-in page."],
      undoable: false,
    };
  },
  async execute(c, p, ctx) {
    const { list } = await planInvites(c, p);
    const done: string[] = [];
    const problems: string[] = [];
    let emailed = 0;
    for (const person of list) {
      try {
        // A random password nobody knows; the person sets their own from the email.
        const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        await createWorkspaceUser({ email: person.email, password, name: person.name, role: person.role, tenantId: c.tenantId });
        done.push(person.name);
        try {
          if (await sendInviteEmail({ req: ctx.req, tenantId: c.tenantId, email: person.email, name: person.name, invitedBy: c.name })) emailed++;
        } catch (e) {
          problems.push(`${person.name}'s invite email didn't send (${(e as Error).message})`);
        }
      } catch (e) {
        problems.push(`${person.name}: ${(e as Error).message}`);
      }
    }
    if (done.length === 0) fail(problems.join("; "));
    return {
      message: `Added ${plural(done.length, "person")}${emailed ? `, ${emailed} invite email${emailed === 1 ? "" : "s"} sent` : ""}.${problems.length ? ` ${problems.join("; ")}.` : ""}`,
      link: { label: "Open users", href: "/settings/users" },
      log: { description: `Buddy invited ${done.join(", ")}`, category: "users", entityType: "users", entityId: c.tenantId },
    };
  },
};

async function planRoleChange(c: BuddyCaller, p: P) {
  const person = await loadPerson(c, p.user_id);
  if (person.id === c.userId) fail("You can't change your own role. Ask another admin.");
  const roles = await roleOptions(c);
  const role = resolveRole(roles, p.role);
  const { data: roleRow } = await c.client.from("user_roles").select("*").eq("user_id", person.id).maybeSingle();
  const current = (roleRow as { role?: string } | null)?.role || person.team;
  if (ADMIN_ROLE_VALUES.includes(current) && !ADMIN_ROLE_VALUES.includes(role)) {
    const { count } = await c.client.from("user_roles").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId).in("role", ["admin"]);
    if ((count || 0) <= 1) fail(`${person.name} is the only workspace admin. Make someone else an admin first.`);
  }
  if (current === "super_admin") fail(`${person.name} is a super admin; their role can't be changed here.`);
  return { person, role, current, roleRow: roleRow as { id: string; role: string } | null, roles };
}

const changeUserRole: ActionDef = {
  label: "Change a person's role",
  requires: "admin",
  async preview(c, p) {
    const plan = await planRoleChange(c, p);
    return {
      action: "change_user_role",
      title: "Change role",
      target: undefined,
      rows: [{ label: plan.person.name, before: plan.roles[plan.current] || plan.current, after: plan.roles[plan.role] }],
      notes: ["Takes effect the next time they load the app."],
      undoable: true,
    };
  },
  async execute(c, p) {
    const plan = await planRoleChange(c, p);
    await setUserRole(plan.person.id, plan.role, c.tenantId);
    const undo: UndoPlan[] = [{ table: "profiles", op: "update", rows: [{ id: plan.person.id, before: { team: plan.person.team } }] }];
    if (plan.roleRow) undo.push({ table: "user_roles", op: "update", rows: [{ id: plan.roleRow.id, before: { role: plan.roleRow.role } }] });
    return {
      message: `${plan.person.name} is now ${plan.roles[plan.role]}.`,
      link: { label: "Open users", href: "/settings/users" },
      undo,
      log: { description: `Buddy changed ${plan.person.name}'s role from ${plan.current} to ${plan.role}`, category: "users", entityType: "user", entityId: plan.person.id },
    };
  },
};

// ── Integrations ──────────────────────────────────────────────────────────

function planIntegrations(p: P, row: Record<string, string | null>) {
  const changes = p.changes && typeof p.changes === "object" && !Array.isArray(p.changes) ? (p.changes as P) : null;
  if (!changes || Object.keys(changes).length === 0) fail("No integration settings were given.");
  const patch: Record<string, string | null> = {};
  const rows: PreviewRow[] = [];
  const secrets: string[] = [];
  for (const [key, raw] of Object.entries(changes!)) {
    const def = INTEGRATION_BY_KEY.get(key);
    if (!def) fail(`"${key}" isn't an integration setting.`);
    const secret = isSecretIntegration(key);
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (value && def!.kind === "email" && !EMAIL_RE.test(value)) fail(`${def!.label} must be an email address.`);
    if (value && def!.kind === "url" && !/^https:\/\/\S+$/.test(value)) fail(`${def!.label} must be an https link.`);
    patch[key] = value || null;
    if (secret && value) secrets.push(value);
    rows.push({
      label: def!.label,
      before: secret ? (row[key] ? "Set" : "Not set") : row[key] || "Not set",
      after: value ? (secret ? maskSecret(value) : value) : "Cleared",
    });
  }
  return { patch, rows, secrets };
}

const redactIntegrationParams = (p: P): P => {
  if (!p.changes || typeof p.changes !== "object") return p;
  return {
    ...p,
    changes: Object.fromEntries(Object.entries(p.changes as P).map(([k, v]) => [k, isSecretIntegration(k) && v ? maskSecret(String(v)) : v])),
  };
};

const updateIntegrationSettings: ActionDef = {
  label: "Change integration settings",
  requires: "admin",
  redactParams: redactIntegrationParams,
  async preview(c, p) {
    const { data } = await c.client.from("tenant_integrations").select("*").eq("tenant_id", c.tenantId).maybeSingle();
    const plan = planIntegrations(p, (data || {}) as Record<string, string | null>);
    return {
      action: "update_integration_settings",
      title: "Change integration settings",
      rows: plan.rows,
      notes: plan.secrets.length ? ["Keys and secrets are hidden on this card, in the activity log, and in your saved chat once approved."] : undefined,
      undoable: plan.secrets.length === 0,
    };
  },
  async execute(c, p) {
    const { data } = await c.client.from("tenant_integrations").select("*").eq("tenant_id", c.tenantId).maybeSingle();
    const row = (data || null) as Record<string, string | null> | null;
    const plan = planIntegrations(p, row || {});
    const { data: saved, error } = await c.client.from("tenant_integrations").upsert({ tenant_id: c.tenantId, ...plan.patch }, { onConflict: "tenant_id" }).select("id").single();
    if (error) throw error;
    invalidateTenantIntegrations(c.tenantId);
    // Undoing would mean keeping the old secret in the log, so secret changes aren't undoable.
    const undo: UndoPlan | undefined =
      plan.secrets.length || Object.keys(plan.patch).some(isSecretIntegration)
        ? undefined
        : row
          ? { table: "tenant_integrations", op: "update", rows: [{ id: row.id as string, before: Object.fromEntries(Object.keys(plan.patch).map((k) => [k, row[k] ?? null])) }] }
          : { table: "tenant_integrations", op: "delete", rows: [{ id: (saved as { id: string }).id }] };
    return {
      message: `Updated ${plural(plan.rows.length, "integration setting")}.`,
      link: { label: "Open integrations", href: "/settings/integrations" },
      undo,
      secrets: plan.secrets,
      log: { description: `Buddy changed integration settings: ${plan.rows.map((r) => r.label).join(", ")}`, category: "settings", entityType: "integrations", entityId: c.tenantId },
    };
  },
};

// ── Buddy settings ────────────────────────────────────────────────────────

async function planBuddy(c: BuddyCaller, p: P) {
  const { data } = await c.client.from("app_settings").select("value").eq("tenant_id", c.tenantId).eq("key", BUDDY_SETTINGS_KEY).maybeSingle();
  const before = parseBuddySettings((data as { value?: string } | null)?.value);
  const next = { ...before, disabled_actions: [...before.disabled_actions] };
  const rows: PreviewRow[] = [];
  const { ALL_ACTION_TOOL_DEFS } = await import("@/lib/buddy/registry.server");
  const known = new Set<string>(ALL_ACTION_TOOL_DEFS.map((t: any) => t.function.name));

  if (p.brief_enabled !== undefined) {
    next.brief_enabled = !!p.brief_enabled;
    if (next.brief_enabled !== before.brief_enabled) rows.push({ label: "Daily brief", before: before.brief_enabled ? "On" : "Off", after: next.brief_enabled ? "On" : "Off" });
  }
  if (p.bulk_limit !== undefined) {
    const n = Number(p.bulk_limit);
    if (!Number.isFinite(n) || n < 1 || n > 500) fail("The bulk limit must be between 1 and 500.");
    next.bulk_limit = Math.round(n);
    if (next.bulk_limit !== before.bulk_limit) rows.push({ label: "Largest bulk change without typing the count", before: String(before.bulk_limit), after: String(next.bulk_limit) });
  }
  if (p.instructions !== undefined) {
    next.instructions = String(p.instructions || "").slice(0, 2000);
    rows.push({ label: "Instructions for Buddy", before: before.instructions || "None", after: next.instructions || "None" });
  }
  for (const name of Array.isArray(p.turn_off) ? p.turn_off.map(String) : []) {
    if (!known.has(name)) fail(`Buddy has no action called ${name}.`);
    if (name === "update_buddy_settings") fail("Buddy can't switch off its own settings action. Use Settings → Buddy.");
    if (!next.disabled_actions.includes(name)) {
      next.disabled_actions.push(name);
      rows.push({ label: `Action: ${name.replace(/_/g, " ")}`, before: "On", after: "Off" });
    }
  }
  for (const name of Array.isArray(p.turn_on) ? p.turn_on.map(String) : []) {
    if (!known.has(name)) fail(`Buddy has no action called ${name}.`);
    if (next.disabled_actions.includes(name)) {
      next.disabled_actions = next.disabled_actions.filter((a) => a !== name);
      rows.push({ label: `Action: ${name.replace(/_/g, " ")}`, before: "Off", after: "On" });
    }
  }
  if (rows.length === 0) fail("Nothing to change in Buddy's settings.");
  return { next, rows };
}

const updateBuddySettings: ActionDef = {
  label: "Change Buddy settings",
  requires: "admin",
  async preview(c, p) {
    const plan = await planBuddy(c, p);
    return { action: "update_buddy_settings", title: "Change Buddy settings", rows: plan.rows, undoable: true };
  },
  async execute(c, p) {
    const plan = await planBuddy(c, p);
    const undo = await writeSettings(c, [{ key: BUDDY_SETTINGS_KEY, value: JSON.stringify(plan.next) }]);
    return {
      message: "Buddy settings updated.",
      link: { label: "Open Buddy settings", href: "/settings/buddy" },
      undo: undoablePlans(undo),
      log: { description: `Buddy settings changed: ${plan.rows.map((r) => r.label).join(", ")}`, category: "settings", entityType: "settings", entityId: c.tenantId },
    };
  },
};

// ── Registry ──────────────────────────────────────────────────────────────

export const SETUP_ACTIONS: Record<string, ActionDef> = {
  update_workspace_settings: updateWorkspaceSettings,
  manage_teams: manageTeams,
  manage_checklist_steps: manageChecklistSteps,
  manage_checklist_forms: manageChecklistForms,
  manage_custom_fields: manageCustomFields,
  set_project_stages: setProjectStages,
  set_risk_rules: setRiskRules,
  create_workflow: createWorkflow,
  manage_automations: manageAutomations,
  run_automation: runAutomation,
  invite_people: invitePeople,
  change_user_role: changeUserRole,
  update_integration_settings: updateIntegrationSettings,
  update_buddy_settings: updateBuddySettings,
};

const fn = (name: string, description: string, properties: P, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const SETUP_ACTION_TOOL_DEFS: any[] = [
  fn(
    "update_workspace_settings",
    "Change key/value workspace settings: branding (org_name, app_title, app_subtitle, org_logo_url), terminology labels (field_*, state_*, phase_*, responsibility_*), email intake (email_monitor_address, email_subject_keywords), Slack alerts (slack_alerts_enabled, slack_channel_email, slack_alert_tag, slack_alert_hours), colours (color_*, hex) and tab visibility (nav:<tab> true/false). Use keys exactly as get_workspace_setup returns them. Value \"reset\" restores the default. Several keys in one call.",
    { changes: { type: "object", description: "{ key: value }", additionalProperties: true } },
    ["changes"],
  ),
  fn(
    "manage_teams",
    "Add, rename, recolour or delete teams. team: slug, current name or 'stage 1|2|3'. Stage teams can be renamed, not deleted. Deleting removes the team's checklist items from every project.",
    {
      changes: {
        type: "array",
        items: { type: "object", properties: { op: { type: "string", enum: ["add", "update", "delete"] }, team: { type: "string" }, name: { type: "string" }, color: { type: "string", description: "#RRGGBB" } }, required: ["op"] },
      },
    },
    ["changes"],
  ),
  fn(
    "manage_checklist_steps",
    "Change checklist template steps for a team: add (title, duration_days, optional position), update (step or step_id; title and/or duration_days), move (step, position from 1), delete (step). duration_days sets due dates as kick-off + days. apply_to_existing (default true) adds new steps to existing projects.",
    {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add", "update", "move", "delete"] },
            team: { type: "string" },
            step: { type: "string", description: "Existing step title" },
            step_id: { type: "string" },
            title: { type: "string" },
            duration_days: { type: "number" },
            position: { type: "number" },
          },
          required: ["op", "team"],
        },
      },
      apply_to_existing: { type: "boolean" },
    },
    ["changes"],
  ),
  fn(
    "manage_checklist_forms",
    "Change checklist forms: create_form (name, description), update_form (form, name, description), delete_form (form), add_question (form, section, question, type text|textarea|number|date|url|boolean|select, options, required), update_question (form, question_id, …), delete_question (form, question_id), attach / detach (form, step, team if ambiguous). Forms created earlier in the same call can be referenced by name.",
    {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["create_form", "update_form", "delete_form", "add_question", "update_question", "delete_question", "attach", "detach"] },
            form: { type: "string" },
            form_id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            question_id: { type: "string" },
            section: { type: "string" },
            question: { type: "string" },
            type: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            required: { type: "boolean" },
            step: { type: "string" },
            step_id: { type: "string" },
            team: { type: "string" },
          },
          required: ["op"],
        },
      },
    },
    ["changes"],
  ),
  fn(
    "manage_custom_fields",
    "Add, update, hide or show custom project fields. add: label, type text|number|date|url|boolean|select, options for select. update/hide/show: field (label) or field_id.",
    {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: { op: { type: "string", enum: ["add", "update", "hide", "show"] }, field: { type: "string" }, field_id: { type: "string" }, label: { type: "string" }, type: { type: "string" }, options: { type: "array", items: { type: "string" } } },
          required: ["op"],
        },
      },
    },
    ["changes"],
  ),
  fn(
    "set_project_stages",
    "Replace the project stages, in order. Each: label, match project_state (states) | all_completed | any_completed | none_completed (steps: checklist step names, matched by contains).",
    {
      stages: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, match: { type: "string", enum: MATCH_TYPES }, states: { type: "array", items: { type: "string" } }, steps: { type: "array", items: { type: "string" } } },
          required: ["label", "match"],
        },
      },
    },
    ["stages"],
  ),
  fn(
    "set_risk_rules",
    "Change risk rules. attention_rules: the full list (keep existing ids from get_workspace_setup; omit a rule to remove it): id?, label, type, enabled, days, states, severity. golive_rules: patches by id (golive_passed, state, pending_acceptance, checklist_overdue, work_after_golive, work_remaining, stalled): enabled, days (stalled), states (state).",
    {
      attention_rules: { type: "array", items: { type: "object" } },
      golive_rules: { type: "array", items: { type: "object" } },
    },
  ),
  fn(
    "create_workflow",
    "Create an automation. trigger_type event {event_name: project_created|project_state_changed|project_transferred|checklist_completed (+checklist_title?)|go_live_date_passed} | field_change {field, from_value?, to_value?} | time_based {days_in_state, frequency hourly|daily|weekly, project_state?} | manual {}. action_type assign_owner {owner_id} | update_field {field, value} | transfer_project {to_team: slug or name} | send_notification {message, recipient assigned_owner|managers|user_id}. Fields: project_state, current_owner_team, assigned_owner, expected_go_live_date, go_live_percent, integration_type, pg_onboarding.",
    {
      name: { type: "string" },
      description: { type: "string" },
      trigger_type: { type: "string", enum: ["event", "field_change", "time_based", "manual"] },
      trigger_config: { type: "object" },
      action_type: { type: "string", enum: ["assign_owner", "update_field", "send_notification", "transfer_project"] },
      action_config: { type: "object" },
    },
    ["name", "trigger_type", "trigger_config", "action_type", "action_config"],
  ),
  fn(
    "manage_automations",
    "Pause, resume, delete or update existing automations by automation_id (from get_workspace_setup area automations). update accepts new_name, description, trigger_type, trigger_config, action_type, action_config (same shapes as create_workflow).",
    {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["update", "pause", "resume", "delete"] },
            automation_id: { type: "string" },
            new_name: { type: "string" },
            description: { type: "string" },
            trigger_type: { type: "string" },
            trigger_config: { type: "object" },
            action_type: { type: "string" },
            action_config: { type: "object" },
          },
          required: ["op", "automation_id"],
        },
      },
    },
    ["changes"],
  ),
  fn(
    "run_automation",
    "Run an automation now on chosen projects (for manual automations, or to apply any rule on demand).",
    { automation_id: { type: "string" }, project_ids: { type: "array", items: { type: "string" } } },
    ["automation_id", "project_ids"],
  ),
  fn(
    "invite_people",
    "Workspace admins only. Create accounts and email each person a link to set their password. role: admin, manager, or a team slug or name.",
    {
      people: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, role: { type: "string" } }, required: ["name", "email", "role"] },
      },
    },
    ["people"],
  ),
  fn(
    "change_user_role",
    "Workspace admins only. Change a person's role: admin, manager, or a team. Get user_id from list_people or get_workspace_setup area people.",
    { user_id: { type: "string" }, role: { type: "string" } },
    ["user_id", "role"],
  ),
  fn(
    "update_integration_settings",
    "Workspace admins only. Set integration settings, including API keys, tokens and secrets the user pastes: resend_api_key, from_email, from_name, reply_to, app_base_url, google_mail_api_key, gmail_monitor_address, jira_base_url, jira_email, jira_api_token, jira_project_key, slack_webhook_url, slack_bot_token, slack_channel, zoom_account_id, zoom_client_id, zoom_client_secret, zoom_webhook_secret, zoom_user_id, teams_tenant_id, teams_client_id, teams_client_secret, teams_organizer_user_id, google_oauth_client_id, google_oauth_client_secret, google_meet_refresh_token, google_calendar_refresh_token. Empty string clears a value.",
    { changes: { type: "object", additionalProperties: true } },
    ["changes"],
  ),
  fn(
    "update_buddy_settings",
    "Workspace admins only. Change Buddy's settings: brief_enabled, bulk_limit (1-500), instructions (house rules, up to 2000 characters), turn_on / turn_off (action names).",
    {
      brief_enabled: { type: "boolean" },
      bulk_limit: { type: "number" },
      instructions: { type: "string" },
      turn_on: { type: "array", items: { type: "string" } },
      turn_off: { type: "array", items: { type: "string" } },
    },
  ),
];
