import { useMemo } from "react";
import { AlertTriangle, TrendingDown, Users } from "lucide-react";
import { arrCroreValue, sumArrCrore } from "@/lib/arr";
import { useEglRisk } from "@/hooks/useEglRisk";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import type { Project } from "@/data/projectsData";
import { openProjectInNewTab } from "@/lib/open-project";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GoLiveDate } from "./GoLiveDate";

interface StatTileProps {
  icon: typeof AlertTriangle;
  label: string;
  arr: number;
  count: number;
  tone: string;
}

const StatTile = ({ icon: Icon, label, arr, count, tone }: StatTileProps) => {
  const mrr = arr / 12;
  return (
    <div className={`flex flex-col gap-1 rounded-lg p-3 ${tone}`}>
      <div className="flex items-center gap-1.5 text-2xs font-medium opacity-80">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="text-lg font-semibold leading-tight tabular-nums">
        {arrCroreValue(arr)} Cr
      </p>
      <p className="text-2xs opacity-70">
        MRR {arrCroreValue(mrr)} Cr · {count} project{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
};

export const RevenueAtRiskDashlet = ({ projects }: { projects?: Project[] } = {}) => {
  const { rows: eglRows } = useEglRisk("month", projects);
  const { verdicts } = useProjectRiskVerdicts();

  const { eglProjects, attentionProjects, unionProjects } = useMemo(() => {
    const egl = new Set(eglRows.map((r) => r.project.id));
    const attention = new Set(
      (projects ?? []).filter((p) => !p.archived && verdicts[p.id]?.level === "high").map((p) => p.id),
    );

    const eglList = eglRows.map((r) => r.project);
    const attentionList = (projects ?? []).filter((p) => attention.has(p.id));

    // Union deduplicated — projects in both buckets counted once
    const unionMap = new Map<string, { project: Project; inEgl: boolean; inAttention: boolean }>();
    for (const p of eglList) unionMap.set(p.id, { project: p, inEgl: true, inAttention: false });
    for (const p of attentionList) {
      const existing = unionMap.get(p.id);
      if (existing) existing.inAttention = true;
      else unionMap.set(p.id, { project: p, inEgl: false, inAttention: true });
    }

    return {
      eglProjects: eglList,
      attentionProjects: attentionList,
      unionProjects: [...unionMap.values()].sort(
        (a, b) => sumArrCrore([b.project.arr]) - sumArrCrore([a.project.arr]),
      ),
    };
  }, [eglRows, projects, verdicts]);

  const eglArr = sumArrCrore(eglProjects.map((p) => p.arr));
  const attentionArr = sumArrCrore(attentionProjects.map((p) => p.arr));
  const totalArr = sumArrCrore(unionProjects.map((e) => e.project.arr));
  const totalMrr = totalArr / 12;

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">Revenue at Risk</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Projects at risk of missing go-live this month or needing attention
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <StatTile
          icon={TrendingDown}
          label="EGL at risk"
          arr={eglArr}
          count={eglProjects.length}
          tone="bg-warning-soft text-warning-strong"
        />
        <StatTile
          icon={AlertTriangle}
          label="Needs attention"
          arr={attentionArr}
          count={attentionProjects.length}
          tone="bg-destructive-soft text-destructive-strong"
        />
        <StatTile
          icon={Users}
          label="Combined exposure"
          arr={totalArr}
          count={unionProjects.length}
          tone="bg-muted text-foreground"
        />
      </div>

      {/* Project table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card table-header-tint">
            <TableRow className="hover:bg-muted/40 border-b">
              <TableHead className="font-semibold text-foreground">Project</TableHead>
              <TableHead className="font-semibold text-foreground whitespace-nowrap">EGL</TableHead>
              <TableHead className="font-semibold text-foreground whitespace-nowrap">ARR / MRR</TableHead>
              <TableHead className="font-semibold text-foreground whitespace-nowrap">Bucket</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unionProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No projects at risk right now.
                </TableCell>
              </TableRow>
            ) : (
              unionProjects.map(({ project, inEgl, inAttention }) => {
                const pArr = sumArrCrore([project.arr]);
                const pMrr = pArr / 12;
                const bucket =
                  inEgl && inAttention ? "Both" : inEgl ? "EGL" : "Attention";
                const bucketTone =
                  bucket === "Both"
                    ? "bg-destructive-soft text-destructive-strong"
                    : bucket === "EGL"
                      ? "bg-warning-soft text-warning-strong"
                      : "bg-destructive-soft/60 text-destructive-strong";
                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openProjectInNewTab(project.id)}
                  >
                    <TableCell className="font-medium text-xs">{project.merchantName}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      <GoLiveDate project={project} />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">{arrCroreValue(pArr)} Cr</span>
                      <span className="ml-1 text-2xs">/ {arrCroreValue(pMrr)} MRR</span>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${bucketTone}`}>
                        {bucket}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {unionProjects.length > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-2xs text-muted-foreground">
          <span className="font-medium text-foreground">{unionProjects.length} projects</span>
          <span>·</span>
          <span>Total ARR <span className="font-medium text-foreground">{arrCroreValue(totalArr)} Cr</span></span>
          <span>·</span>
          <span>MRR <span className="font-medium text-foreground">{arrCroreValue(totalMrr)} Cr</span></span>
        </div>
      )}
    </section>
  );
};
