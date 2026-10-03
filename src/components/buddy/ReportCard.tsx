import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BuddyReport } from "./types";
import { ChartView, CHART_META, SERIES, fmt, type ChartType } from "@/components/charts/ReportChartView";

const PREVIEW_ROWS = 25;
const toCsv = (report: BuddyReport) => {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [report.columns.map((c) => esc(c.label)).join(","), ...report.rows.map((r) => report.columns.map((c) => esc(r[c.key])).join(","))].join("\n");
};


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

      {!showTable && report.chart && <ChartView rows={report.rows} chart={report.chart} type={view} />}

      <DataTable report={report} compact={!showTable} onOpenProject={(id) => navigate({ to: "/projects/$projectId", params: { projectId: id } })} />
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
