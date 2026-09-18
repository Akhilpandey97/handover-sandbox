import { DEFAULT_LABELS } from "@/data/defaultLabels";
import { DEFAULT_RISK_RULES } from "@/data/riskRules";
import { DEFAULT_EGL_RULES } from "@/data/eglRisk";

/**
 * The onboarding workbook: one tab per setup area, laid out the way Buddy reads
 * it back. Fill it in and attach it to Buddy.
 *
 * Conventions Buddy and the attachment reader rely on:
 *   - "Read me" is instructions only and is never sent.
 *   - Rows whose first cell starts with "e.g." are examples and are ignored.
 *   - A row with nothing filled in after its first cell means "keep as is".
 */

export const ONBOARDING_TEMPLATE_URL = "/api/public/onboarding-template";
export const ONBOARDING_TEMPLATE_FILENAME = "handover-onboarding-sheet.xlsx";
export const README_SHEET = "Read me";
export const EXAMPLE_PREFIX = "e.g.";

/**
 * For tabs whose rows come pre-labelled, the columns a person types into. A row
 * is only sent to Buddy when one of these has a value.
 */
export const INPUT_COLUMNS: Record<string, number[]> = {
  branding: [1],
  teams: [1, 2],
  terminology: [1],
  "email intake": [1],
  integrations: [2],
  alerts: [1],
  navigation: [1],
  buddy: [1],
  "risk rules": [1, 2, 3, 4],
};

/** Should this row reach Buddy? Drops examples, hints and rows left as they came. */
export function isFilledRow(sheetName: string, row: string[]): boolean {
  if (!row[0] || row[0].toLowerCase().startsWith(EXAMPLE_PREFIX)) return false;
  const inputs = INPUT_COLUMNS[sheetName.trim().toLowerCase()];
  if (inputs) return inputs.some((i) => Boolean(row[i]));
  return row.length === 1 || row.slice(1).some(Boolean);
}

export interface TemplateSheet {
  name: string;
  /** Column widths in characters. */
  widths: number[];
  rows: string[][];
}

const eg = (first: string) => `${EXAMPLE_PREFIX} ${first}`;
const yesNo = (v: boolean) => (v ? "Yes" : "No");

export function onboardingTemplate(): TemplateSheet[] {
  const label = (key: string) => DEFAULT_LABELS[key] || key;

  return [
    {
      name: README_SHEET,
      widths: [110],
      rows: [
        ["Handover onboarding sheet"],
        [""],
        ["How to use it"],
        ["1. Fill in the tabs you want to set up. Leave any tab or row blank to keep what's there."],
        ["2. Rows starting with \"e.g.\" are examples. Leave them, delete them, or overwrite them; Buddy ignores them."],
        ["3. In Buddy, click the paperclip, attach this file and send. Buddy shows an approval card for each area before changing anything."],
        ["4. Managers can set up Teams, Terminology, Checklist steps, Forms, Custom fields, Project stages, Risk rules, Automations, Email intake, Alerts and Navigation."],
        ["   Workspace admins can also set Branding, People, Integrations and Buddy."],
        [""],
        ["Tips"],
        ["- Teams: the stage 1, 2 and 3 teams receive handoffs in that order. Extra teams own checklist steps but don't receive handoffs."],
        ["- Checklist steps: \"Days after kick-off\" sets each step's due date on every project. Leave it blank for no due date."],
        ["- Project stages come after checklist steps, because stage rules use step names."],
        ["- Colours are hex codes like #255A87. Yes/No columns accept Yes or No."],
        ["- Integrations: keys and secrets are hidden after approval. If you'd rather not put them in a file, leave them blank and paste them in Settings → Integrations."],
        ["- People without a password get an email to set their own; email sending must be set up first (Integrations tab)."],
      ],
    },
    {
      name: "Branding",
      widths: [28, 50, 60],
      rows: [
        ["Setting", "Value", "What it's for"],
        ["Organisation name", "", "Shown in emails, the merchant portal and Buddy's answers"],
        ["Dashboard title", "", `Currently "${label("app_title")}"`],
        ["Dashboard subtitle", "", `Currently "${label("app_subtitle")}"`],
        ["Logo link", "", "An https link to your logo image"],
      ],
    },
    {
      name: "Teams",
      widths: [12, 28, 16],
      rows: [
        ["Stage", "Team name", "Colour"],
        ["Stage 1", "", ""],
        ["Stage 2", "", ""],
        ["Stage 3", "", ""],
        [eg("Extra"), "QA", "#64748b"],
      ],
    },
    {
      name: "People",
      widths: [26, 34, 26, 22],
      rows: [
        ["Name", "Email", "Role", "Password (optional)"],
        [eg("Priya Shah"), "priya@yourcompany.com", "Manager", ""],
        [eg("Arjun Rao"), "arjun@yourcompany.com", "Stage 1 team", ""],
        [eg("Meera Iyer"), "meera@yourcompany.com", "Admin", ""],
      ],
    },
    {
      name: "Terminology",
      widths: [30, 30],
      rows: [
        ["Default name", "Your name"],
        ...[
          "field_merchant_name", "field_merchant_name_plural", "field_mid", "field_arr", "field_platform", "field_category", "field_integration_type",
          "field_sales_spoc", "field_assigned_owner", "field_contact_email", "field_go_live_percent", "field_pg_onboarding",
          "field_kick_off_date", "field_expected_go_live_date", "field_actual_go_live_date",
        ].map((k) => [label(k), ""]),
        ...["state_not_started", "state_on_hold", "state_in_progress", "state_live", "state_blocked"].map((k) => [`State: ${label(k)}`, ""]),
        ...["phase_mint", "phase_integration", "phase_ms", "phase_completed"].map((k) => [`Phase: ${label(k)}`, ""]),
        [`Your side of the work: ${label("responsibility_internal")}`, ""],
        [`The merchant's side: ${label("responsibility_external")}`, ""],
        [`Neither side: ${label("responsibility_neutral")}`, ""],
      ],
    },
    {
      name: "Checklist steps",
      widths: [18, 40, 20, 12],
      rows: [
        ["Team", "Step", "Days after kick-off", "Position"],
        [eg("Stage 1"), "Kick-off call", "2", "1"],
        [eg("Stage 1"), "Commercials signed", "5", ""],
        [eg("Stage 2"), "Sandbox testing", "14", ""],
        [eg("Stage 3"), "Go-live review", "30", ""],
      ],
    },
    {
      name: "Forms",
      widths: [22, 18, 44, 14, 30, 10, 26],
      rows: [
        ["Form", "Section", "Question", "Answer type", "Options (comma-separated)", "Required", "Show on step"],
        [eg("BRD"), "Business", "Monthly order volume", "number", "", "Yes", "Kick-off call"],
        [eg("BRD"), "Technical", "Platform", "select", "Shopify, WooCommerce, Custom", "Yes", "Kick-off call"],
        [eg("BRD"), "Technical", "Anything we should know?", "textarea", "", "No", ""],
        ["", "", "Answer types: text, textarea, number, date, url, boolean, select", "", "", "", ""],
      ],
    },
    {
      name: "Custom fields",
      widths: [28, 14, 44],
      rows: [
        ["Label", "Type", "Options (for dropdowns, comma-separated)"],
        [eg("Region"), "select", "North, South, East, West"],
        [eg("Contract end date"), "date", ""],
        ["", "Types: text, number, date, url, boolean, select", ""],
      ],
    },
    {
      name: "Project stages",
      widths: [8, 24, 22, 60],
      rows: [
        ["Order", "Stage", "Rule", "States or steps (comma-separated)"],
        [eg("1"), "Live", "State is", "Live"],
        [eg("2"), "Integration", "All steps done", "Kick-off call, Commercials signed"],
        [eg("3"), "Sales", "No steps done", "Kick-off call"],
        ["", "Rules: State is, All steps done, Any step done, No steps done. The first matching stage wins.", "", ""],
      ],
    },
    {
      name: "Risk rules",
      widths: [44, 8, 8, 12, 24, 40],
      rows: [
        ["Rule", "On (Yes/No)", "Days", "Severity", "States", "Default (leave the row blank to keep the current setting)"],
        ...DEFAULT_RISK_RULES.map((r) => [
          r.label,
          "",
          "",
          "",
          "",
          [yesNo(r.enabled), r.days !== undefined ? `${r.days} days` : "", r.severity, (r.states || []).join(", ")].filter(Boolean).join(" · "),
        ]),
        ...DEFAULT_EGL_RULES.map((r) => [
          `Go-live signal: ${r.label}`,
          "",
          "",
          "",
          "",
          [yesNo(r.enabled), r.id === "stalled" ? `${r.days ?? 5} days` : "", r.id === "state" ? (r.states || []).join(", ") : ""].filter(Boolean).join(" · "),
        ]),
        ["", "Severity: low, medium, high, critical. Days apply to date and activity rules; States apply to state rules.", "", "", "", ""],
      ],
    },
    {
      name: "Automations",
      widths: [30, 34, 30, 30, 40],
      rows: [
        ["Name", "When", "Condition", "Then", "Details"],
        [eg("Blocked for 3 days"), "Project in a state for N days", "Blocked, 3 days", "Notify", "Managers: \"Blocked for 3 days, needs a plan\""],
        [eg("New Shopify projects"), "Project created", "", "Assign owner", "priya@yourcompany.com"],
        [eg("Sandbox done"), "Checklist step completed", "Sandbox testing", "Notify", "Owner: \"Sandbox passed, book production testing\""],
        ["", "When: Project created, State changed, Transferred, Checklist step completed, Go-live date passed, Field changes, Project in a state for N days, Manual", "", "Then: Assign owner, Set field, Transfer, Notify", ""],
      ],
    },
    {
      name: "Email intake",
      widths: [34, 40, 50],
      rows: [
        ["Setting", "Value", "What it's for"],
        ["Handover email sender", "", "Emails from this address become projects"],
        ["Subject keywords", "", "Comma-separated"],
        ["Mailbox to watch", "", "Admins: the Gmail inbox Handover reads"],
      ],
    },
    {
      name: "Integrations",
      widths: [18, 34, 44],
      rows: [
        ["Integration", "Setting", "Value"],
        ["Email sending", "Resend API key", ""],
        ["Email sending", "From address", ""],
        ["Email sending", "From name", ""],
        ["Email sending", "Reply-to", ""],
        ["Email sending", "App link used in emails", ""],
        ["Gmail", "Gmail connector key", ""],
        ["Jira", "Jira site URL", ""],
        ["Jira", "Jira account email", ""],
        ["Jira", "Jira API token", ""],
        ["Jira", "Jira default project key", ""],
        ["Slack", "Slack incoming webhook URL", ""],
        ["Slack", "Slack bot token", ""],
        ["Slack", "Slack default channel", ""],
        ["Zoom", "Zoom account ID", ""],
        ["Zoom", "Zoom client ID", ""],
        ["Zoom", "Zoom client secret", ""],
        ["Zoom", "Zoom webhook secret token", ""],
        ["Zoom", "Zoom host email or user ID", ""],
        ["Microsoft Teams", "Microsoft tenant ID", ""],
        ["Microsoft Teams", "Microsoft client ID", ""],
        ["Microsoft Teams", "Microsoft client secret", ""],
        ["Microsoft Teams", "Teams organiser user ID", ""],
        ["Google Meet", "Google OAuth client ID", ""],
        ["Google Meet", "Google OAuth client secret", ""],
        ["Google Meet", "Google Meet refresh token", ""],
        ["Google Meet", "Google Calendar refresh token", ""],
      ],
    },
    {
      name: "Alerts",
      widths: [44, 30],
      rows: [
        ["Setting", "Value"],
        ["Send the daily Slack digest (Yes/No)", ""],
        ["Slack channel email", ""],
        ["Tag that marks a step as waiting on the merchant", ""],
        ["Hours before an item is included", ""],
      ],
    },
    {
      name: "Navigation",
      widths: [34, 10],
      rows: [
        ["Tab", "Show"],
        ...["Dashboard", "Projects", "Risks", "Reports", "Settings", "Emails", "Archived", "Platforms", "Go-Live Tracker", "Shopify SME and Ent", "Shopify LT email communication"].map((t) => [t, ""]),
      ],
    },
    {
      name: "Buddy",
      widths: [48, 60],
      rows: [
        ["Setting", "Value"],
        ["Show the daily brief (Yes/No)", ""],
        ["Largest bulk change without typing the count", ""],
        ["Instructions for Buddy (tone, terms, house rules)", ""],
      ],
    },
  ];
}
