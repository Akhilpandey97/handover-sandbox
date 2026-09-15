import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  AreaChart as AreaIcon,
  BarChart3,
  BarChartHorizontal,
  ChartColumnStacked,
  ChartPie,
  Download,
  Donut,
  LineChart as LineIcon,
  Rows3,
  Save,
  Table2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BuddyReport, ChartType } from "./types";

const PREVIEW_ROWS = 25;
const PIE_SLICES = 6; // part-to-whole at a glance only: 5 groups + "Other"

/** Categorical slots in fixed order (validated palette, see styles.css). Never cycled. */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

const CHART_META: Record<ChartType, { label: string; icon: typeof BarChart3 }> = {
  column: { label: "Column", icon: BarChart3 },
  bar: { label: "Bar", icon: BarChartHorizontal },
  line: { label: "Line", icon: LineIcon },
  area: { label: "Area", icon: AreaIcon },
  pie: { label: "Pie", icon: ChartPie },
  donut: { label: "Donut", icon: Donut },
  stacked: { label: "Stacked", icon: ChartColumnStacked },
  grouped: { label: "Grouped", icon: Rows3 },
  multiline: { label: "Lines", icon: TrendingUp },
  table: { label: "Table", icon: Table2 },
};

const toCsv = (report: BuddyReport) => {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [report.columns.map((c) => esc(c.label)).join(","), ...report.rows.map((r) => report.columns.map((c) => esc(r[c.key])).join(","))].join("\n");
};

const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : v === null || v === undefined ? "—" : String(v));

/** A report Buddy built from a question: headline numbers, chart, table, download and save. */
export const ReportCard = ({ report }: { report: BuddyReport }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const charts = report.charts?.length ? report.charts : report.chart ? [report.chart.type, "table" as ChartType] : ["table" as ChartType];
  const [view, setView] = useState<ChartType>(report.chart?.type || "table");
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(report.title);

  const download = () => {
    const blob = new Blob([toCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title.replace(/[^\w\- ]+/g, "").trim() || "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!report.saveColumns?.length || !currentUser?.tenantId || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("saved_reports").insert({
      name: name.trim(),
      columns: report.saveColumns,
      schedule: "none",
      recipients: [],
      tenant_id: currentUser.tenantId,
      created_by: currentUser.id,
    });
    setSaving(false);
    if (error) {
      toast.error("Couldn't save the report.", { description: error.message });
      return;
    }
    setNaming(false);
    toast.success(`Saved "${name.trim()}" to Reports`, {
      description: "Find it under Reports → Report Builder → Saved Reports, or schedule it in Scheduler.",
      action: { label: "Open Reports", onClick: () => navigate({ to: "/reports" }) },
    });
  };

  const showTable = view === "table";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <p className="heading-card text-foreground">{report.title}</p>
          {report.subtitle && <p className="text-2xs text-muted-foreground">{report.subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={download}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
          {report.saveColumns?.length ? (
            <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setNaming((v) => !v)}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save to Reports
            </Button>
          ) : null}
        </div>
      </div>

      {naming && (
        <div className="space-y-2 border-b border-border/70 bg-muted/40 px-4 py-3">
          <label className="block text-xs text-muted-foreground" htmlFor={`buddy-report-name-${report.title}`}>
            Report name
          </label>
          <div className="flex gap-2">
            <Input id={`buddy-report-name-${report.title}`} value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-md bg-card" />
            <Button size="sm" className="h-9 rounded-lg" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground">
            Saves these columns to Reports → Report Builder → Saved Reports, where you can reopen or schedule it. Saved reports list every project; the filters from this question aren't kept.
          </p>
        </div>
      )}

      {report.stats?.length ? (
        <div className="grid grid-cols-2 border-b border-border/70 sm:grid-cols-4">
          {report.stats.map((s) => (
            <div key={s.label} className="border-border/70 px-4 py-2.5 [&:not(:first-child)]:border-l">
              <p className="text-2xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {charts.length > 1 && (
        <div role="tablist" aria-label="Chart type" className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2">
          {charts.map((c) => {
            const Icon = CHART_META[c].icon;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={view === c}
                onClick={() => setView(c)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === c ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {CHART_META[c].label}
              </button>
            );
          })}
        </div>
      )}

      {!showTable && report.chart && <ChartView report={report} type={view} />}

      <DataTable report={report} compact={!showTable} onOpenProject={(id) => navigate({ to: "/projects/$projectId", params: { projectId: id } })} />
    </div>
  );
};

// ── Charts ──────────────────────────────────────────────────────────────────

const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

const ChartTooltip = ({ active, payload, label, valueLabel }: TooltipProps<number, string> & { valueLabel: string }) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined);
  return (
    <div className="min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted-foreground">{label ?? rows[0]?.name}</p>
      {rows.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: (p.payload?.fill as string) || p.color }} />
          <span className="font-semibold tabular-nums text-foreground">{fmt(p.value)}</span>
          <span className="truncate text-muted-foreground">{rows.length > 1 || p.name !== "value" ? p.name : valueLabel}</span>
        </div>
      ))}
    </div>
  );
};

const Legend = ({ items, shape }: { items: { label: string; color: string; value?: string }[]; shape: "rect" | "line" }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-muted-foreground" aria-label="Legend">
    {items.map((it) => (
      <li key={it.label} className="inline-flex items-center gap-1.5">
        <span className={shape === "line" ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"} style={{ background: it.color }} />
        <span className="text-foreground">{it.label}</span>
        {it.value && <span className="tabular-nums">{it.value}</span>}
      </li>
    ))}
  </ul>
);

const ChartView = ({ report, type }: { report: BuddyReport; type: ChartType }) => {
  const chart = report.chart!;
  const series = chart.series;
  const multi = series.length > 1;
  const data = report.rows;
  const longestLabel = useMemo(() => Math.max(...data.map((r) => String(r[chart.x] ?? "").length), 4), [data, chart.x]);

  if (type === "pie" || type === "donut") {
    const key = series[0]!.key;
    const sorted = data.map((r) => ({ name: String(r[chart.x] ?? ""), value: Number(r[key]) || 0 })).filter((d) => d.value > 0);
    const slices = sorted.length > PIE_SLICES
      ? [...sorted.slice(0, PIE_SLICES - 1), { name: "Other", value: sorted.slice(PIE_SLICES - 1).reduce((a, d) => a + d.value, 0) }]
      : sorted;
    const total = slices.reduce((a, d) => a + d.value, 0) || 1;
    return (
      <div>
        <Legend shape="rect" items={slices.map((s, i) => ({ label: s.name, color: SERIES[i]!, value: `${fmt(s.value)} · ${Math.round((s.value / total) * 100)}%` }))} />
        <div className="h-64 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={type === "donut" ? "58%" : 0}
                outerRadius="85%"
                stroke="hsl(var(--card))"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s, i) => (
                  <Cell key={s.name} fill={SERIES[i]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip valueLabel={chart.valueLabel} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;
  const xAxis = (
    <XAxis
      dataKey={chart.x}
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: "var(--chart-axis)" }}
      interval="preserveStartEnd"
      height={32}
    />
  );
  const yAxis = <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} allowDecimals={chart.valueLabel !== "Projects"} tickFormatter={(v) => Number(v).toLocaleString("en-IN")} />;
  const tooltip = (cursor: object) => <Tooltip cursor={cursor} content={<ChartTooltip valueLabel={chart.valueLabel} />} />;
  const legendItems = series.map((s, i) => ({ label: s.label, color: SERIES[i]! }));

  if (type === "bar") {
    const height = Math.max(160, data.length * 30 + 40);
    return (
      <div className="px-2 py-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={chart.valueLabel !== "Projects"} />
            <YAxis type="category" dataKey={chart.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} width={Math.min(160, longestLabel * 7 + 12)} />
            {tooltip({ fill: "hsl(var(--muted))" })}
            <Bar dataKey={series[0]!.key} name={series[0]!.label} fill={SERIES[0]} barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "line" || type === "multiline") {
    return (
      <div>
        {multi && <Legend shape="line" items={legendItems} />}
        <div className="h-64 px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
              {grid}
              {xAxis}
              {yAxis}
              {tooltip({ stroke: "var(--chart-axis)", strokeWidth: 1 })}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  type="monotone"
                  stroke={SERIES[i]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 4, fill: SERIES[i], stroke: "hsl(var(--card))", strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (type === "area") {
    const key = series[0]!.key;
    return (
      <div className="h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ stroke: "var(--chart-axis)", strokeWidth: 1 })}
            <Area
              dataKey={key}
              name={series[0]!.label}
              type="monotone"
              stroke={SERIES[0]}
              strokeWidth={2}
              fill={SERIES[0]}
              fillOpacity={0.1}
              dot={{ r: 4, fill: SERIES[0], stroke: "hsl(var(--card))", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // column, stacked, grouped
  const stacked = type === "stacked";
  const grouped = type === "grouped" && multi;
  return (
    <div>
      {multi && <Legend shape="rect" items={legendItems} />}
      <div className="h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barGap={2}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ fill: "hsl(var(--muted))" })}
            {(multi ? series : series.slice(0, 1)).map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId={stacked ? "stack" : undefined}
                fill={SERIES[i]}
                maxBarSize={grouped ? 14 : 24}
                stroke={stacked ? "hsl(var(--card))" : undefined}
                strokeWidth={stacked ? 2 : 0}
                radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ── Table (always available: the accessible twin of every chart) ────────────

const DataTable = ({ report, compact, onOpenProject }: { report: BuddyReport; compact: boolean; onOpenProject: (id: string) => void }) => {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? report.rows : report.rows.slice(0, PREVIEW_ROWS);
  return (
    <div className={cn(compact && "border-t border-border/70")}>
      <div className={cn("overflow-auto", expanded ? "max-h-[32rem]" : "max-h-80")}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="table-header-tint">
              {report.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-semibold text-muted-foreground", c.numeric ? "text-right" : "text-left")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/70">
                {report.columns.map((c, j) => (
                  <td key={c.key} className={cn("px-3 py-1.5", c.numeric && "text-right tabular-nums")}>
                    {j === 0 && typeof r._id === "string" ? (
                      <button type="button" onClick={() => onOpenProject(String(r._id))} className="font-medium text-foreground hover:text-primary hover:underline">
                        {fmt(r[c.key])}
                      </button>
                    ) : (
                      fmt(r[c.key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.rows.length > PREVIEW_ROWS && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full border-t border-border/70 px-4 py-2 text-left text-2xs font-medium text-primary hover:bg-muted/50">
          {expanded ? "Show fewer rows" : `Show all ${report.rows.length} rows`}
        </button>
      )}
    </div>
  );
};
