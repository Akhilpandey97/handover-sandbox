import { useMemo } from "react";
import { Project, isProjectLive, ProjectChecklist } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";
import type { FunnelStageRule } from "@/data/funnelConfig";


import { arrToCrore } from "@/lib/arr";

// ARR is stored in rupees for imported data but some rows are already in Cr.
// Normalise to crores so the tile never renders a raw 8-digit number.
const toCrore = arrToCrore;

const formatCr = (value: number) => {
  const cr = toCrore(value);
  return cr >= 100 ? cr.toFixed(0) : cr.toFixed(2);
};

const diffDays = (from: number, to: number) => Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));

const time = (value?: string | null) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return isNaN(t) ? null : t;
};

/**
 * When a project reached the end of a stage: the latest completion timestamp
 * among the checklist items the tenant's stage rule points at. Stages without
 * checklist titles (e.g. the "Live" state rule) fall back to the go-live date.
 */
const stageReachedAt = (project: Project, rule: FunnelStageRule): number | null => {
  if (rule.matchType === "project_state") return time(project.dates?.goLiveDate);
  const titles = rule.titles || [];
  if (titles.length === 0) return null;
  const items = project.checklist.filter((c: ProjectChecklist) => !c.isTask);
  const stamps = titles
    .map((needle) => items.find((i) => i.title.toLowerCase().includes(needle.toLowerCase())))
    .filter((i): i is ProjectChecklist => !!i && !!i.completed)
    .map((i) => time(i.completedAt))
    .filter((t): t is number => t !== null);
  if (stamps.length === 0) return null;
  return Math.max(...stamps);
};

interface Props { projects: Project[] }

export const TATDashlet = ({ projects }: Props) => {
  const { getLabel } = useLabels();
  const { stages } = useFunnelConfig();
  const arrLabel = getLabel("field_arr");

  // Config lists stages latest-first; the timeline reads earliest-first.
  const orderedStages = useMemo(() => [...stages].reverse(), [stages]);

  const rows = useMemo(() => {
    return projects
      .filter(p => isProjectLive(p) && p.dates?.kickOffDate && p.dates?.goLiveDate)
      .map(p => {
        const kick = time(p.dates.kickOffDate)!;
        const live = time(p.dates.goLiveDate)!;
        let previous = kick;
        const stageDays: Array<number | null> = orderedStages.map((rule, index) => {
          const isLast = index === orderedStages.length - 1;
          const reached = stageReachedAt(p, rule) ?? (isLast ? live : null);
          if (reached === null) return null;
          const days = diffDays(previous, reached);
          previous = Math.max(previous, reached);
          return days;
        });
        return {
          id: p.id,
          merchant: p.merchantName,
          arr: p.arr || 0,
          stageDays,
          tat: diffDays(kick, live),
        };
      })
      .sort((a, b) => b.tat - a.tat);
  }, [projects, orderedStages]);

  const overall = useMemo(() => {
    const n = rows.length;
    return {
      count: n,
      totalArr: rows.reduce((s, r) => s + (r.arr || 0), 0),
      avgTat: n ? rows.reduce((s, r) => s + r.tat, 0) / n : 0,
    };
  }, [rows]);

  // Average time in each configured stage, across the live merchants that
  // have data for it.
  const stageAverages = useMemo(() => orderedStages.map((rule, index) => {
    const values = rows.map(r => r.stageDays[index]).filter((v): v is number => v !== null && v !== undefined);
    return {
      id: rule.id,
      label: rule.label,
      avg: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    };
  }), [orderedStages, rows]);

  return (
    <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">TAT</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-sky-50 p-2 dark:bg-sky-950/40">
            <p className="text-[10px] font-semibold tracking-normal text-sky-700 dark:text-sky-300">Merchants</p>
            <p className="mt-0.5 text-xl font-semibold leading-tight tabular-nums text-sky-900 dark:text-sky-200">{overall.count}</p>
            <p className="text-[10px] text-sky-700 dark:text-sky-300">live</p>
          </div>
          <div className="min-w-0 rounded-md bg-muted p-2">
            <p className="truncate text-[10px] font-semibold tracking-normal text-muted-foreground">Total {arrLabel}</p>
            <p className="mt-0.5 truncate text-xl font-semibold leading-tight tabular-nums text-foreground">{formatCr(overall.totalArr)}</p>
            <p className="text-[10px] text-muted-foreground">Cr</p>
          </div>
          <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/40">
            <p className="text-[10px] font-semibold tracking-normal text-emerald-700 dark:text-emerald-300">Avg TAT</p>
            <p className="mt-0.5 text-xl font-semibold leading-tight tabular-nums text-emerald-900 dark:text-emerald-200">{overall.avgTat.toFixed(1)}</p>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300">days</p>
          </div>
        </div>

        {/* Stage averages as one compact line instead of cards. */}
        {stageAverages.length > 0 && (
          <div className="flex items-center gap-x-3 gap-y-1 overflow-x-auto whitespace-nowrap text-[11px]">
            {stageAverages.map(stage => (
              <span key={stage.id} className="flex shrink-0 items-baseline gap-1">
                <span className="font-medium text-muted-foreground" title={stage.label}>{stage.label}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {stage.avg === null ? "–" : `${stage.avg.toFixed(1)}d`}
                </span>
              </span>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No live projects with both kick-off and actual go-live dates.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[420px] text-left">
              <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                <tr>
                  <th className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground">Merchant</th>
                  {orderedStages.map(stage => (
                    <th key={stage.id} className="px-2 py-1.5 text-right text-[10px] font-semibold text-muted-foreground">{stage.label}</th>
                  ))}
                  <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5">
                      <p className="truncate text-xs font-semibold text-foreground">{r.merchant}</p>
                      <p className="text-[10px] text-muted-foreground">{arrLabel}: {formatCr(r.arr)} Cr</p>
                    </td>
                    {r.stageDays.map((days, index) => (
                      <td key={orderedStages[index]?.id || index} className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                        {days === null ? "–" : `${days}d`}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-foreground">{r.tat}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default TATDashlet;
