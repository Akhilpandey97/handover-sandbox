import { useMemo, useState } from "react";
import { Project, ChecklistResponsibilityLog, getProjectFunnelStage, funnelStageLabels, FunnelStage } from "@/data/projectsData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Clock, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Props {
  projects: Project[];
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// Compute total elapsed time (ms) for a checklist item.
// Prefers responsibility log span (start of first log → end of last / completedAt / now).
const computeItemDurationMs = (
  logs: ChecklistResponsibilityLog[] | undefined,
  completedAt: string | undefined,
  completed: boolean,
): number => {
  if (!logs || logs.length === 0) {
    return 0;
  }
  const starts = logs.map((l) => new Date(l.startedAt).getTime()).filter((t) => !isNaN(t));
  if (starts.length === 0) return 0;
  const start = Math.min(...starts);
  let end: number;
  if (completed && completedAt) {
    end = new Date(completedAt).getTime();
  } else {
    const ends = logs
      .map((l) => (l.endedAt ? new Date(l.endedAt).getTime() : null))
      .filter((t): t is number => t !== null && !isNaN(t));
    const lastEnd = ends.length === logs.length ? Math.max(...ends) : Date.now();
    end = lastEnd;
  }
  return Math.max(0, end - start);
};

// Color scale based on weeks: green → yellow → orange → red
const weekColor = (weeks: number, completed: boolean): string => {
  if (weeks <= 0) return "bg-muted/30 text-muted-foreground";
  if (weeks < 1) return completed
    ? "bg-success/20 text-success-strong"
    : "bg-success/10 text-success-strong";
  if (weeks < 2) return "bg-lime-500/20 text-lime-800 dark:text-lime-300";
  if (weeks < 4) return "bg-warning/30 text-warning-strong";
  if (weeks < 8) return "bg-warning/40 text-warning-strong";
  return "bg-destructive/50 text-destructive-strong";
};

export const WeeksPerChecklistReport = ({ projects }: Props) => {
  const [includeArchived] = useState(false);

  const { columns, rows } = useMemo(() => {
    const filtered = projects.filter((p) => includeArchived || !p.archived);

    // Collect unique checklist item titles (non-task), preserving an order grouped by phase.
    const titleOrder: string[] = [];
    const seen = new Set<string>();
    filtered.forEach((p) => {
      p.checklist.forEach((item) => {
        if (item.isTask) return;
        const key = item.title.trim();
        if (!seen.has(key)) {
          seen.add(key);
          titleOrder.push(key);
        }
      });
    });

    const rows = filtered.map((p) => {
      const cells: Record<string, { weeks: number; completed: boolean }> = {};
      let totalWeeks = 0;
      p.checklist.forEach((item) => {
        if (item.isTask) return;
        const key = item.title.trim();
        const ms = computeItemDurationMs(item.responsibilityLog, item.completedAt, item.completed);
        const weeks = ms / MS_PER_WEEK;
        cells[key] = { weeks, completed: item.completed };
        totalWeeks += weeks;
      });
      return {
        id: p.id,
        name: p.merchantName,
        mid: p.mid,
        cells,
        totalWeeks,
      };
    });

    rows.sort((a, b) => b.totalWeeks - a.totalWeeks);
    return { columns: titleOrder, rows };
  }, [projects, includeArchived]);

  const exportCSV = () => {
    const header = ["Merchant", "MID", ...columns, "Total Weeks"];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      const cells = columns.map((c) => (r.cells[c]?.weeks ?? 0).toFixed(2));
      lines.push(
        [
          `"${r.name.replace(/"/g, '""')}"`,
          `"${r.mid}"`,
          ...cells,
          r.totalWeeks.toFixed(2),
        ].join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weeks-per-checklist-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stable color palette for checklist items (HSL semantic-friendly)
  const palette = [
    "hsl(160 70% 45%)",
    "hsl(200 75% 50%)",
    "hsl(260 65% 60%)",
    "hsl(320 65% 55%)",
    "hsl(35 90% 55%)",
    "hsl(15 80% 55%)",
    "hsl(90 55% 45%)",
    "hsl(220 70% 55%)",
    "hsl(280 60% 55%)",
    "hsl(0 70% 55%)",
    "hsl(50 85% 50%)",
    "hsl(180 60% 45%)",
  ];

  // Group projects (rows) by project stage
  const projectStageById = useMemo(() => {
    const m = new Map<string, FunnelStage>();
    projects.forEach((p) => m.set(p.id, getProjectFunnelStage(p)));
    return m;
  }, [projects]);

  // Chart data per stage
  const chartByStage = useMemo(() => {
    const stages: FunnelStage[] = ["sales", "pre_integration", "under_integration", "live"];
    return stages.map((stage) => {
      const stageRows = rows.filter((r) => projectStageById.get(r.id) === stage);
      const data = stageRows.map((r) => {
        const entry: Record<string, string | number> = { merchant: r.name };
        columns.forEach((c) => {
          entry[c] = Number((r.cells[c]?.weeks ?? 0).toFixed(2));
        });
        return entry;
      });
      return { stage, label: funnelStageLabels[stage], data };
    });
  }, [rows, columns, projectStageById]);

  const stageColors: Record<FunnelStage, string> = {
    sales: "hsl(220 70% 55%)",
    pre_integration: "hsl(35 90% 55%)",
    under_integration: "hsl(280 60% 55%)",
    live: "hsl(160 70% 45%)",
    none: "hsl(0 0% 60%)",
  };

  const renderChart = (
    label: string,
    stage: FunnelStage,
    data: Record<string, string | number>[],
  ) => (
    <Card key={stage}>
      <CardHeader className="pb-3">
        <CardTitle className="portal-heading flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: stageColors[stage] }}
          />
          {label} — Weeks per Merchant
          <span className="text-xs font-normal text-muted-foreground ml-1">
            ({data.length} merchant{data.length === 1 ? "" : "s"})
          </span>
        </CardTitle>
        <CardDescription>
          Y-axis: weeks. X-axis: merchants. Each colored segment is one checklist item.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No merchants in this project stage.
          </div>
        ) : (
          <div style={{ width: "100%", height: Math.max(320, Math.min(600, data.length * 26 + 120)) }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 90 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="merchant"
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={90}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  label={{ value: "Weeks", angle: -90, position: "insideLeft", style: { fill: "hsl(var(--muted-foreground))", fontSize: 12 } }}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => {
                    if (!value || value <= 0) return null as unknown as [string, string];
                    return [`${value.toFixed(2)}w`, name];
                  }}
                  itemSorter={(item) => -(Number(item.value) || 0)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {columns.map((c, i) => (
                  <Bar
                    key={c}
                    dataKey={c}
                    stackId="weeks"
                    fill={palette[i % palette.length]}
                    name={c}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <BarChart3 className="h-4 w-4 text-primary" />
        Weeks per Merchant — split by project stage
      </div>
      {chartByStage.map((c) => renderChart(c.label, c.stage, c.data))}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="portal-heading flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Weeks per Checklist Item × Merchant
              </CardTitle>
              <CardDescription>
                Time (in weeks) spent on each checklist item per merchant. Color-coded by duration —
                green is fast, red is stuck.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={exportCSV} className="gap-2">
              <Download className="h-3 w-3" />
              Export CSV
            </Button>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap pt-2 text-xs">
            <span className="text-muted-foreground">Legend:</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-success/20" />&lt;1w</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-lime-500/20" />1–2w</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-warning/30" />2–4w</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-warning/40" />4–8w</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-destructive/50" />8w+</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-muted/30 border" />no data</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 || columns.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No checklist data available.</div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="text-xs border-collapse w-full">
                <thead className="sticky top-0 bg-background z-10">
                  <tr>
                    <th className="sticky left-0 bg-background border-b border-r p-2 text-left font-medium min-w-[200px] z-20">
                      Merchant
                    </th>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className="border-b border-r p-2 text-left font-medium align-bottom min-w-[90px]"
                        title={c}
                      >
                        <div className="whitespace-normal leading-tight">{c}</div>
                      </th>
                    ))}
                    <th className="border-b p-2 text-left font-medium min-w-[80px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="sticky left-0 bg-background border-b border-r p-2 font-medium z-10">
                        <div className="truncate max-w-[200px]" title={r.name}>{r.name}</div>
                        <div className="text-2xs text-muted-foreground truncate">{r.mid}</div>
                      </td>
                      {columns.map((c) => {
                        const cell = r.cells[c];
                        const weeks = cell?.weeks ?? 0;
                        return (
                          <td
                            key={c}
                            className={cn(
                              "border-b border-r p-2 text-center tabular-nums",
                              weekColor(weeks, !!cell?.completed),
                            )}
                            title={`${r.name} → ${c}: ${weeks.toFixed(2)} weeks${cell?.completed ? " (completed)" : ""}`}
                          >
                            {cell ? (weeks > 0 ? weeks.toFixed(1) : "—") : ""}
                          </td>
                        );
                      })}
                      <td className="border-b p-2 text-center font-semibold tabular-nums">
                        {r.totalWeeks.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
