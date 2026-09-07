/**
 * The single source of truth mapping dashboard tabs to URLs.
 *
 * Nav keys are deliberately unchanged from the values stored in `nav_visibility`
 * (tenant-scoped, Supabase) and `manager_tab_order` (localStorage), and paths are
 * derived from the key — never from a tab's order or visibility — so reordering
 * or hiding a tab can never change a URL.
 */

export type ProjectView = "kanban" | "list" | "golive";

export const REPORT_SUB_TABS = [
  "predefined",
  "builder",
  "scheduler",
  "pivot-table",
  "sandbox",
  "portal-visits",
  "daily-report",
  "weekly-report",
] as const;

export const PREDEFINED_REPORT_TYPES = [
  "executive",
  "operational",
  "merchant",
  "tactical",
  "weeks_checklist",
  "tat",
  "project",
  "team",
] as const;

export const SETTINGS_SUB_TABS = [
  "general",
  "fields",
  "custom-fields",
  "checklist-forms",
  "checklist",
  "users",
  "colours",
  "email",
  "workflows",
  "pivot-table",
  "funnel",
  "activity-log",
  "slack-alerts",
  "integrations",
  "navigation",
] as const;

export const DEFAULT_REPORT_SUB_TAB = "predefined";
export const DEFAULT_REPORT_TYPE = "executive";
export const DEFAULT_SETTINGS_SUB_TAB = "general";
export const DEFAULT_PROJECT_VIEW: ProjectView = "kanban";

/** Simple tabs whose whole path is one segment. */
const SIMPLE_TAB_PATHS: Record<string, string> = {
  dashboard: "/dashboard",
  risks: "/risks",
  emails: "/emails",
  platforms: "/platforms",
  golive: "/go-live",
  "shopify-sme": "/shopify-sme",
  "shopify-lt-emails": "/shopify-lt-emails",
  tenants: "/tenants",
  archived: "/archived",
};

const PROJECT_VIEW_SEGMENTS: Record<ProjectView, string> = {
  kanban: "kanban",
  list: "list",
  golive: "go-live",
};

const SEGMENT_TO_PROJECT_VIEW: Record<string, ProjectView> = {
  kanban: "kanban",
  list: "list",
  "go-live": "golive",
};

/**
 * Tab keys that were once their own nav entries but are now project views or
 * settings sub-tabs. Still present in saved `manager_tab_order` values.
 */
export const LEGACY_TAB_ALIASES: Record<string, string | null> = {
  listview: "projects",
  kanban: "projects",
  calendar: "projects",
  checklist: null,
  users: null,
  overview: "dashboard",
};

export interface DashboardLocation {
  tab: string;
  projectView: ProjectView;
  reportSubTab: string;
  reportType: string;
  settingsSubTab: string;
}

export interface PathOptions {
  projectView?: ProjectView;
  reportSubTab?: string;
  reportType?: string;
  settingsSubTab?: string;
}

export const projectViewPath = (view: ProjectView): string =>
  `/projects/${PROJECT_VIEW_SEGMENTS[view]}`;

export const pathForTab = (tab: string, opts: PathOptions = {}): string => {
  if (tab === "projects") return projectViewPath(opts.projectView || DEFAULT_PROJECT_VIEW);

  if (tab === "reports") {
    const sub = opts.reportSubTab || DEFAULT_REPORT_SUB_TAB;
    if (sub === "predefined") return `/reports/predefined/${opts.reportType || DEFAULT_REPORT_TYPE}`;
    return `/reports/${sub}`;
  }

  if (tab === "settings") return `/settings/${opts.settingsSubTab || DEFAULT_SETTINGS_SUB_TAB}`;

  return SIMPLE_TAB_PATHS[tab] || SIMPLE_TAB_PATHS["dashboard"]!;
};

const EMPTY: DashboardLocation = {
  tab: "",
  projectView: DEFAULT_PROJECT_VIEW,
  reportSubTab: DEFAULT_REPORT_SUB_TAB,
  reportType: DEFAULT_REPORT_TYPE,
  settingsSubTab: DEFAULT_SETTINGS_SUB_TAB,
};

/** `tab: ""` means "not a dashboard path" — the caller resolves a default. */
export const parseDashboardPath = (pathname: string): DashboardLocation => {
  const [first, second, third] = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (!first) return EMPTY;

  if (first === "projects") {
    const view = second ? SEGMENT_TO_PROJECT_VIEW[second] : undefined;
    if (!view) return EMPTY;
    return { ...EMPTY, tab: "projects", projectView: view };
  }

  if (first === "reports") {
    const sub = (REPORT_SUB_TABS as readonly string[]).includes(second || "")
      ? second!
      : DEFAULT_REPORT_SUB_TAB;
    const type = (PREDEFINED_REPORT_TYPES as readonly string[]).includes(third || "")
      ? third!
      : DEFAULT_REPORT_TYPE;
    return { ...EMPTY, tab: "reports", reportSubTab: sub, reportType: type };
  }

  if (first === "settings") {
    const sub = (SETTINGS_SUB_TABS as readonly string[]).includes(second || "")
      ? second!
      : DEFAULT_SETTINGS_SUB_TAB;
    return { ...EMPTY, tab: "settings", settingsSubTab: sub };
  }

  const tab = Object.keys(SIMPLE_TAB_PATHS).find((key) => SIMPLE_TAB_PATHS[key] === `/${first}`);
  return tab ? { ...EMPTY, tab } : EMPTY;
};

/**
 * Saved tab orders predate the aliases being folded into other tabs. Map them in
 * place rather than dropping them, so a user whose first visible entry was
 * `listview` still lands on the same screen.
 */
export const normalizeTabOrder = (order: string[]): string[] => {
  const out: string[] = [];
  for (const raw of order) {
    const mapped = raw in LEGACY_TAB_ALIASES ? LEGACY_TAB_ALIASES[raw] : raw;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
};
