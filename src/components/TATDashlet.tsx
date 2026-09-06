import { useMemo } from "react";
import { Project, isProjectLive } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";

import { Timer } from "lucide-react";
import { arrToCrore } from "@/lib/arr";

// ARR is stored in rupees for imported data but some rows are already in Cr.
// Normalise to crores so the tile never renders a raw 8-digit number.
const toCrore = arrToCrore;

const formatCr = (value: number) => {
  const cr = toCrore(value);
  return cr >= 100 ? cr.toFixed(0) : cr.toFixed(2);
};

const diffDays = (from: string, to: string) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
};

interface Props { projects: Project[] }

export const TATDashlet = ({ projects }: Props) => {
  const { getLabel } = useLabels();
  const arrLabel = getLabel("field_arr");
  const rows = useMemo(() => {
    return projects
      .filter(p => isProjectLive(p) && p.dates?.kickOffDate && p.dates?.goLiveDate)
      .map(p => ({ id: p.id, merchant: p.merchantName, arr: p.arr || 0, kick: p.dates.kickOffDate!, live: p.dates.goLiveDate!, tat: diffDays(p.dates.kickOffDate!, p.dates.goLiveDate!) }))
      .sort((a, b) => b.tat - a.tat);
  }, [projects]);


  const overall = useMemo(() => {
    const n = rows.length;
    return {
      count: n,
      totalArr: rows.reduce((s, r) => s + (r.arr || 0), 0),
      avgTat: n ? rows.reduce((s, r) => s + r.tat, 0) / n : 0,
    };
  }, [rows]);

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">TAT booklet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Turnaround from kick-off to go-live</p>
        </div>
        <Timer className="h-5 w-5 text-primary" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-sky-50 p-3 dark:bg-sky-950/40">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Merchants</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-sky-900 dark:text-sky-200">{overall.count}</p>
            <p className="mt-0.5 text-[10px] text-sky-700 dark:text-sky-300">live</p>
          </div>
          <div className="min-w-0 rounded-md bg-muted p-3">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total {arrLabel}</p>
            <p className="mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums text-foreground">{formatCr(overall.totalArr)}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Cr</p>
          </div>
          <div className="rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/40">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Avg TAT</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-emerald-900 dark:text-emerald-200">{overall.avgTat.toFixed(1)}</p>
            <p className="mt-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">days</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No live projects with both kick-off and actual go-live dates.</p>
        ) : (
          <>
            <div className="max-h-[9rem] overflow-y-auto rounded-md border border-border">
              <div className="divide-y divide-border">
                {rows.map(r => (
                  <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{r.merchant}</p>
                      <p className="text-[10px] text-muted-foreground">{arrLabel}: {formatCr(r.arr)} Cr</p>
                    </div>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-foreground">{r.tat}d</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Based on {overall.count} live project{overall.count === 1 ? "" : "s"} with kick-off and go-live dates.</p>
          </>
        )}
      </div>

    </section>
  );

};

export default TATDashlet;
