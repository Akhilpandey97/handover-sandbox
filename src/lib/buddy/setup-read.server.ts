import type { BuddyCaller } from "@/lib/buddy/scope.server";
import type { ReadToolResult } from "@/lib/buddy/read-tools.server";
import {
  AREAS,
  AREA_BY_ID,
  INTEGRATIONS,
  NAV_TABS,
  SETTINGS,
  hasRole,
  isSecretIntegration,
  settingDefault,
  type AreaId,
} from "@/lib/buddy/setup-catalog.server";
import { FUNNEL_SETTINGS_KEY, FUNNEL_MATCH_LABELS, parseFunnelStages } from "@/data/funnelConfig";
import { RISK_SETTINGS_KEY, parseRiskRules } from "@/data/riskRules";
import { EGL_SETTINGS_KEY, parseEglRules } from "@/data/eglRisk";
import { BUDDY_SETTINGS_KEY, parseBuddySettings } from "@/lib/buddy/settings.server";
import { WORKFLOW_ACTIONS, WORKFLOW_EVENTS, WORKFLOW_FIELDS, WORKFLOW_TRIGGER_TYPES } from "@/data/workflowConfig";

/**
 * get_workspace_setup: where a workspace's configuration stands.
 *
 * Without an area: every onboarding area with its status, so Buddy can show
 * progress and pick up where the person left off. With an area: the current
 * values, defaults and options Buddy needs to ask good questions.
 */

export const SYSTEM_TEAM_DEFAULTS = [
  { slug: "mint", name: "Sales", color: "#3b82f6", stage: 1 },
  { slug: "integration", name: "MINT", color: "#a855f7", stage: 2 },
  { slug: "ms", name: "Merchant Success", color: "#10b981", stage: 3 },
];

export const SETUP_TOOL_DEF = {
  type: "function",
  function: {
    name: "get_workspace_setup",
    description:
      "Read how this workspace is configured, for onboarding and for changing settings. Without area: every setup area with status (not_set_up | defaults | set_up) and who may change it. With area: current values, defaults and valid options for that area. Call it before asking onboarding questions and before proposing any setup change.",
    parameters: {
      type: "object",
      properties: {
        area: { type: "string", enum: AREAS.map((a) => a.id) },
        include_advanced: { type: "boolean", description: "Terminology: include link, notes and credential labels; look_and_buddy: include colours" },
      },
    },
  },
};

type Status = "not_set_up" | "defaults" | "set_up";

async function settingsMap(c: BuddyCaller): Promise<Map<string, string>> {
  const { data } = await c.client.from("app_settings").select("key, value").eq("tenant_id", c.tenantId);
  return new Map(((data || []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

async function integrationsRow(c: BuddyCaller): Promise<Record<string, string | null>> {
  const { data } = await c.client.from("tenant_integrations").select("*").eq("tenant_id", c.tenantId).maybeSingle();
  return (data || {}) as Record<string, string | null>;
}

const saved = (m: Map<string, string>, keys: string[]) => keys.some((k) => m.has(k) && m.get(k) !== settingDefault(k));

function navVisibility(m: Map<string, string>): Record<string, boolean> {
  try {
    const parsed = JSON.parse(m.get("nav_visibility") || "{}") as Record<string, boolean>;
    return Object.fromEntries(NAV_TABS.map((t) => [t.key, parsed[t.key] !== false]));
  } catch {
    return Object.fromEntries(NAV_TABS.map((t) => [t.key, true]));
  }
}

/** Current value of a key/value setting, including the nav:* virtual keys. */
export function currentSetting(m: Map<string, string>, key: string): string {
  if (key.startsWith("nav:")) return String(navVisibility(m)[key.slice(4)] ?? true);
  return m.get(key) ?? settingDefault(key);
}

async function teamsFor(c: BuddyCaller) {
  const { data } = await c.client.from("teams").select("id, slug, name, color, is_system, sort_order").eq("tenant_id", c.tenantId).order("sort_order");
  const rows = (data || []) as { id: string; slug: string; name: string; color: string; is_system: boolean; sort_order: number }[];
  const stages = SYSTEM_TEAM_DEFAULTS.map((d) => {
    const row = rows.find((r) => r.slug === d.slug);
    return { slug: d.slug, stage: d.stage, name: row?.name || d.name, color: row?.color || d.color, default_name: d.name, saved: !!row };
  });
  const extra = rows.filter((r) => !SYSTEM_TEAM_DEFAULTS.some((d) => d.slug === r.slug)).map((r) => ({ slug: r.slug, name: r.name, color: r.color }));
  return { stages, extra };
}

export async function teamNameMap(c: BuddyCaller): Promise<Record<string, string>> {
  const { stages, extra } = await teamsFor(c);
  return Object.fromEntries([...stages, ...extra].map((t) => [t.slug, t.name]));
}

async function countOf(c: BuddyCaller, table: string, filter?: (q: any) => any): Promise<number> {
  let q = c.client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId);
  if (filter) q = filter(q);
  const { count } = await q;
  return count || 0;
}

/** Status and a one-line summary for every area. */
export async function setupOverview(c: BuddyCaller) {
  const [m, integ, teams, people, steps, forms, fields, workflows] = await Promise.all([
    settingsMap(c),
    integrationsRow(c),
    teamsFor(c),
    countOf(c, "profiles"),
    countOf(c, "checklist_templates"),
    countOf(c, "checklist_form_templates"),
    countOf(c, "custom_fields", (q) => q.eq("is_active", true)),
    countOf(c, "ai_workflows"),
  ]);
  const isSet = (k: string) => !!integ[k];
  const areaKeys = (area: AreaId, advanced = true) => SETTINGS.filter((s) => s.area === area && (advanced || !s.advanced)).map((s) => s.key);
  const renamedTeams = teams.stages.filter((t) => t.saved && t.name !== t.default_name).length;
  const intGroups = ["Jira", "Slack", "Zoom", "Microsoft Teams", "Google Meet"].filter((g) =>
    INTEGRATIONS.some((i) => i.group === g && isSet(i.key as string)),
  );

  const status: Record<AreaId, { status: Status; summary: string }> = {
    branding: saved(m, areaKeys("branding"))
      ? { status: "set_up", summary: `Organisation: ${currentSetting(m, "org_name")}` }
      : { status: "defaults", summary: "Still called Handover, no logo" },
    email_sending: isSet("resend_api_key") && isSet("from_email")
      ? { status: "set_up", summary: `Sending as ${integ.from_email}` }
      : isSet("resend_api_key") || isSet("from_email")
        ? { status: "defaults", summary: `Missing ${isSet("resend_api_key") ? "From address" : "Resend API key"}` }
        : { status: "not_set_up", summary: "No email provider connected" },
    teams: renamedTeams || teams.extra.length
      ? { status: "set_up", summary: `${teams.stages.map((t) => t.name).join(" → ")}${teams.extra.length ? ` + ${teams.extra.length} more` : ""}` }
      : { status: "defaults", summary: "Default team names" },
    people: people > 1 ? { status: "set_up", summary: `${people} people` } : { status: "not_set_up", summary: "Only one person" },
    terminology: saved(m, areaKeys("terminology"))
      ? { status: "set_up", summary: "Custom names saved" }
      : { status: "defaults", summary: "Default names (Merchant, MID, ARR…)" },
    checklists: steps > 0 ? { status: "set_up", summary: `${steps} checklist steps` } : { status: "not_set_up", summary: "No checklist steps" },
    forms: forms > 0 ? { status: "set_up", summary: `${forms} form${forms === 1 ? "" : "s"}` } : { status: "not_set_up", summary: "No forms" },
    custom_fields: fields > 0 ? { status: "set_up", summary: `${fields} custom field${fields === 1 ? "" : "s"}` } : { status: "not_set_up", summary: "No custom fields" },
    stages: m.has(FUNNEL_SETTINGS_KEY) ? { status: "set_up", summary: "Custom stages" } : { status: "defaults", summary: "Default stages (Sales → Live)" },
    risk_rules: m.has(RISK_SETTINGS_KEY) || m.has(EGL_SETTINGS_KEY)
      ? { status: "set_up", summary: "Custom risk rules" }
      : { status: "defaults", summary: "Default risk rules" },
    automations: workflows > 0 ? { status: "set_up", summary: `${workflows} automation${workflows === 1 ? "" : "s"}` } : { status: "not_set_up", summary: "No automations" },
    email_intake: m.get("email_monitor_address")
      ? { status: "set_up", summary: `From ${m.get("email_monitor_address")}` }
      : { status: "not_set_up", summary: "Projects aren't created from email" },
    integrations: intGroups.length ? { status: "set_up", summary: `Connected: ${intGroups.join(", ")}` } : { status: "not_set_up", summary: "No integrations" },
    alerts: m.get("slack_alerts_enabled") === "true" ? { status: "set_up", summary: "Slack digest on" } : { status: "defaults", summary: "Slack digest off" },
    look_and_buddy: m.has("nav_visibility") || m.has(BUDDY_SETTINGS_KEY) || saved(m, areaKeys("look_and_buddy"))
      ? { status: "set_up", summary: "Customised" }
      : { status: "defaults", summary: "All tabs, default colours" },
  };

  const areas = AREAS.map((a) => ({
    id: a.id,
    title: a.title,
    purpose: a.purpose,
    who: a.role === "admin" ? "Workspace admins" : "Managers and admins",
    can_change: hasRole(c.roles, a.role),
    ...status[a.id],
  }));
  const done = areas.filter((a) => a.status === "set_up").length;
  const next = areas.find((a) => a.status !== "set_up" && a.can_change);
  return { progress: { set_up: done, total: areas.length }, areas, next_suggested: next?.id ?? null };
}

async function areaDetail(c: BuddyCaller, area: AreaId, includeAdvanced: boolean) {
  const def = AREA_BY_ID.get(area)!;
  const canChange = hasRole(c.roles, def.role);
  const base = { id: def.id, title: def.title, purpose: def.purpose, how_to_ask: def.ask, can_change: canChange, actions: def.actions };
  const m = await settingsMap(c);
  const kv = (keys: { key: string; label: string; help?: string; advanced?: boolean }[]) =>
    keys
      .filter((s) => includeAdvanced || !s.advanced)
      .map((s) => ({ key: s.key, label: s.label, current: currentSetting(m, s.key), default: settingDefault(s.key), ...(s.help ? { help: s.help } : {}) }));
  const settingsIn = (a: AreaId) => SETTINGS.filter((s) => s.area === a);

  const integrationFields = async (a: AreaId) => {
    if (!hasRole(c.roles, "admin")) return { note: "Only workspace admins can see or change integration settings." };
    const row = await integrationsRow(c);
    return {
      integration_fields: INTEGRATIONS.filter((i) => i.area === a).map((i) => ({
        key: i.key,
        label: i.label,
        group: i.group,
        secret: isSecretIntegration(i.key as string),
        // Secrets are reported as set or not, never read back.
        current: isSecretIntegration(i.key as string) ? (row[i.key as string] ? "Set" : "Not set") : row[i.key as string] || "Not set",
      })),
    };
  };

  switch (area) {
    case "branding":
    case "terminology":
    case "alerts":
      return { ...base, settings: kv(settingsIn(area)) };
    case "email_intake":
      return { ...base, settings: kv(settingsIn(area)), ...(await integrationFields("email_intake")) };
    case "email_sending":
    case "integrations":
      return { ...base, ...(await integrationFields(area)) };
    case "look_and_buddy": {
      const { data } = await c.client.from("app_settings").select("value").eq("tenant_id", c.tenantId).eq("key", BUDDY_SETTINGS_KEY).maybeSingle();
      return {
        ...base,
        settings: kv(settingsIn(area)),
        buddy: { ...parseBuddySettings((data as { value?: string } | null)?.value), can_change: hasRole(c.roles, "admin") },
      };
    }
    case "teams": {
      const t = await teamsFor(c);
      return {
        ...base,
        stage_teams: t.stages.map(({ slug, stage, name, color, default_name }) => ({ slug, stage, name, color, default_name })),
        extra_teams: t.extra,
        note: "Handoffs always go stage 1 → 2 → 3. Extra teams own checklist steps but don't receive handoffs. Stage teams can be renamed but not deleted.",
      };
    }
    case "people": {
      const [{ data: people }, { data: roles }, names] = await Promise.all([
        c.client.from("profiles").select("id, name, email, team").eq("tenant_id", c.tenantId).order("name"),
        c.client.from("user_roles").select("user_id, role").eq("tenant_id", c.tenantId),
        teamNameMap(c),
      ]);
      const roleOf = new Map(((roles || []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role]));
      return {
        ...base,
        people: ((people || []) as any[]).map((p) => ({ user_id: p.id, name: p.name, email: p.email, role: roleOf.get(p.id) || p.team })),
        roles: [
          { value: "admin", label: "Workspace admin" },
          { value: "manager", label: "Manager" },
          ...Object.entries(names).map(([slug, name]) => ({ value: slug, label: `${name} team member` })),
        ],
      };
    }
    case "checklists": {
      const [{ data }, names] = await Promise.all([
        c.client.from("checklist_templates").select("id, title, owner_team, sort_order, standard_duration").eq("tenant_id", c.tenantId).order("sort_order"),
        teamNameMap(c),
      ]);
      const rows = (data || []) as { id: string; title: string; owner_team: string; sort_order: number; standard_duration: number | null }[];
      return {
        ...base,
        teams: Object.entries(names).map(([slug, name]) => ({
          team: slug,
          team_name: name,
          steps: rows.filter((r) => r.owner_team === slug).map((r, i) => ({ step_id: r.id, position: i + 1, title: r.title, duration_days: r.standard_duration })),
        })),
      };
    }
    case "forms": {
      const [{ data: forms }, { data: fieldRows }, { data: assigns }, { data: steps }] = await Promise.all([
        c.client.from("checklist_form_templates").select("id, name, description").eq("tenant_id", c.tenantId).order("name"),
        c.client.from("checklist_form_fields").select("id, template_id, category, question, field_type, options, is_required, sort_order").eq("tenant_id", c.tenantId).order("sort_order"),
        c.client.from("checklist_form_assignments").select("checklist_template_id, form_template_id").eq("tenant_id", c.tenantId),
        c.client.from("checklist_templates").select("id, title, owner_team").eq("tenant_id", c.tenantId),
      ]);
      const stepTitle = new Map(((steps || []) as any[]).map((s) => [s.id, s.title]));
      return {
        ...base,
        answer_types: ["text", "textarea", "number", "date", "url", "boolean", "select"],
        forms: ((forms || []) as any[]).map((f) => ({
          form_id: f.id,
          name: f.name,
          description: f.description,
          questions: ((fieldRows || []) as any[]).filter((q) => q.template_id === f.id).map((q) => ({
            question_id: q.id,
            section: q.category,
            question: q.question,
            type: q.field_type,
            options: Array.isArray(q.options) ? q.options : [],
            required: q.is_required,
          })),
          attached_to_steps: ((assigns || []) as any[]).filter((a) => a.form_template_id === f.id).map((a) => ({ step_id: a.checklist_template_id, title: stepTitle.get(a.checklist_template_id) })),
        })),
      };
    }
    case "custom_fields": {
      const { data } = await c.client.from("custom_fields").select("id, field_key, field_label, field_type, options, is_active").eq("tenant_id", c.tenantId).order("sort_order");
      return {
        ...base,
        types: ["text", "number", "date", "url", "boolean", "select"],
        fields: ((data || []) as any[]).map((f) => ({ field_id: f.id, label: f.field_label, type: f.field_type, options: Array.isArray(f.options) ? f.options : [], shown: f.is_active })),
      };
    }
    case "stages":
      return {
        ...base,
        stages: parseFunnelStages(m.get(FUNNEL_SETTINGS_KEY)),
        rule_types: FUNNEL_MATCH_LABELS,
        note: "Stages are checked in order; a project is in the first stage whose rule matches. Checklist titles match case-insensitively by 'contains'.",
      };
    case "risk_rules":
      return {
        ...base,
        attention_rules: parseRiskRules(m.get(RISK_SETTINGS_KEY)),
        golive_rules: parseEglRules(m.get(EGL_SETTINGS_KEY)),
        severities: ["low", "medium", "high", "critical"],
        attention_rule_types: ["checklist_overdue", "golive_missed", "no_activity", "project_state", "pending_acceptance", "unassigned_owner"],
      };
    case "automations": {
      const { data } = await c.client.from("ai_workflows").select("id, name, description, trigger_type, trigger_config, action_type, action_config, is_active, trigger_count").eq("tenant_id", c.tenantId).order("created_at");
      return {
        ...base,
        automations: ((data || []) as any[]).map((w) => ({ automation_id: w.id, ...w, id: undefined })),
        options: {
          trigger_types: WORKFLOW_TRIGGER_TYPES,
          events: WORKFLOW_EVENTS,
          fields: WORKFLOW_FIELDS,
          actions: WORKFLOW_ACTIONS,
          config_shapes: {
            event: "{ event_name, checklist_title? (only for checklist_completed) }",
            field_change: "{ field, from_value?, to_value? }",
            time_based: "{ days_in_state, frequency: hourly|daily|weekly, project_state? }",
            manual: "{}",
            assign_owner: "{ owner_id }",
            update_field: "{ field, value }",
            transfer_project: "{ to_team }",
            send_notification: "{ message, recipient: assigned_owner|managers|<user_id> }",
          },
        },
      };
    }
  }
}

export async function runSetupTool(c: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult> {
  try {
    const area = typeof args.area === "string" && AREA_BY_ID.has(args.area as AreaId) ? (args.area as AreaId) : null;
    if (!area) {
      const overview = await setupOverview(c);
      return {
        step: `Checked workspace setup (${overview.progress.set_up} of ${overview.progress.total} areas set up)`,
        data: overview,
        sources: [{ kind: "data", label: "Workspace setup" }],
      };
    }
    const detail = await areaDetail(c, area, !!args.include_advanced);
    return { step: `Read ${AREA_BY_ID.get(area)!.title.toLowerCase()} settings`, data: detail, sources: [{ kind: "data", label: AREA_BY_ID.get(area)!.title }] };
  } catch (err) {
    return { step: "Couldn't read workspace setup", data: { error: (err as Error).message }, sources: [] };
  }
}
