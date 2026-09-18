import { buddyLabels } from "@/lib/buddy/labels.server";
import {
  type BuddyCaller,
  PHASE_LABELS,
  RESPONSIBILITY_LABELS,
  STATE_LABELS,
  todayIso,
} from "@/lib/buddy/scope.server";
import type { BuddySource, ReadToolResult } from "@/lib/buddy/read-tools.server";

/**
 * Reports built from a question: headline numbers, a chart, and the table
 * behind it, with download and (for project lists) save to Reports.
 *
 * The chart form follows the data's job: trends over months are lines or
 * areas; comparing categories is a column or bar chart; share of a whole with
 * few groups can be a pie or donut; a second dimension becomes stacked or
 * grouped columns or several lines. Categories that are ordered in the product
 * (states, phases) keep that order everywhere, so a colour always means the
 * same thing. Column keys for project lists match the Reports builder.
 */

export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "donut" | "stacked" | "grouped" | "multiline" | "table";

export interface BuddyReport {
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  chart?: { type: ChartType; x: string; series: { key: string; label: string }[]; valueLabel: string };
  /** Chart forms that fit this data, for the switcher. */
  charts?: ChartType[];
  saveColumns?: string[];
  total: number;
}

const COLUMNS: Record<string, { label: string; field: string; numeric?: boolean }> = {
  merchantName: { label: "Merchant", field: "merchant_name" }, // relabelled per workspace in runReportTool
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

type Dimension = "go_live_month" | "kick_off_month" | "state" | "phase" | "owner" | "platform" | "responsibility" | "category";

const DIMENSION_LABELS: Record<Dimension, string> = {
  go_live_month: "Expected go-live month",
  kick_off_month: "Kick-off month",
  state: "State",
  phase: "Phase",
  owner: "Owner",
  platform: "Platform",
  responsibility: "Waiting on",
  category: "Category",
};

/** Categories with a fixed order in the product keep it, so their colours stay put across charts. */
const FIXED_ORDER: Partial<Record<Dimension, string[]>> = {
  state: ["Not started", "In progress", "On hold", "Blocked", "Live"],
  phase: ["Sales", "Integration", "Merchant Success", "Completed"],
  responsibility: ["Internal team", "Merchant", "Neutral"],
};

const TIME_DIMENSIONS = new Set<Dimension>(["go_live_month", "kick_off_month"]);
const LONG_LABEL_DIMENSIONS = new Set<Dimension>(["owner", "platform", "category"]);
const MAX_SERIES = 8; // categorical token ceiling: past it, fold into "Other"



export const REPORT_TOOL_DEF = {
  type: "function",
  function: {
    name: "build_report",
    description:
      "Build headline numbers, a chart and the table behind it, shown in the chat with a chart switcher, CSV download and save. Use for any report, chart, breakdown, trend or list the user wants to keep. kind=breakdown counts projects (or sums ARR) by group_by, optionally split by a second dimension; kind=projects lists projects with chosen columns. Pick chart by the job: line or area for a trend over months; column to compare a few categories; bar for many or long-named categories (owners, platforms); pie or donut for share of a whole with 6 or fewer groups; stacked or grouped columns, or multiline for months, when split_by is set. Reply with the one or two key takeaways only; don't repeat the table.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["breakdown", "projects"] },
        group_by: { type: "string", enum: ["go_live_month", "kick_off_month", "state", "phase", "owner", "platform", "responsibility", "category"] },
        split_by: { type: "string", enum: ["state", "phase", "owner", "platform", "responsibility", "category"], description: "Second dimension for stacked, grouped or multi-line charts" },
        metric: { type: "string", enum: ["count", "arr"], description: "Count projects (default) or sum ARR in ₹ Cr" },
        chart: { type: "string", enum: ["column", "bar", "line", "area", "pie", "donut", "stacked", "grouped", "multiline", "table"] },
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

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const fmtCr = (n: number) => `₹${(Math.round(n * 10) / 10).toLocaleString("en-IN")} Cr`;

export async function runReportTool(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult & { report?: BuddyReport }> {
  try {
    // Column headings and category names in this workspace's own words.
    const L = await buddyLabels(caller);
    const columnLabel = (key: string) =>
      key === "merchantName" ? L.merchant : key === "mid" ? L.label("field_mid") : COLUMNS[key]!.label;
    const needed = new Set([
      "id", "merchant_name", "project_state", "current_phase", "current_owner_team", "assigned_owner", "platform",
      "category", "expected_go_live_date", "kick_off_date", "current_responsibility", "arr",
    ]);
    for (const k of args.columns || []) if (COLUMNS[k]) needed.add(COLUMNS[k]!.field);

    let q = caller.client.from("projects").select(Array.from(needed).join(", ")).eq("tenant_id", caller.tenantId).eq("archived", false);
    if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);
    if (args.state) q = q.eq("project_state", args.state);
    if (args.phase) q = q.eq("current_phase", args.phase);
    if (args.platform) q = q.ilike("platform", String(args.platform));
    if (args.owner_id) q = q.eq("assigned_owner", args.owner_id);
    if (args.go_live_from) q = q.gte("expected_go_live_date", args.go_live_from);
    if (args.go_live_to) q = q.lte("expected_go_live_date", args.go_live_to);
    const { data, error } = await q.order("expected_go_live_date", { ascending: true, nullsFirst: false }).limit(3000);
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
    const totalArr = projects.reduce((a, p) => a + (Number(p.arr) || 0), 0);
    const live = projects.filter((p) => p.project_state === "live").length;
    const blocked = projects.filter((p) => p.project_state === "blocked").length;
    const stats = [
      { label: "Projects", value: projects.length.toLocaleString("en-IN") },
      { label: "Total ARR", value: fmtCr(totalArr) },
      { label: "Live", value: live.toLocaleString("en-IN") },
      { label: "Blocked", value: blocked.toLocaleString("en-IN") },
    ];
    const sources: BuddySource[] = [{ kind: "data", label: `${projects.length} projects` }];

    const keyOf = (p: any, dim: Dimension): string => {
      switch (dim) {
        case "go_live_month": return p.expected_go_live_date ? String(p.expected_go_live_date).slice(0, 7) : "No date";
        case "kick_off_month": return p.kick_off_date ? String(p.kick_off_date).slice(0, 7) : "No date";
        case "phase": return PHASE_LABELS[p.current_phase] || p.current_phase || "None";
        case "owner": return ownerName.get(p.assigned_owner) || "Unassigned";
        case "platform": return p.platform || "Unknown";
        case "category": return p.category || "Uncategorised";
        case "responsibility": return RESPONSIBILITY_LABELS[p.current_responsibility] || "Unknown";
        default: return STATE_LABELS[p.project_state] || p.project_state || "None";
      }
    };
    const metric = args.metric === "arr" ? "arr" : "count";
    const valueOf = (p: any) => (metric === "arr" ? Number(p.arr) || 0 : 1);
    const valueLabel = metric === "arr" ? "ARR (₹ Cr)" : "Projects";
    const round = (n: number) => (metric === "arr" ? Math.round(n * 100) / 100 : n);

    /** Order a dimension's keys: fixed product order, months ascending, otherwise largest first. */
    const orderKeys = (dim: Dimension, totals: Map<string, number>) => {
      const keys = Array.from(totals.keys());
      if (TIME_DIMENSIONS.has(dim)) return keys.sort((a, b) => (a === "No date" ? 1 : b === "No date" ? -1 : a.localeCompare(b)));
      const fixed = FIXED_ORDER[dim];
      if (fixed) return keys.sort((a, b) => (fixed.indexOf(a) + 1 || 99) - (fixed.indexOf(b) + 1 || 99));
      return keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));
    };

    if (args.kind === "breakdown") {
      const groupBy = (DIMENSION_LABELS[args.group_by as Dimension] ? args.group_by : "state") as Dimension;
      const splitBy = DIMENSION_LABELS[args.split_by as Dimension] && args.split_by !== groupBy ? (args.split_by as Dimension) : null;
      const isTime = TIME_DIMENSIONS.has(groupBy);
      const groupLabel = (k: string) => (isTime && k !== "No date" ? monthLabel(k) : k);

      const groupTotals = new Map<string, number>();
      for (const p of projects) groupTotals.set(keyOf(p, groupBy), (groupTotals.get(keyOf(p, groupBy)) || 0) + valueOf(p));
      const groupKeys = orderKeys(groupBy, groupTotals);

      if (!splitBy) {
        const rows = groupKeys.map((k) => ({ group: groupLabel(k), value: round(groupTotals.get(k) || 0) }));
        const charts: ChartType[] = isTime
          ? ["line", "area", "column", "table"]
          : ["column", "bar", ...(rows.length >= 2 && rows.length <= 12 ? (["pie", "donut"] as ChartType[]) : []), "table"];
        const preferred: ChartType = isTime ? "line" : LONG_LABEL_DIMENSIONS.has(groupBy) || rows.length > 8 ? "bar" : "column";
        const type = charts.includes(args.chart) ? (args.chart as ChartType) : preferred;
        const report: BuddyReport = {
          title,
          subtitle,
          stats,
          columns: [
            { key: "group", label: DIMENSION_LABELS[groupBy] },
            { key: "value", label: valueLabel, numeric: true },
          ],
          rows,
          chart: { type, x: "group", series: [{ key: "value", label: valueLabel }], valueLabel },
          charts,
          total: projects.length,
        };
        return { step: `Built "${title}"`, data: { shown_to_user: true, chart: type, total_projects: projects.length, rows }, sources, report };
      }

      // Split by a second dimension: one series per split value, the tail folded into "Other".
      const splitTotals = new Map<string, number>();
      for (const p of projects) splitTotals.set(keyOf(p, splitBy), (splitTotals.get(keyOf(p, splitBy)) || 0) + valueOf(p));
      let splitKeys = orderKeys(splitBy, splitTotals);
      const folded = splitKeys.length > MAX_SERIES;
      if (folded) {
        const byTotal = [...splitKeys].sort((a, b) => (splitTotals.get(b) || 0) - (splitTotals.get(a) || 0));
        const keep = new Set(byTotal.slice(0, MAX_SERIES - 1));
        splitKeys = [...splitKeys.filter((k) => keep.has(k)), "Other"];
      }
      const seriesKey = (k: string) => `s${splitKeys.indexOf(k)}`;
      const cells = new Map<string, Record<string, number>>();
      for (const p of projects) {
        const g = keyOf(p, groupBy);
        let sKey = keyOf(p, splitBy);
        if (folded && !splitKeys.includes(sKey)) sKey = "Other";
        const row = cells.get(g) || {};
        row[seriesKey(sKey)] = (row[seriesKey(sKey)] || 0) + valueOf(p);
        cells.set(g, row);
      }
      const series = splitKeys.map((k) => ({ key: seriesKey(k), label: k }));
      const rows = groupKeys.map((g) => {
        const r: Record<string, string | number | null> = { group: groupLabel(g) };
        let total = 0;
        for (const s of series) {
          const v = round(cells.get(g)?.[s.key] || 0);
          r[s.key] = v;
          total += v;
        }
        r.total = round(total);
        return r;
      });
      const charts: ChartType[] = isTime ? ["stacked", "grouped", "multiline", "table"] : ["stacked", "grouped", "table"];
      const preferred: ChartType = isTime && series.length <= 4 ? "multiline" : "stacked";
      const type = charts.includes(args.chart) ? (args.chart as ChartType) : preferred;
      const report: BuddyReport = {
        title,
        subtitle,
        stats,
        columns: [
          { key: "group", label: DIMENSION_LABELS[groupBy] },
          ...series.map((s) => ({ key: s.key, label: s.label, numeric: true })),
          { key: "total", label: "Total", numeric: true },
        ],
        rows,
        chart: { type, x: "group", series, valueLabel },
        charts,
        total: projects.length,
      };
      return {
        step: `Built "${title}"`,
        data: { shown_to_user: true, chart: type, total_projects: projects.length, series: series.map((s) => s.label), rows: rows.slice(0, 24) },
        sources,
        report,
      };
    }

    // Project list: headline numbers and the table; no chart.
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
        case "projectState": return L.state[v] || v || null;
        case "currentOwnerTeam": return L.team[v] || v || null;
        case "assignedOwnerName": return ownerName.get(v) || "Unassigned";
        case "currentResponsibility": return L.responsibility[v] || v || null;
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
      stats,
      columns: columns.map((k: string) => ({ key: k, label: columnLabel(k), numeric: COLUMNS[k]!.numeric })),
      rows,
      charts: ["table"],
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
