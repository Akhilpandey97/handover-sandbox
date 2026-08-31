import { useMemo, useState } from "react";
import { Project } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Download, Timer, CalendarClock, ChevronRight, ChevronDown } from "lucide-react";
import { ScheduleTATReportDialog } from "./ScheduleTATReportDialog";

interface Props {
  projects: Project[];
}

type Granularity = "monthly" | "quarterly";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const diffDays = (from: string, to: string) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
};

const networkDays = (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

// Business days AFTER `from` up to and including `to`.
// Used for consecutive funnel segments so the boundary day isn't counted twice
// and the segments sum exactly to the overall network TAT.
const networkDaysExcl = (from: string, to: string) => {
  const start = new Date(from);
  if (isNaN(start.getTime())) return 0;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  return networkDays(start.toISOString(), to);
};

const monthKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};
const quarterKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`;
};

const escapeCSV = (v: string | number | undefined | null) => {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const downloadCSV = (csv: string, filename: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const CORE_INTEG_TITLES = ["requirement gathering", "api walkthrough", "api build & sdk integration", "api validation"];
// Post pre-integration stage breakdown (shown when Under-Integ is expanded)
const UNDER_STAGE_TITLES = ["under integration", "sandbox testing", "production testing", "go-live"];
const UNDER_STAGE_LABELS = ["Under Integration", "Sandbox Testing", "Production Testing", "Go-Live"];

interface Row {
  id: string;
  merchant: string;
  arr: number;
  kickOff: string;
  goLive: string;
  tat: number;
  netDays: number;
  salesDays: number | null;
  preDays: number | null;
  underDays: number | null;
  underBreakdown: (number | null)[]; // 4 stages
}

interface Group {
  key: string;
  label: string;
  rows: Row[];
  totalArr: number;
  avgTat: number;
  avgNet: number;
  avgSales: number;
  avgPre: number;
  avgUnder: number;
  avgUnderBreakdown: number[];
}


export const TATReport = ({ projects }: Props) => {
  const { getLabel } = useLabels();
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [expandUnder, setExpandUnder] = useState(false);

  const findItem = (p: Project, needle: string) =>
    p.checklist.find(c => !c.isTask && c.title.toLowerCase().includes(needle));

  const computeFunnel = (p: Project, kick: string, live: string) => {
    const feas = findItem(p, "feasibility analysis");
    const salesEnd = feas?.completed ? feas.completedAt : undefined;
    const coreItems = CORE_INTEG_TITLES.map(t => findItem(p, t));
    const allCoreDone = coreItems.every(i => i && i.completed && i.completedAt);
    const preEndMs = allCoreDone
      ? coreItems.map(i => new Date(i!.completedAt!).getTime()).reduce((a, b) => Math.max(a, b), 0)
      : undefined;
    const preEndIso = preEndMs ? new Date(preEndMs).toISOString() : undefined;

    // Under-integration breakdown by post-pre-integration stages
    let prevIso: string | undefined = preEndIso;
    const underBreakdown: (number | null)[] = UNDER_STAGE_TITLES.map(title => {
      const item = findItem(p, title);
      if (!prevIso || !item || !item.completed || !item.completedAt) return null;
      const doneAt = item.completedAt;
      const days = networkDaysExcl(prevIso, doneAt);
      prevIso = doneAt;
      return days;
    });

    return {
      salesDays: salesEnd ? networkDays(kick, salesEnd) : null,
      preDays: salesEnd && preEndIso ? networkDaysExcl(salesEnd, preEndIso) : null,
      underDays: preEndIso ? networkDaysExcl(preEndIso, live) : null,
      underBreakdown,
    };
  };

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    projects.forEach(p => {
      const kick = p.dates.kickOffDate;
      const live = p.dates.goLiveDate;
      if (!kick || !live) return;
      const key = granularity === "monthly" ? monthKey(live) : quarterKey(live);
      const label = granularity === "monthly" ? monthLabel(key) : key;
      const funnel = computeFunnel(p, kick, live);
      const row: Row = {
        id: p.id,
        merchant: p.merchantName,
        arr: p.arr || 0,
        kickOff: kick,
        goLive: live,
        tat: diffDays(kick, live),
        netDays: networkDays(kick, live),
        ...funnel,
      };
      const g = map.get(key) || { key, label, rows: [], totalArr: 0, avgTat: 0, avgNet: 0, avgSales: 0, avgPre: 0, avgUnder: 0, avgUnderBreakdown: [0, 0, 0, 0] };
      g.rows.push(row);
      map.set(key, g);
    });
    const avgOf = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null && !isNaN(x));
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    };
    return Array.from(map.values())
      .map(g => {
        const n = g.rows.length;
        const totalArr = g.rows.reduce((s, r) => s + r.arr, 0);
        const avgTat = n ? g.rows.reduce((s, r) => s + r.tat, 0) / n : 0;
        const avgNet = n ? g.rows.reduce((s, r) => s + r.netDays, 0) / n : 0;
        const avgSales = avgOf(g.rows.map(r => r.salesDays));
        const avgPre = avgOf(g.rows.map(r => r.preDays));
        const avgUnder = avgOf(g.rows.map(r => r.underDays));
        const avgUnderBreakdown = UNDER_STAGE_TITLES.map((_, i) => avgOf(g.rows.map(r => r.underBreakdown[i])));
        return { ...g, totalArr, avgTat, avgNet, avgSales, avgPre, avgUnder, avgUnderBreakdown, rows: g.rows.sort((a, b) => b.tat - a.tat) };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [projects, granularity]);

  const overall = useMemo(() => {
    const rows = groups.flatMap(g => g.rows);
    const n = rows.length;
    return {
      count: n,
      avgTat: n ? rows.reduce((s, r) => s + r.tat, 0) / n : 0,
      avgNet: n ? rows.reduce((s, r) => s + r.netDays, 0) / n : 0,
      totalArr: rows.reduce((s, r) => s + r.arr, 0),
    };
  }, [groups]);



  const exportCSV = () => {
    const headers = [
      granularity === "monthly" ? "Month" : "Quarter",
      "#", "Merchant", "ARR (Cr)", "Kickoff Date", "Actual Go-Live Date",
      "TAT (Go-live - Kickoff)", "TAT (Network days)",
      "Sales (days)", "Pre-Integ (days)", "Under-Integ (days)",
      ...(expandUnder ? UNDER_STAGE_LABELS.map(l => `${l} (days)`) : []),
      "Total (days)",
    ];
    const lines = [headers.join(",")];
    groups.forEach(g => {
      g.rows.forEach((r, i) => {
        lines.push([
          g.label, i + 1, r.merchant, r.arr, r.kickOff, r.goLive, r.tat, r.netDays,
          r.salesDays ?? "", r.preDays ?? "", r.underDays ?? "",
          ...(expandUnder ? r.underBreakdown.map(v => v ?? "") : []),
          r.netDays,
        ].map(escapeCSV).join(","));
      });
      lines.push([g.label, "Total", "", g.totalArr.toFixed(3), "", "Average TAT",
        g.avgTat.toFixed(2), g.avgNet.toFixed(2),
        g.avgSales.toFixed(2), g.avgPre.toFixed(2), g.avgUnder.toFixed(2),
        ...(expandUnder ? g.avgUnderBreakdown.map(v => v.toFixed(2)) : []),
        g.avgNet.toFixed(2),
      ].map(escapeCSV).join(","));
      lines.push("");
    });
    downloadCSV(lines.join("\n"), `tat-report-${granularity}-${new Date().toISOString().split("T")[0]}.csv`);
  };


  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="portal-heading flex items-center gap-2">
                <Timer className="h-4 w-4 text-primary" />
                TAT Report
              </CardTitle>
              <CardDescription>
                Turn-around time from {getLabel("field_kick_off_date")} to Actual Go-Live, grouped by {granularity === "monthly" ? "month" : "quarter"}.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <ToggleGroup type="single" value={granularity} onValueChange={(v) => v && setGranularity(v as Granularity)} size="sm">
                <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
                <ToggleGroupItem value="quarterly">Quarterly</ToggleGroupItem>
              </ToggleGroup>
              <Button size="sm" variant="outline" onClick={exportCSV} className="gap-2">
                <Download className="h-3 w-3" /> Export CSV
              </Button>
              <Button size="sm" variant="default" onClick={() => setScheduleOpen(true)} className="gap-2">
                <CalendarClock className="h-3 w-3" /> Save & Schedule
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Live Merchants</div>
              <div className="text-lg font-semibold">{overall.count}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Total ARR (Cr)</div>
              <div className="text-lg font-semibold">{overall.totalArr.toFixed(3)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Avg TAT (days)</div>
              <div className="text-lg font-semibold">{overall.avgTat.toFixed(2)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Avg TAT (network days)</div>
              <div className="text-lg font-semibold">{overall.avgNet.toFixed(2)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No projects with both {getLabel("field_kick_off_date")} and Actual Go-Live dates available.
          </CardContent>
        </Card>
      ) : (
        groups.map(g => (
          <Card key={g.key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading">{g.label}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{g.rows.length} merchants</Badge>
                  <Badge variant="outline">Avg TAT: {g.avgTat.toFixed(2)}d</Badge>
                  <Badge variant="outline">Avg Network: {g.avgNet.toFixed(2)}d</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead>Kickoff Date</TableHead>
                    <TableHead>Actual Go-Live</TableHead>
                    <TableHead className="text-right">TAT (Go-live − Kickoff)</TableHead>
                    <TableHead className="text-right">TAT (Network days)</TableHead>
                    <TableHead className="text-right text-purple-700 dark:text-purple-300">Sales</TableHead>
                    <TableHead className="text-right text-sky-700 dark:text-sky-300">Pre-Integ</TableHead>
                    <TableHead
                      className="text-right text-amber-700 dark:text-amber-300 cursor-pointer select-none hover:underline"
                      onClick={() => setExpandUnder(v => !v)}
                      title="Click to expand checklist-level TAT"
                    >
                      <span className="inline-flex items-center gap-1 justify-end">
                        {expandUnder ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        Under-Integ
                      </span>
                    </TableHead>
                    {expandUnder && UNDER_STAGE_LABELS.map(lbl => (
                      <TableHead key={lbl} className="text-right text-amber-600 dark:text-amber-400 text-xs">{lbl}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((r, i) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.merchant}</TableCell>
                      <TableCell className="text-right">{r.arr}</TableCell>
                      <TableCell>{r.kickOff}</TableCell>
                      <TableCell>{r.goLive}</TableCell>
                      <TableCell className="text-right font-semibold">{r.tat}</TableCell>
                      <TableCell className="text-right">{r.netDays}</TableCell>
                      <TableCell className="text-right">{r.salesDays ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{r.preDays ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{r.underDays ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      {expandUnder && r.underBreakdown.map((v, idx) => (
                        <TableCell key={idx} className="text-right text-xs">
                          {v ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold">{r.netDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">{g.totalArr.toFixed(3)}</TableCell>
                    <TableCell colSpan={2} className="text-right font-semibold">Average TAT</TableCell>
                    <TableCell className="text-right font-semibold">{g.avgTat.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">{g.avgNet.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">{g.avgSales.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">{g.avgPre.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">{g.avgUnder.toFixed(2)}</TableCell>
                    {expandUnder && g.avgUnderBreakdown.map((v, idx) => (
                      <TableCell key={idx} className="text-right font-semibold text-xs">{v.toFixed(2)}</TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">{g.avgNet.toFixed(2)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>

            </CardContent>
          </Card>
        ))
      )}

      <ScheduleTATReportDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        defaultGranularity={granularity}
      />
    </div>
  );
};
