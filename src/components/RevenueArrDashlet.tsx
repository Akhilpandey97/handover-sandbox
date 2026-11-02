import { CheckCircle2, FolderKanban, ShieldAlert, Ban } from "lucide-react";
import { formatCr, sumArrCrore } from "@/lib/arr";
import type { Project } from "@/data/projectsData";
import type { RiskVerdict } from "@/data/riskRules";

interface Tile {
  label: string;
  icon: typeof CheckCircle2;
  arr: number;
  count: number;
  tone: string;
  iconTone: string;
}

interface Props {
  projects: Project[];
  riskVerdicts: Record<string, RiskVerdict>;
  onDrillDown?: (title: string, projects: Project[]) => void;
}

export const RevenueArrDashlet = ({ projects, riskVerdicts, onDrillDown }: Props) => {
  const live = projects.filter((p) => p.projectState === "live");
  const pipeline = projects.filter((p) => p.projectState === "in_progress");
  const atRisk = projects.filter((p) => riskVerdicts[p.id]?.level === "high");
  const blocked = projects.filter((p) => p.projectState === "blocked");

  const tiles: Tile[] = [
    {
      label: "Live ARR",
      icon: CheckCircle2,
      arr: sumArrCrore(live.map((p) => p.arr)),
      count: live.length,
      tone: "bg-success-soft",
      iconTone: "text-success-strong",
    },
    {
      label: "Pipeline ARR",
      icon: FolderKanban,
      arr: sumArrCrore(pipeline.map((p) => p.arr)),
      count: pipeline.length,
      tone: "bg-pending-soft",
      iconTone: "text-pending-strong",
    },
    {
      label: "At-Risk ARR",
      icon: ShieldAlert,
      arr: sumArrCrore(atRisk.map((p) => p.arr)),
      count: atRisk.length,
      tone: "bg-destructive-soft",
      iconTone: "text-destructive-strong",
    },
    {
      label: "Blocked ARR",
      icon: Ban,
      arr: sumArrCrore(blocked.map((p) => p.arr)),
      count: blocked.length,
      tone: "bg-warning-soft",
      iconTone: "text-warning-strong",
    },
  ];

  const tileProjects: Record<string, Project[]> = {
    "Live ARR": live,
    "Pipeline ARR": pipeline,
    "At-Risk ARR": atRisk,
    "Blocked ARR": blocked,
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">Revenue Overview</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">ARR and MRR by project state</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map((tile) => {
          const mrr = tile.arr / 12;
          return (
            <button
              key={tile.label}
              type="button"
              onClick={() => onDrillDown?.(tile.label, tileProjects[tile.label] ?? [])}
              className="flex flex-col gap-2 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xs font-medium text-muted-foreground">{tile.label}</span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md ${tile.tone}`}
                >
                  <tile.icon className={`h-3.5 w-3.5 ${tile.iconTone}`} />
                </span>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums leading-tight text-foreground">
                  {formatCr(tile.arr)} Cr
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  MRR {formatCr(mrr)} Cr · {tile.count} project{tile.count !== 1 ? "s" : ""}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
