export interface BuddySource {
  kind: "project" | "data";
  id?: string;
  label: string;
}

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
  requiresTypedConfirm?: boolean;
  undoable: boolean;
  email?: { to: string[]; cc?: string[]; subject: string; body: string };
}

export type ActionStatus = "previewing" | "pending" | "executing" | "done" | "failed" | "cancelled" | "undone";

export interface ActionResult {
  message: string;
  link?: { label: string; href: string };
  logId?: string;
  undoable?: boolean;
  undoUntil?: string;
}

export interface BuddyAction {
  callId: string;
  name: string;
  arguments: Record<string, any>;
  status: ActionStatus;
  preview?: ActionPreview;
  error?: string;
  result?: ActionResult;
}

export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "donut" | "stacked" | "grouped" | "multiline" | "table";

/** Headline numbers, a chart and its table, built by Buddy from a question. */
export interface BuddyReport {
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  chart?: { type: ChartType; x: string; series: { key: string; label: string }[]; valueLabel: string };
  /** Chart forms that fit this data, offered in the switcher. */
  charts?: ChartType[];
  /** Reports-builder column keys, when it can be saved to Reports. */
  saveColumns?: string[];
  total: number;
}

export interface BuddyMessage {
  id: string;
  dbId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  steps?: string[];
  sources?: BuddySource[];
  reports?: BuddyReport[];
  actions?: BuddyAction[];
  error?: string;
  stopped?: boolean;
  feedback?: "up" | "down";
  streaming?: boolean;
}

export interface BuddyPage {
  path: string;
  projectId?: string | null;
}

export interface Mention {
  kind: "project" | "person" | "item";
  id: string;
  name: string;
  sub?: string;
}

export interface Thread {
  id: string | null;
  title: string;
  at: string;
}

export const ACTION_ROLES = new Set(["manager", "admin", "super_admin", "superadmin"]);
export const PORTFOLIO_ROLES = new Set(["manager", "admin", "super_admin", "superadmin", "gokwik_general"]);

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
