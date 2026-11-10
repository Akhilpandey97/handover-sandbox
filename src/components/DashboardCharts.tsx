import { useMemo } from "react";
import {
  Project,
  ProjectState,
  projectStateLabels,
  getProjectFunnelStage,
  funnelStageLabels,
} from "@/data/projectsData";
import { getActiveFunnelStages } from "@/data/funnelConfig";
import { arrToCrore, formatCr } from "@/lib/arr";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import type { RingData } from "@/components/charts/ring-context";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { FunnelChart } from "@/components/charts/funnel-chart";
import type { FunnelStage as FunnelStageData } from "@/components/charts/funnel-chart";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";

interface Props {
  projects: Project[];
}

const STATE_COLORS: Record<string, string> = {
  not_started: "#94a3b8",
  in_progress:  "#3b82f6",
  on_hold:      "#f59e0b",
  blocked:      "#ef4444",
  live:         "#22c55e",
};

const FUNNEL_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#f97316"];

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function DashboardCharts({ projects }: Props) {
  const totalProjects = projects.length;

  // ── Ring chart: project state breakdown ───────────────────────────────
  const { ringData, ringColors } = useMemo(() => {
    const states: ProjectState[] = ["in_progress", "not_started", "on_hold", "blocked", "live"];
    const data: RingData[] = states
      .map((s) => ({
        label: projectStateLabels[s],
        value: projects.filter((p) => p.projectState === s).length,
        maxValue: totalProjects || 1,
        color: STATE_COLORS[s],
      }))
      .filter((r) => r.value > 0);
    const colors = data.map((r) => r.color ?? "#94a3b8");
    return { ringData: data, ringColors: colors };
  }, [projects, totalProjects]);

  // ── Bar chart: go-live by month (±2 months from now) ─────────────────
  const goLiveData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 2 + i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const count = projects.filter((p) => {
        const gl = p.dates?.expectedGoLiveDate;
        if (!gl) return false;
        const gd = new Date(gl);
        return `${gd.getFullYear()}-${gd.getMonth()}` === key;
      }).length;
      return { month: `${MONTH_LABELS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, count };
    });
  }, [projects]);

  // ── Area chart: ARR snapshot by state ────────────────────────────────
  const arrData = useMemo(() => {
    const states: ProjectState[] = ["in_progress", "on_hold", "live"];
    return states.map((s) => ({
      state: projectStateLabels[s],
      arr: arrToCrore(
        projects.filter((p) => p.projectState === s).reduce((sum, p) => sum + (p.arr || 0), 0),
      ),
    }));
  }, [projects]);

  // ── Funnel chart: projects by funnel stage ─────────────────────────────
  const funnelData = useMemo((): FunnelStageData[] => {
    const stages = getActiveFunnelStages();
    return stages
      .map((stage, i) => ({
        label: funnelStageLabels[stage.id] || stage.label,
        value: projects.filter((p) => getProjectFunnelStage(p) === stage.id).length,
        color: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
      }))
      .filter((s) => s.value > 0);
  }, [projects]);

  if (totalProjects === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

      {/* Ring — project state breakdown */}
      <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">Project states</p>
        <div className="flex justify-center" style={{ height: 160 }}>
          <RingChart data={ringData} className="h-full w-full max-w-[160px]">
            {ringData.map((_, i) => (
              <Ring key={i} index={i} color={ringColors[i]} />
            ))}
            <RingCenter>
              {() => (
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{totalProjects}</p>
                  <p className="text-xs text-muted-foreground">total</p>
                </div>
              )}
            </RingCenter>
          </RingChart>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {ringData.map((r, i) => (
            <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: ringColors[i] }} />
              {r.label} ({r.value})
            </span>
          ))}
        </div>
      </div>

      {/* Bar — go-live by month */}
      <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">Expected go-live</p>
        <div style={{ height: 160 }}>
          <BarChart data={goLiveData} xDataKey="month" className="h-full w-full">
            <Grid horizontal />
            <Bar dataKey="count" fill="#3b82f6" />
            <BarXAxis />
            <ChartTooltip />
          </BarChart>
        </div>
      </div>

      {/* Area — ARR by state */}
      <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">ARR by state (₹Cr/mo)</p>
        <div style={{ height: 160 }}>
          <AreaChart data={arrData} xDataKey="state" className="h-full w-full">
            <Grid horizontal />
            <Area dataKey="arr" fill="#3b82f6" fillOpacity={0.2} />
            <ChartTooltip />
          </AreaChart>
        </div>
      </div>

      {/* Funnel — pipeline stages */}
      <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">Pipeline funnel</p>
        <div style={{ height: 160 }}>
          {funnelData.length > 0 ? (
            <FunnelChart data={funnelData} className="h-full w-full" showLabels showValues />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No funnel data
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
