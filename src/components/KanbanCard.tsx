import { Project, ProjectState, projectStateLabels, projectStateColors, getProjectFunnelStage } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjects } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ListChecks, Calendar, User, Check, X, Headset, Pencil, TrendingUp, Timer, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ProjectDetailsDialog } from "./ProjectDetailsDialog";
import { RiskBadge } from "./RiskBadge";
import type { RiskVerdict } from "@/data/riskRules";
import { ChecklistDialog } from "./ChecklistDialog";
import { ProjectActivityHistory } from "./ProjectActivityHistory";
import { EditProjectDialog } from "./EditProjectDialog";
import { formatArrCr } from "@/lib/arr";


// riskVerdict is passed in rather than looked up here: the board renders one
// card per project, and each hook call would re-evaluate the whole portfolio.
export const KanbanCard = ({ project, csmName, riskVerdict }: { project: Project; csmName?: string; riskVerdict?: RiskVerdict }) => {
  const navigate = useNavigate();
  const { stateLabels, getLabel } = useLabels();
  const { updateProject } = useProjects();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);


  const stateLabel =
    stateLabels[project.projectState] ||
    projectStateLabels[project.projectState] ||
    project.projectState;

  const arrDisplay = formatArrCr(project.arr);

  const completedChecklist = project.checklist.filter(c => c.completed).length;
  const totalChecklist = project.checklist.length;

  const isLive = project.projectState === "live";
  const goLiveDate = project.dates?.goLiveDate
    ? new Date(project.dates.goLiveDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const expectedGoLive = project.dates?.expectedGoLiveDate
    ? new Date(project.dates.expectedGoLiveDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;


  // TAT: from Kickoff → Actual Go-Live (if live) or today (in-flight)
  const tatInfo = (() => {
    const kick = project.dates?.kickOffDate;
    if (!kick) return null;
    const start = new Date(kick);
    if (isNaN(start.getTime())) return null;
    const isLive = project.projectState === "live" && project.dates?.goLiveDate;
    const end = isLive ? new Date(project.dates!.goLiveDate!) : new Date();
    if (isNaN(end.getTime()) || end < start) return null;
    const MS = 86400_000;
    const actual = Math.max(0, Math.round((end.getTime() - start.getTime()) / MS));
    let net = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) net++;
      cur.setDate(cur.getDate() + 1);
    }
    return { actual, net, isLive };
  })();

  return (
    <>
      <div
        className="rounded-md border bg-card p-3 space-y-2 shadow-sm text-xs cursor-pointer transition-colors hover:border-primary/40"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("button,a,input,label,[role='menuitem']")) return;
          navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { from: "kanban" } });
        }}
      >
        <div className="flex items-start gap-2">
          <button
            className="font-semibold text-sm truncate text-left flex-1 min-w-0 hover:text-primary hover:underline cursor-pointer transition-colors"
            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { from: "kanban" } })}
          >
            {project.merchantName}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
            className="shrink-0 p-1 -m-1 rounded text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            title="Edit project"
            aria-label="Edit project"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>


        <div className="flex items-center gap-1.5 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="focus:outline-none focus:ring-2 focus:ring-ring rounded"
                title="Change project state"
              >
                <Badge className={cn("text-[10px] px-1.5 py-0 cursor-pointer inline-flex items-center gap-0.5", projectStateColors[project.projectState])}>
                  {stateLabel}
                  <ChevronDown className="h-2.5 w-2.5" />
                </Badge>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuLabel className="text-xs">Change state</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(projectStateLabels) as ProjectState[]).map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === project.projectState}
                  onClick={() => {
                    updateProject({ ...project, projectState: s });
                    toast.success(`State changed to ${stateLabels[s] || projectStateLabels[s]}`);
                  }}
                  className="text-xs"
                >
                  <Badge className={cn("text-[10px] px-1.5 py-0 mr-2", projectStateColors[s])}>
                    {stateLabels[s] || projectStateLabels[s]}
                  </Badge>
                  {s === project.projectState && <Check className="h-3 w-3 ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <RiskBadge verdict={riskVerdict} />
        </div>

        <div className="text-muted-foreground">
          {getLabel("field_arr")}: <span className="font-medium text-foreground">{arrDisplay}</span>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{isLive ? "Actual Go-Live:" : "Expected Go-Live:"}</span>
          <span className={cn("font-medium", (isLive ? goLiveDate : expectedGoLive) ? "text-foreground" : "text-muted-foreground/60 italic")}>
            {(isLive ? goLiveDate : expectedGoLive) || "Not set"}
          </span>
        </div>


        <div className="flex items-center gap-1.5 text-muted-foreground">
          <User className="h-3 w-3" />
          <span>Owner:</span>
          <span className={cn("font-medium", project.assignedOwnerName ? "text-foreground" : "text-muted-foreground/60 italic")}>
            {project.assignedOwnerName || "Unassigned"}
          </span>
        </div>

        {tatInfo && (
          <div
            className="flex items-center gap-1.5 text-muted-foreground"
            title={tatInfo.isLive ? "Kickoff → Actual Go-Live" : "Kickoff → today (in flight)"}
          >
            <Timer className="h-3 w-3" />
            <span>TAT:</span>
            <span className="font-medium text-foreground">{tatInfo.net}d</span>
            <span className="text-muted-foreground/70">net</span>
            {!tatInfo.isLive && (
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60 ml-0.5">so far</span>
            )}
          </div>
        )}

        {getProjectFunnelStage(project) === "under_integration" && (() => {
          const findItem = (needle: string) =>
            project.checklist.find(c => !c.isTask && c.title.toLowerCase().includes(needle.toLowerCase()));
          const pg = findItem("PG Onboarding");
          const db = findItem("Dashboard Walkthrough");
          const StatusPill = ({ label, done }: { label: string; done: boolean | undefined }) => (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1",
                done
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20"
                  : "bg-muted text-muted-foreground ring-border"
              )}
              title={done ? `${label}: Yes` : `${label}: No`}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
              {label}
            </span>
          );
          return (
            <div className="space-y-1 pt-1 border-t border-dashed">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Headset className="h-3 w-3" />
                <span>CSM:</span>
                <span className={cn("font-medium truncate", csmName ? "text-foreground" : "text-muted-foreground/60 italic")}>
                  {csmName || "Unassigned"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <StatusPill label="PG Onboarding" done={!!pg?.completed} />
                <StatusPill label="DB Walkthrough" done={!!db?.completed} />
              </div>
            </div>
          );
        })()}

        {getProjectFunnelStage(project) === "live" && (() => {
          const pct = Math.max(0, Math.min(100, Number(project.goLivePercent) || 0));
          return (
            <div className="pt-1 border-t border-dashed">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                <span>Go Live:</span>
                <span className="font-medium text-foreground">{pct}%</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden ml-1">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })()}




        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-primary"
            onClick={() => setChecklistOpen(true)}
          >
            <ListChecks className="h-3 w-3" />
            {completedChecklist}/{totalChecklist}
          </Button>
        </div>
      </div>

      <ProjectDetailsDialog
        project={project}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
      <ChecklistDialog
        project={project}
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
      />
      <EditProjectDialog
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={(updated) => { updateProject(updated); toast.success("Project updated"); }}
      />
      <ProjectActivityHistory
        projectId={project.id}
        projectName={project.merchantName}
        open={activityHistoryOpen}
        onOpenChange={setActivityHistoryOpen}
      />
    </>

  );
};
