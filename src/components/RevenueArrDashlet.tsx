import { useState, useCallback } from "react";
import { CheckCircle2, FolderKanban, ShieldAlert, Ban, GripVertical } from "lucide-react";
import { formatIndianRupees, sumArrCrore } from "@/lib/arr";
import type { Project } from "@/data/projectsData";
import type { RiskVerdict } from "@/data/riskRules";

const STORAGE_KEY = "revenue_dashlet_order";
const PIPELINE_STATES = new Set(["not_started", "on_hold", "in_progress"]);

interface TileDef {
  id: string;
  label: string;
  sublabel: string;
  icon: typeof CheckCircle2;
  arr: number;
  count: number;
  tone: string;
  iconTone: string;
  projects: Project[];
}

interface Props {
  projects: Project[];
  riskVerdicts: Record<string, RiskVerdict>;
  onDrillDown?: (title: string, projects: Project[]) => void;
}

function savedOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const RevenueArrDashlet = ({ projects, riskVerdicts, onDrillDown }: Props) => {
  const live = projects.filter((p) => p.projectState === "live");
  const pipeline = projects.filter((p) => PIPELINE_STATES.has(p.projectState));
  const atRisk = projects.filter((p) => riskVerdicts[p.id]?.level === "high");
  const blocked = projects.filter((p) => p.projectState === "blocked");

  const baseTiles: TileDef[] = [
    {
      id: "live",
      label: "Live ARR",
      sublabel: "Active, go-live complete",
      icon: CheckCircle2,
      arr: sumArrCrore(live.map((p) => p.arr)),
      count: live.length,
      tone: "bg-success-soft",
      iconTone: "text-success-strong",
      projects: live,
    },
    {
      id: "pipeline",
      label: "Pipeline ARR",
      sublabel: "Pre-sales · In Progress · On Hold",
      icon: FolderKanban,
      arr: sumArrCrore(pipeline.map((p) => p.arr)),
      count: pipeline.length,
      tone: "bg-pending-soft",
      iconTone: "text-pending-strong",
      projects: pipeline,
    },
    {
      id: "at_risk",
      label: "At-Risk ARR",
      sublabel: "High risk verdict, any state",
      icon: ShieldAlert,
      arr: sumArrCrore(atRisk.map((p) => p.arr)),
      count: atRisk.length,
      tone: "bg-destructive-soft",
      iconTone: "text-destructive-strong",
      projects: atRisk,
    },
    {
      id: "blocked",
      label: "Blocked ARR",
      sublabel: "Stalled, needs intervention",
      icon: Ban,
      arr: sumArrCrore(blocked.map((p) => p.arr)),
      count: blocked.length,
      tone: "bg-warning-soft",
      iconTone: "text-warning-strong",
      projects: blocked,
    },
  ];

  const initOrder = (): string[] => {
    const stored = savedOrder();
    if (stored && stored.length === baseTiles.length && stored.every((id) => baseTiles.some((t) => t.id === id))) {
      return stored;
    }
    return baseTiles.map((t) => t.id);
  };

  const [order, setOrder] = useState<string[]>(initOrder);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const tiles = order.map((id) => baseTiles.find((t) => t.id === id)!);

  const handleDragStart = useCallback((id: string) => setDragging(id), []);
  const handleDragOver = useCallback((id: string) => setDragOver(id), []);
  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragging || dragging === targetId) return;
      setOrder((prev) => {
        const next = [...prev];
        const from = next.indexOf(dragging);
        const to = next.indexOf(targetId);
        next.splice(from, 1);
        next.splice(to, 0, dragging);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      setDragging(null);
      setDragOver(null);
    },
    [dragging],
  );
  const handleDragEnd = useCallback(() => { setDragging(null); setDragOver(null); }, []);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">Revenue Overview</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">ARR by project state · drag to reorder</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map((tile) => {
          const mrr = tile.arr / 12;
          const isDragging = dragging === tile.id;
          const isOver = dragOver === tile.id && dragging !== tile.id;
          return (
            <div
              key={tile.id}
              draggable
              onDragStart={() => handleDragStart(tile.id)}
              onDragOver={(e) => { e.preventDefault(); handleDragOver(tile.id); }}
              onDrop={() => handleDrop(tile.id)}
              onDragEnd={handleDragEnd}
              className={[
                "group relative flex flex-col gap-2 bg-card px-4 py-3 transition-colors",
                isDragging ? "opacity-40" : "",
                isOver ? "ring-2 ring-inset ring-primary/40" : "",
              ].join(" ")}
            >
              {/* drag handle */}
              <GripVertical className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing" />

              <div className="flex items-center justify-between">
                <span className="text-2xs font-medium text-muted-foreground">{tile.label}</span>
                <span className={`flex h-6 w-6 items-center justify-center rounded-md ${tile.tone}`}>
                  <tile.icon className={`h-3.5 w-3.5 ${tile.iconTone}`} />
                </span>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => onDrillDown?.(tile.label, tile.projects)}
                  className="text-left"
                >
                  <p className="text-lg font-semibold tabular-nums leading-tight text-foreground">
                    {formatIndianRupees(tile.arr)}
                  </p>
                </button>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  MRR {formatIndianRupees(mrr)} · {tile.count} project{tile.count !== 1 ? "s" : ""}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground/60 italic">{tile.sublabel}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
