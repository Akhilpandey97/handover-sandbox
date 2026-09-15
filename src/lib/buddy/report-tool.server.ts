import {
  type BuddyCaller,
  PHASE_LABELS,
  RESPONSIBILITY_LABELS,
  STATE_LABELS,
  todayIso,
} from "@/lib/buddy/scope.server";
import type { BuddySource, ReadToolResult } from "@/lib/buddy/read-tools.server";

/**
 * Reports built from a question: a table and chart the person can see,
 * download and, for project lists, save to Reports.
 *
 * Column keys match the Reports builder, so a saved Buddy report opens there
 * with the same columns.
 */

export interface BuddyReport {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  chart?: { type: "bar" | "line"; x: string; y: string[] };
  /** Reports-builder column keys, when the report can be saved to Reports. */
  saveColumns?: string[];
  total: number;
}

const COLUMNS: Record<string, { label: string; field: string; numeric?: boolean }> = {
  merchantName: { label: "Merchant", field: "merchant_name" },
  mid: { label: "MID", field: "mid" },
  platform: { label: "Platform", field: "platform" },
  category: { label: "Category", field: "category" },
  arr: { label: "ARR (₹ Cr)", field: "arr", numeric: true },
  projectState: { label: "State", field: "project_state" },
  currentOwnerTeam: { label: "Team", field: "current_owner_team" },
  assignedOwnerName: { label: "Owner", field: "assigned_owner" },
  currentResponsibility: { label: "Waiting on", field: "current_responsibility" },
  goLivePercent: { label: "Go-live %", field: "go_live_percent", numeric: true },
  kickOffDate: { label: "Kick-off", field: "kick_off_date" },
  expectedGoLiveDate: { label: "Expected go-live", field: "expected_go_live_date" },
  goLiveDate: { label: "Went live", field: "go_live_date" },
  salesSpoc: { label: "Sales SPOC", field: "sales_spoc" },
  integrationType: { label: "Integration type", field: "integration_type" },
  checklistProgress: { label: "Checklist", field: "id" },
};

const TEAM_LABELS: Record<string, string> = { mint: "Sales", integration: "Integration", ms: "Merchant Success" };

export const REPORT_TOOL_DEF = {
  type: "function",
  function: {
    name: "build_report",
    description:
      "Build a table and chart the user can see, download and save. Use when the user asks for a report, a chart, a breakdown or trend, or a list they want to keep. kind=breakdown counts projects (and ARR) by one dimension; kind=projects lists projects with the chosen columns. Then summarise the key takeaway in one or two sentences; don't repeat the table.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["breakdown", "projects"] },
        group_by: { type: "string", enum: ["go_live_month", "state", "phase", "owner", "platform", "responsibility"] },
        columns: { type: "array", items: { type: "string", enum: Object.keys(COLUMNS) } },
        state: { type: "string", enum: ["not_started", "on_hold", "in_progress", "live", "blocked"] },
        phase: { type: "string", enum: ["mint", "integration", "ms", "completed"] },
        platform: { type: "string" },
        owner_id: { type: "string" },
        go_live_from: { type: "string", description: "YYYY-MM-DD" },
        go_live_to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["title", "kind"],
    },
  },
} as const;

const shortMonth = (ym: string) => {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

export async function runReportTool(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult & { report?: BuddyReport }> {
  try {
    const needed = new Set(["id", "merchant_name", "project_state", "current_phase", "current_owner_team", "assigned_owner", "platform", "expected_go_live_date", "current_responsibility", "arr"]);
    for (const k of args.columns || []) if (COLUMNS[k]) needed.add(COLUMNS[k]!.field);

    let q = caller.client.from("projects").select(Array.from(needed).join(", ")).eq("tenant_id", caller.tenantId).eq("archived", false);
    if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);
    if (args.state) q = q.eq("project_state", args.state);
    if (args.phase) q = q.eq("current_phase", args.phase);
    if (args.platform) q = q.ilike("platform", String(args.platform));
    if (args.owner_id) q = q.eq("assigned_owner", args.owner_id);
    if (args.go_live_from) q = q.gte("expected_go_live_date", args.go_live_from);
    if (args.go_live_to) q = q.lte("expected_go_live_date", args.go_live_to);
    const { data, error } = await q.order("expected_go_live_date", { ascending: true, nullsFirst: false }).limit(2000);
    if (error) throw error;
    const projects = (data || []) as any[];

    const ownerIds = Array.from(new Set(projects.map((p) => p.assigned_owner).filter(Boolean)));
    const { data: owners } = ownerIds.length
      ? await caller.client.from("profiles").select("id, name").eq("tenant_id", caller.tenantId).in("id", ownerIds)
      : { data: [] as any[] };
    const ownerName = new Map(((owners || []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));

    const title = String(args.title || "Report");
    const filterBits = [
      args.state && STATE_LABELS[args.state],
      args.phase && PHASE_LABELS[args.phase],
      args.platform,
      args.go_live_from && `go-live from ${args.go_live_from}`,
      args.go_live_to && `to ${args.go_live_to}`,
    ].filter(Boolean);
    const subtitle = `${projects.length} project${projects.length === 1 ? "" : "s"}${filterBits.length ? ` · ${filterBits.join(" · ")}` : ""} · as of ${todayIso()}`;
    const sources: BuddySource[] = [{ kind: "data", label: `${projects.length} projects` }];

    if (args.kind === "breakdown") {
      const groupBy = String(args.group_by || "state");
      const keyOf = (p: any) => {
        switch (groupBy) {
          case "go_live_month": return p.expected_go_live_date ? String(p.expected_go_live_date).slice(0, 7) : "No date";
          case "phase": return PHASE_LABELS[p.current_phase] || p.current_phase || "None";
          case "owner": return ownerName.get(p.assigned_owner) || "Unassigned";
          case "platform": return p.platform || "Unknown";
          case "responsibility": return RESPONSIBILITY_LABELS[p.current_responsibility] || "Unknown";
          default: return STATE_LABELS[p.project_state] || p.project_state || "None";
        }
      };
      const groups = new Map<string, { projects: number; arr: number }>();
      for (const p of projects) {
        const k = keyOf(p);
        const g = groups.get(k) || { projects: 0, arr: 0 };
        g.projects++;
        g.arr += Number(p.arr) || 0;
        groups.set(k, g);
      }
      let entries = Array.from(groups.entries());
      entries = groupBy === "go_live_month" ? entries.sort((a, b) => a[0].localeCompare(b[0])) : entries.sort((a, b) => b[1].projects - a[1].projects);
      const rows = entries.map(([k, v]) => ({
        group: groupBy === "go_live_month" && k !== "No date" ? shortMonth(k) : k,
        projects: v.projects,
        arr: Math.round(v.arr * 100) / 100,
      }));
      const report: BuddyReport = {
        title,
        subtitle,
        columns: [
          { key: "group", label: groupBy.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) },
          { key: "projects", label: "Projects", numeric: true },
          { key: "arr", label: "ARR (₹ Cr)", numeric: true },
        ],
        rows,
        chart: { type: groupBy === "go_live_month" ? "line" : "bar", x: "group", y: ["projects"] },
        total: projects.length,
      };
      return { step: `Built "${title}"`, data: { shown_to_user: true, total_projects: projects.length, rows }, sources, report };
    }

    // Project list
    const columns = (Array.isArray(args.columns) && args.columns.length ? args.columns : ["merchantName", "projectState", "assignedOwnerName", "expectedGoLiveDate", "checklistProgress"])
      .map(String)
      .filter((k: string) => COLUMNS[k])
      .slice(0, 8);
    if (!columns.includes("merchantName")) columns.unshift("merchantName");

    const progress = new Map<string, string>();
    if (columns.includes("checklistProgress") && projects.length) {
      const ids = projects.slice(0, 500).map((p) => p.id);
      const counts = new Map<string, { done: number; total: number }>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: items } = await caller.client
          .from("checklist_items")
          .select("project_id, completed")
          .eq("tenant_id", caller.tenantId)
          .in("project_id", ids)
          .range(from, from + PAGE - 1);
        for (const i of (items || []) as any[]) {
          const c = counts.get(i.project_id) || { done: 0, total: 0 };
          c.total++;
          if (i.completed) c.done++;
          counts.set(i.project_id, c);
        }
        if (!items || items.length < PAGE) break;
      }
      for (const [id, c] of counts) progress.set(id, `${c.done}/${c.total}`);
    }

    const cell = (p: any, key: string): string | number | null => {
      const v = p[COLUMNS[key]!.field];
      switch (key) {
        case "projectState": return STATE_LABELS[v] || v || null;
        case "currentOwnerTeam": return TEAM_LABELS[v] || v || null;
        case "assignedOwnerName": return ownerName.get(v) || "Unassigned";
        case "currentResponsibility": return RESPONSIBILITY_LABELS[v] || v || null;
        case "checklistProgress": return progress.get(p.id) || "0/0";
        case "arr":
        case "goLivePercent": return v === null || v === undefined ? null : Number(v);
        default: return v ?? null;
      }
    };
    const rows = projects.slice(0, 500).map((p) => {
      const r: Record<string, string | number | null> = { _id: p.id };
      for (const k of columns) r[k] = cell(p, k);
      return r;
    });

    const report: BuddyReport = {
      title,
      subtitle,
      columns: columns.map((k: string) => ({ key: k, label: COLUMNS[k]!.label, numeric: COLUMNS[k]!.numeric })),
      rows,
      saveColumns: columns,
      total: projects.length,
    };
    return {
      step: `Built "${title}"`,
      data: { shown_to_user: true, total_projects: projects.length, first_rows: rows.slice(0, 25) },
      sources: [...sources, ...projects.slice(0, 6).map((p) => ({ kind: "project" as const, id: p.id, label: p.merchant_name }))],
      report,
    };
  } catch (err) {
    return { step: "Couldn't build the report", data: { error: (err as Error).message }, sources: [] };
  }
}
