import { DEFAULT_LABELS } from "@/data/defaultLabels";
import { INTEGRATION_FIELDS, SECRET_FIELDS, type TenantIntegrations } from "@/lib/tenant-integrations.server";

/**
 * Everything a workspace can configure, described once.
 *
 * Buddy's onboarding asks from this list, get_workspace_setup reports from it,
 * and the setup actions only write what it allows, validated the way it says.
 * Add a setting to the app, add it here, and onboarding picks it up.
 */

export type Role = "manager" | "admin";

export type SettingKind = "text" | "email" | "url" | "color" | "bool" | "number" | "keywords";

export interface SettingDef {
  key: string;
  label: string;
  area: AreaId;
  kind: SettingKind;
  role: Role;
  help?: string;
  min?: number;
  max?: number;
  /** Shown in onboarding only when the person asks for more. */
  advanced?: boolean;
}

export type AreaId =
  | "branding"
  | "email_sending"
  | "teams"
  | "people"
  | "terminology"
  | "checklists"
  | "forms"
  | "custom_fields"
  | "stages"
  | "risk_rules"
  | "automations"
  | "email_intake"
  | "integrations"
  | "alerts"
  | "look_and_buddy";

export interface AreaDef {
  id: AreaId;
  title: string;
  purpose: string;
  role: Role;
  /** How Buddy should ask for this area. */
  ask: string;
  /** The action that applies answers for this area. */
  actions: string[];
}

export const AREAS: AreaDef[] = [
  {
    id: "branding",
    title: "Organisation & branding",
    purpose: "What the team and merchants see: the organisation name in emails, the portal and Buddy's answers.",
    role: "admin",
    ask: "Ask for organisation name, dashboard title and subtitle, and a logo link (https URL to an image; or they can upload in Settings → General).",
    actions: ["update_workspace_settings"],
  },
  {
    id: "email_sending",
    title: "Email sending",
    purpose: "Needed before inviting people or emailing merchants.",
    role: "admin",
    ask: "Ask for the From address, From name, Reply-to and the app link used in emails, and the Resend API key if it's missing.",
    actions: ["update_integration_settings"],
  },
  {
    id: "teams",
    title: "Teams & handoffs",
    purpose: "Who works on a project and in what order. Handoffs always go stage 1 → stage 2 → stage 3.",
    role: "manager",
    ask: "Ask for the name and colour of the stage 1, 2 and 3 teams, and any extra teams that own checklist steps but don't receive handoffs.",
    actions: ["manage_teams"],
  },
  {
    id: "people",
    title: "People & roles",
    purpose: "Invite the team. Each invitee gets a set-password email.",
    role: "admin",
    ask: "Ask for each person's name, email and role (admin, manager, or one of the teams). Accept a pasted list.",
    actions: ["invite_people", "change_user_role"],
  },
  {
    id: "terminology",
    title: "Terminology",
    purpose: "Rename fields, project states, phases and the responsibility parties to match how the company talks.",
    role: "manager",
    ask: "Ask about core field names, project states, phases and responsibility parties together. Offer link, notes and credential labels only if they want more.",
    actions: ["update_workspace_settings"],
  },
  {
    id: "checklists",
    title: "Checklists",
    purpose: "The steps each team completes on every project; the standard duration sets each step's due date (kick-off + days).",
    role: "manager",
    ask: "For each team, show the current steps with durations and ask which to add, rename, reorder, re-time or remove. Accept a pasted list like 'Kick-off call – 2 days'.",
    actions: ["manage_checklist_steps"],
  },
  {
    id: "forms",
    title: "Checklist forms",
    purpose: "Structured questions attached to checklist steps. A form whose name contains BRD is the one 'Send BRD form' sends.",
    role: "manager",
    ask: "Ask for form names, their questions (section, question, answer type, options, required) and which steps show each form.",
    actions: ["manage_checklist_forms"],
  },
  {
    id: "custom_fields",
    title: "Custom project fields",
    purpose: "Extra information tracked on every project, usable in filters and dashboard charts.",
    role: "manager",
    ask: "Ask for each field's label, type (text, number, date, link, yes/no, dropdown) and dropdown options.",
    actions: ["manage_custom_fields"],
  },
  {
    id: "stages",
    title: "Project stages",
    purpose: "How projects are grouped on the Kanban board, TAT report and portal roadmap. Rules use checklist step names, so set checklists first.",
    role: "manager",
    ask: "Show the current stages in order with their rules, and ask for the stages they want and what puts a project in each.",
    actions: ["set_project_stages"],
  },
  {
    id: "risk_rules",
    title: "Risk rules",
    purpose: "What puts a project in Needs attention, and what makes an upcoming go-live look at risk.",
    role: "manager",
    ask: "Show each attention rule (on/off, days, severity) and each go-live risk signal (on/off, stall days, states) and ask what to change.",
    actions: ["set_risk_rules"],
  },
  {
    id: "automations",
    title: "Automations",
    purpose: "When this happens, do that: assign, transfer, set a field or notify.",
    role: "manager",
    ask: "List existing automations, then ask what should happen automatically. Suggest common ones (notify managers when blocked for N days, assign new projects by platform).",
    actions: ["create_workflow", "manage_automations"],
  },
  {
    id: "email_intake",
    title: "Creating projects from email",
    purpose: "Turn handover emails into projects.",
    role: "manager",
    ask: "Ask for the sender address and subject keywords; admins also set the mailbox to watch.",
    actions: ["update_workspace_settings", "update_integration_settings"],
  },
  {
    id: "integrations",
    title: "Other integrations",
    purpose: "Jira, Slack, Zoom, Microsoft Teams and Google Meet.",
    role: "admin",
    ask: "Ask which of Jira, Slack, Zoom, Teams and Google Meet they use, then ask for that integration's fields, including keys and secrets.",
    actions: ["update_integration_settings"],
  },
  {
    id: "alerts",
    title: "Alerts",
    purpose: "A daily Slack digest of merchants who haven't responded to a tagged checklist note.",
    role: "manager",
    ask: "Ask whether to send the digest, the Slack channel email, the tag and the hours before an item is included.",
    actions: ["update_workspace_settings"],
  },
  {
    id: "look_and_buddy",
    title: "Navigation, colours & Buddy",
    purpose: "Which tabs show, the colour scheme, and how Buddy behaves.",
    role: "manager",
    ask: "Ask which tabs to hide (suggest hiding Shopify and Platforms if unused), whether to change colours, and (admins) Buddy's brief, bulk limit and house instructions.",
    actions: ["update_workspace_settings", "update_buddy_settings"],
  },
];

export const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

// ── Key/value settings stored in app_settings ─────────────────────────────

const text = (key: string, label: string, area: AreaId, role: Role = "manager", extra: Partial<SettingDef> = {}): SettingDef => ({
  key,
  label,
  area,
  kind: "text",
  role,
  ...extra,
});

export const NAV_TABS: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "projects", label: "Projects" },
  { key: "risks", label: "Risks" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "emails", label: "Emails" },
  { key: "archived", label: "Archived" },
  { key: "platforms", label: "Platforms" },
  { key: "golive", label: "Go-Live Tracker" },
  { key: "shopify-sme", label: "Shopify SME and Ent" },
  { key: "shopify-lt-emails", label: "Shopify LT email communication" },
];

const CORE_FIELD_LABELS: [string, string][] = [
  ["field_merchant_name", "Merchant name"],
  ["field_mid", "Merchant ID (MID)"],
  ["field_arr", "Revenue metric (ARR)"],
  ["field_platform", "Platform"],
  ["field_category", "Category"],
  ["field_integration_type", "Integration type"],
  ["field_sales_spoc", "Sales contact"],
  ["field_assigned_owner", "Owner"],
  ["field_contact_email", "Merchant contact email"],
  ["field_go_live_percent", "Go-live %"],
  ["field_pg_onboarding", "PG onboarding"],
  ["field_txns_per_day", "Transactions per day"],
  ["field_aov", "Average order value"],
  ["field_project_state", "Project state"],
  ["field_project_stage", "Project stage"],
  ["field_kick_off_date", "Kick-off date"],
  ["field_expected_go_live_date", "Expected go-live date"],
  ["field_actual_go_live_date", "Actual go-live date"],
  ["field_go_live_date", "Go-live date"],
];
const LINK_LABELS: [string, string][] = [
  ["field_brand_url", "Website link"],
  ["field_jira_link", "Jira link"],
  ["field_brd_link", "BRD link"],
  ["field_mint_checklist_link", "Internal checklist link"],
  ["field_integration_checklist_link", "Integration checklist link"],
  ["field_sow_link", "SOW link"],
];
const NOTE_LABELS: [string, string][] = [
  ["field_project_notes", "Project notes"],
  ["field_mint_notes", "Sales notes"],
  ["field_current_phase_comment", "Current phase comment"],
  ["field_phase2_comment", "Phase 2 comment"],
];
const CREDENTIAL_LABELS: [string, string][] = [
  ["field_sandbox_mid", "Sandbox MID"],
  ["field_sandbox_app_id", "Sandbox app ID"],
  ["field_sandbox_app_secret", "Sandbox app secret"],
  ["field_sandbox_base_url", "Sandbox base URL"],
  ["field_sandbox_config_id", "Sandbox config ID"],
  ["field_sandbox_kwikpass_jwe_key", "Sandbox KwikPass JWE key"],
  ["field_payment_simulator_link", "Payment simulator link"],
  ["field_prod_mid", "Production MID"],
  ["field_prod_app_id", "Production app ID"],
  ["field_prod_app_secret", "Production app secret"],
  ["field_prod_base_url", "Production base URL"],
  ["field_prod_config_id", "Production config ID"],
  ["field_prod_kwikpass_jwe_key", "Production KwikPass JWE key"],
  ["field_mcp_config_id", "MCP config ID"],
  ["field_mcp_enabled", "Enable MCP toggle"],
  ["field_kp_enabled", "Enable KP toggle"],
  ["field_kp_prod_jwe_key", "KP production JWE key"],
  ["field_kp_sandbox_jwe_key", "KP sandbox JWE key"],
];

const COLOR_LABELS: [string, string][] = [
  ["color_team_mint_badge", "Stage 1 team badge"],
  ["color_team_integration_badge", "Stage 2 team badge"],
  ["color_team_ms_badge", "Stage 3 team badge"],
  ["color_team_completed_badge", "Completed badge"],
  ["color_card_mint_bg", "Stage 1 card background"],
  ["color_card_integration_bg", "Stage 2 card background"],
  ["color_card_ms_bg", "Stage 3 card background"],
  ["color_card_completed_bg", "Completed card background"],
  ["color_state_not_started", "Not started badge"],
  ["color_state_on_hold", "On hold badge"],
  ["color_state_in_progress", "In progress badge"],
  ["color_state_live", "Live badge"],
  ["color_state_blocked", "Blocked badge"],
  ["color_kpi_total", "KPI: total"],
  ["color_kpi_pending", "KPI: pending"],
  ["color_kpi_active", "KPI: active"],
  ["color_kpi_live", "KPI: live"],
  ["color_team_perf_total", "Team performance: total"],
  ["color_team_perf_pending", "Team performance: pending"],
  ["color_team_perf_active", "Team performance: active"],
  ["color_team_perf_completed", "Team performance: completed"],
  ["color_time_internal", "Internal time"],
  ["color_time_external", "External time"],
];

export const SETTINGS: SettingDef[] = [
  text("org_name", "Organisation name", "branding", "admin"),
  text("app_title", "Dashboard title", "branding", "admin"),
  text("app_subtitle", "Dashboard subtitle", "branding", "admin"),
  { key: "org_logo_url", label: "Logo link", area: "branding", kind: "url", role: "admin", help: "An https link to an image" },

  ...CORE_FIELD_LABELS.map(([k, l]) => text(k, `${l} label`, "terminology")),
  text("state_not_started", "State: not started", "terminology"),
  text("state_on_hold", "State: on hold", "terminology"),
  text("state_in_progress", "State: in progress", "terminology"),
  text("state_live", "State: live", "terminology"),
  text("state_blocked", "State: blocked", "terminology"),
  text("phase_mint", "Phase: stage 1", "terminology"),
  text("phase_integration", "Phase: stage 2", "terminology"),
  text("phase_ms", "Phase: stage 3", "terminology"),
  text("phase_completed", "Phase: completed", "terminology"),
  text("responsibility_internal", "Your side of the work", "terminology"),
  text("responsibility_external", "The merchant's side", "terminology"),
  text("responsibility_neutral", "Neither side", "terminology"),
  ...LINK_LABELS.map(([k, l]) => text(k, `${l} label`, "terminology", "manager", { advanced: true })),
  ...NOTE_LABELS.map(([k, l]) => text(k, `${l} label`, "terminology", "manager", { advanced: true })),
  ...CREDENTIAL_LABELS.map(([k, l]) => text(k, `${l} label`, "terminology", "manager", { advanced: true })),

  { key: "email_monitor_address", label: "Handover email sender", area: "email_intake", kind: "email", role: "manager", help: "Emails from this address become projects" },
  { key: "email_subject_keywords", label: "Subject keywords", area: "email_intake", kind: "keywords", role: "manager", help: "Comma-separated" },

  { key: "slack_alerts_enabled", label: "Send the Slack digest", area: "alerts", kind: "bool", role: "manager" },
  { key: "slack_channel_email", label: "Slack channel email", area: "alerts", kind: "email", role: "manager" },
  text("slack_alert_tag", "Tag that marks a step as waiting on the merchant", "alerts"),
  { key: "slack_alert_hours", label: "Hours before an item is included", area: "alerts", kind: "number", role: "manager", min: 1, max: 720 },

  ...COLOR_LABELS.map(([k, l]): SettingDef => ({ key: k, label: `Colour: ${l}`, area: "look_and_buddy", kind: "color", role: "manager", advanced: true })),
  ...NAV_TABS.map(({ key, label }): SettingDef => ({ key: `nav:${key}`, label: `Show the ${label} tab`, area: "look_and_buddy", kind: "bool", role: "manager" })),
];

export const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Defaults that live outside DEFAULT_LABELS. */
const EXTRA_DEFAULTS: Record<string, string> = {
  org_logo_url: "",
  email_monitor_address: "",
  email_subject_keywords: "",
  slack_alerts_enabled: "false",
  slack_channel_email: "",
  slack_alert_tag: "#awaiting-merchant",
  slack_alert_hours: "24",
};

export const settingDefault = (key: string): string => {
  if (key.startsWith("nav:")) return "true";
  return DEFAULT_LABELS[key] ?? EXTRA_DEFAULTS[key] ?? "";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate and normalise a value for a setting, or return why it can't be saved. */
export function normaliseSetting(def: SettingDef, raw: unknown): { value: string } | { error: string } {
  const s = raw === null || raw === undefined ? "" : typeof raw === "boolean" ? String(raw) : String(raw).trim();
  switch (def.kind) {
    case "bool": {
      const v = s.toLowerCase();
      if (["true", "yes", "on", "1", "show"].includes(v)) return { value: "true" };
      if (["false", "no", "off", "0", "hide"].includes(v)) return { value: "false" };
      return { error: `${def.label} must be yes or no.` };
    }
    case "number": {
      const n = Number(s);
      if (s === "" || !Number.isFinite(n)) return { error: `${def.label} must be a number.` };
      if (def.min !== undefined && n < def.min) return { error: `${def.label} must be at least ${def.min}.` };
      if (def.max !== undefined && n > def.max) return { error: `${def.label} must be at most ${def.max}.` };
      return { value: String(Math.round(n)) };
    }
    case "color":
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) return { error: `${def.label} must be a hex colour like #255A87.` };
      return { value: s.toLowerCase() };
    case "email":
      if (s !== "" && !EMAIL_RE.test(s)) return { error: `${def.label} must be an email address.` };
      return { value: s.toLowerCase() };
    case "url":
      if (s !== "" && !/^https:\/\/\S+$/.test(s)) return { error: `${def.label} must be an https link.` };
      return { value: s };
    case "keywords":
      return { value: s.split(",").map((k) => k.trim()).filter(Boolean).join(", ") };
    default:
      if (s.length > 200) return { error: `${def.label} must be 200 characters or fewer.` };
      if (s === "") return { error: `${def.label} can't be empty. Say "reset" to go back to the default.` };
      return { value: s };
  }
}

// ── Integrations (tenant_integrations) ─────────────────────────────────────

export interface IntegrationDef {
  key: keyof TenantIntegrations;
  label: string;
  group: "Email sending" | "Gmail" | "Jira" | "Slack" | "Zoom" | "Microsoft Teams" | "Google Meet";
  area: AreaId;
  kind: "text" | "email" | "url";
}

export const INTEGRATIONS: IntegrationDef[] = [
  { key: "resend_api_key", label: "Resend API key", group: "Email sending", area: "email_sending", kind: "text" },
  { key: "from_email", label: "From address", group: "Email sending", area: "email_sending", kind: "email" },
  { key: "from_name", label: "From name", group: "Email sending", area: "email_sending", kind: "text" },
  { key: "reply_to", label: "Reply-to", group: "Email sending", area: "email_sending", kind: "email" },
  { key: "app_base_url", label: "App link used in emails", group: "Email sending", area: "email_sending", kind: "url" },
  { key: "google_mail_api_key", label: "Gmail connector key", group: "Gmail", area: "email_intake", kind: "text" },
  { key: "gmail_monitor_address", label: "Mailbox to watch", group: "Gmail", area: "email_intake", kind: "email" },
  { key: "jira_base_url", label: "Jira site URL", group: "Jira", area: "integrations", kind: "url" },
  { key: "jira_email", label: "Jira account email", group: "Jira", area: "integrations", kind: "email" },
  { key: "jira_api_token", label: "Jira API token", group: "Jira", area: "integrations", kind: "text" },
  { key: "jira_project_key", label: "Jira default project key", group: "Jira", area: "integrations", kind: "text" },
  { key: "slack_webhook_url", label: "Slack incoming webhook URL", group: "Slack", area: "integrations", kind: "url" },
  { key: "slack_bot_token", label: "Slack bot token", group: "Slack", area: "integrations", kind: "text" },
  { key: "slack_channel", label: "Slack default channel", group: "Slack", area: "integrations", kind: "text" },
  { key: "zoom_account_id", label: "Zoom account ID", group: "Zoom", area: "integrations", kind: "text" },
  { key: "zoom_client_id", label: "Zoom client ID", group: "Zoom", area: "integrations", kind: "text" },
  { key: "zoom_client_secret", label: "Zoom client secret", group: "Zoom", area: "integrations", kind: "text" },
  { key: "zoom_webhook_secret", label: "Zoom webhook secret token", group: "Zoom", area: "integrations", kind: "text" },
  { key: "zoom_user_id", label: "Zoom host email or user ID", group: "Zoom", area: "integrations", kind: "text" },
  { key: "teams_tenant_id", label: "Microsoft tenant ID", group: "Microsoft Teams", area: "integrations", kind: "text" },
  { key: "teams_client_id", label: "Microsoft client ID", group: "Microsoft Teams", area: "integrations", kind: "text" },
  { key: "teams_client_secret", label: "Microsoft client secret", group: "Microsoft Teams", area: "integrations", kind: "text" },
  { key: "teams_organizer_user_id", label: "Teams organiser user ID", group: "Microsoft Teams", area: "integrations", kind: "text" },
  { key: "google_oauth_client_id", label: "Google OAuth client ID", group: "Google Meet", area: "integrations", kind: "text" },
  { key: "google_oauth_client_secret", label: "Google OAuth client secret", group: "Google Meet", area: "integrations", kind: "text" },
  { key: "google_meet_refresh_token", label: "Google Meet refresh token", group: "Google Meet", area: "integrations", kind: "text" },
  { key: "google_calendar_refresh_token", label: "Google Calendar refresh token", group: "Google Meet", area: "integrations", kind: "text" },
];

export const INTEGRATION_BY_KEY = new Map(INTEGRATIONS.map((i) => [i.key as string, i]));
export const isSecretIntegration = (key: string) => (SECRET_FIELDS as string[]).includes(key);

// Every stored integration column is described above; keep it that way.
for (const field of INTEGRATION_FIELDS) {
  if (!INTEGRATION_BY_KEY.has(field)) console.warn(`setup-catalog: integration field ${field} has no description`);
}

/** Show a secret without revealing it. */
export const maskSecret = (v: string | null | undefined) => (v ? `•••• ${v.slice(-4)}` : "Not set");

// ── Roles ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(["admin", "super_admin", "superadmin"]);
const MANAGER_ROLES = new Set(["manager", "admin", "super_admin", "superadmin"]);

export const hasRole = (roles: string[], needed: Role) =>
  roles.some((r) => (needed === "admin" ? ADMIN_ROLES : MANAGER_ROLES).has(r));
