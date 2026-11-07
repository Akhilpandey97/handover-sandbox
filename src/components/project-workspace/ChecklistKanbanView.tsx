import { useState } from "react";
import { Project, ProjectChecklist } from "@/data/projectsData";
import { useUpdateChecklistItem } from "@/hooks/useUpdateChecklistItem";
import { useLabels } from "@/contexts/LabelsContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, MessageSquare, CheckSquare2, X } from "lucide-react";
import { format, parseISO } from "date-fns";

interface Props {
  project: Project;
}

type KanbanStage = "mint" | "integration" | "ms" | "completed";

const COLUMN_COLORS: Record<KanbanStage, string> = {
  mint: "bg-emerald-500/10 border-emerald-500/30",
  integration: "bg-blue-500/10 border-blue-500/30",
  ms: "bg-amber-500/10 border-amber-500/30",
  completed: "bg-slate-500/10 border-slate-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const RESPONSIBILITY_LABELS: Record<string, string> = {
  gokwik: "GoKwik",
  merchant: "Merchant",
  neutral: "Neutral",
};

function formatDate(d?: string) {
  if (!d) return null;
  try { return format(parseISO(d), "MMM d"); } catch { return d; }
}

function KanbanCard({
  item,
  teamLabel,
  onDragStart,
}: {
  item: ProjectChecklist;
  teamLabel: string;
  onDragStart: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(item.id)}
      className="rounded-lg border bg-card p-3 shadow-sm cursor-grab hover:shadow-md transition-shadow space-y-1.5"
    >
      <p className="text-sm font-medium leading-tight">{item.title}</p>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-2xs px-1.5 py-0">
          {teamLabel}
        </Badge>
        {item.status && (
          <span className={`rounded px-1.5 py-0 text-2xs font-medium ${STATUS_COLORS[item.status] || ""}`}>
            {item.status.replace("_", " ")}
          </span>
        )}
      </div>

      {(item.startDate || item.dueDate) && (
        <div className="flex items-center gap-1 text-2xs text-muted-foreground">
          <CalendarDays className="h-3 w-3 flex-shrink-0" />
          {formatDate(item.startDate) && <span>{formatDate(item.startDate)}</span>}
          {item.startDate && item.dueDate && <span>→</span>}
          {formatDate(item.dueDate) && <span>{formatDate(item.dueDate)}</span>}
        </div>
      )}

      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-0.5">
          <CheckSquare2 className="h-3 w-3" />
          {item.currentResponsibility}
        </span>
        <span className="flex items-center gap-0.5">
          <MessageSquare className="h-3 w-3" />
          {item.comment ? "1" : "0"}
        </span>
      </div>
    </div>
  );
}

export function ChecklistKanbanView({ project }: Props) {
  const updateItem = useUpdateChecklistItem(project.id);
  const { stageLabels, teamLabels } = useLabels();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStage | null>(null);

  const COLUMNS = (["mint", "integration", "ms", "completed"] as KanbanStage[]).map((key) => ({
    key,
    label: stageLabels[key] || key,
    color: COLUMN_COLORS[key],
  }));

  // §6.2 Filter state
  const allTeams = [...new Set(project.checklist.filter(i => !i.isTask).map(i => i.ownerTeam))];
  const [filterTeams, setFilterTeams] = useState<string[]>([]);
  const [filterResponsibility, setFilterResponsibility] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);

  const hasFilters = filterTeams.length > 0 || filterResponsibility !== null || !showCompleted;

  function clearFilters() {
    setFilterTeams([]);
    setFilterResponsibility(null);
    setShowCompleted(true);
  }

  function toggleTeam(team: string) {
    setFilterTeams(prev =>
      prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]
    );
  }

  const baseItems = project.checklist.filter((i) => !i.isTask);

  const filteredItems = baseItems.filter(item => {
    if (filterTeams.length > 0 && !filterTeams.includes(item.ownerTeam)) return false;
    if (filterResponsibility && item.currentResponsibility !== filterResponsibility) return false;
    if (!showCompleted && item.completed) return false;
    return true;
  });

  function handleDrop(stage: KanbanStage) {
    if (!draggingId) return;
    const item = baseItems.find((i) => i.id === draggingId);
    if (!item || item.stage === stage) {
      setDraggingId(null);
      setDragOverCol(null);
      return;
    }
    updateItem.mutate({
      id: draggingId,
      patch: {
        stage,
        ...(stage === "completed"
          ? { status: "done", completed: true, completed_at: new Date().toISOString() }
          : item.status === "done"
          ? { status: "todo", completed: false, completed_at: null }
          : {}),
      },
    });
    setDraggingId(null);
    setDragOverCol(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* §6.2 Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background/95 flex-shrink-0">
        <span className="text-xs text-muted-foreground font-medium">Filter:</span>

        {/* Team filter */}
        {allTeams.map(team => (
          <button
            key={team}
            type="button"
            onClick={() => toggleTeam(team)}
            className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${
              filterTeams.includes(team)
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {teamLabels[team] || team}
          </button>
        ))}

        <span className="h-3.5 w-px bg-border/60" />

        {/* Responsibility filter */}
        {["gokwik", "merchant", "neutral"].map(resp => (
          <button
            key={resp}
            type="button"
            onClick={() => setFilterResponsibility(filterResponsibility === resp ? null : resp)}
            className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${
              filterResponsibility === resp
                ? "bg-amber-500 text-white border-amber-500"
                : "border-border text-muted-foreground hover:border-amber-400/40"
            }`}
          >
            {RESPONSIBILITY_LABELS[resp]}
          </button>
        ))}

        <span className="h-3.5 w-px bg-border/60" />

        {/* Show completed toggle */}
        <button
          type="button"
          onClick={() => setShowCompleted(prev => !prev)}
          className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${
            !showCompleted
              ? "bg-slate-500 text-white border-slate-500"
              : "border-border text-muted-foreground hover:border-slate-400/40"
          }`}
        >
          {showCompleted ? "Hide completed" : "Show completed"}
        </button>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-2xs text-muted-foreground gap-0.5 ml-1"
            onClick={clearFilters}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}

        {hasFilters && (
          <span className="ml-auto text-2xs text-muted-foreground">
            {filteredItems.length} of {baseItems.length} items
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 flex-1 overflow-x-auto p-3 pb-2">
        {COLUMNS.map((col) => {
          const colItems = filteredItems.filter((i) => (i.stage as string) === col.key);
          const isOver = dragOverCol === col.key;
          return (
            <div
              key={col.key}
              className={`flex flex-col rounded-xl border p-3 min-w-[220px] flex-1 transition-colors ${col.color} ${isOver ? "ring-2 ring-primary/40" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => handleDrop(col.key)}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
                <span className="text-xs text-muted-foreground font-medium">{colItems.length}</span>
              </div>
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                {colItems.map((item) => (
                  <KanbanCard key={item.id} item={item} teamLabel={teamLabels[item.ownerTeam] || item.ownerTeam} onDragStart={setDraggingId} />
                ))}
                {colItems.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/50 italic py-4">
                    Drop items here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
