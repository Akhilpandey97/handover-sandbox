import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BuddyReport } from "./types";

const PREVIEW_ROWS = 25;

const toCsv = (report: BuddyReport) => {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [report.columns.map((c) => esc(c.label)).join(","), ...report.rows.map((r) => report.columns.map((c) => esc(r[c.key])).join(","))].join("\n");
};

/** A report Buddy built from a question: chart, table, download and save. */
export const ReportCard = ({ report }: { report: BuddyReport }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
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
    toast.success(`Saved "${name.trim()}" to Reports`, { action: { label: "Open Reports", onClick: () => navigate({ to: "/reports" }) } });
  };

  const chart = report.chart;
  const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

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
          <p className="text-2xs text-muted-foreground">Saves these columns to Reports, where they list every project. Filters from this question aren't saved.</p>
        </div>
      )}

      {chart && report.rows.length > 1 && (
        <div className="h-56 px-2 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "line" ? (
              <LineChart data={report.rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={chart.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={32} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                {chart.y.map((k) => (
                  <Line key={k} dataKey={k} type="monotone" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={report.rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={chart.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} interval={0} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={32} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                {chart.y.map((k) => (
                  <Bar key={k} dataKey={k} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="table-header-tint">
              {report.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold text-muted-foreground ${c.numeric ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
              <tr key={i} className="border-t border-border/70">
                {report.columns.map((c, j) => (
                  <td key={c.key} className={`px-3 py-1.5 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                    {j === 0 && typeof r._id === "string" ? (
                      <button
                        type="button"
                        onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: String(r._id) } })}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {String(r[c.key] ?? "—")}
                      </button>
                    ) : (
                      String(r[c.key] ?? "—")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.rows.length > PREVIEW_ROWS && (
        <p className="border-t border-border/70 px-4 py-2 text-2xs text-muted-foreground">
          Showing {PREVIEW_ROWS} of {report.rows.length} rows. Download the CSV for all of them.
        </p>
      )}
    </div>
  );
};
