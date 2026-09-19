import { apiAuthHeaders } from "@/lib/api-invoke";
import { useState } from "react";
import { RiskBadge } from "./RiskBadge";
import type { RiskVerdict } from "@/data/riskRules";
import { Project, calculateTimeFromChecklist, calculateProjectResponsibilityFromChecklist, formatDuration, projectStateLabels, projectStateColors, ProjectState, isProjectUnderIntegration, getProjectFunnelStage, funnelStageLabels } from "@/data/projectsData";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectDialog } from "./ProjectDialog";
import { useNavigate } from "@tanstack/react-router";
import { ChecklistDialog } from "./ChecklistDialog";
import { EditProjectDialog } from "./EditProjectDialog";
import { TransferDialog } from "./TransferDialog";
import { AssignOwnerDialog } from "./AssignOwnerDialog";
import { RejectTransferDialog } from "./RejectTransferDialog";
import { ProjectActivityHistory } from "./ProjectActivityHistory";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Pencil,
  Building2,
  Users,
  ExternalLink,
  TrendingUp,
  FileText,
  ClipboardList,
  Sparkles,
  UserPlus,
  Calendar,
  Activity,
  User,
  Trash2,
  Brain,
  ListChecks,
  Loader2,
  XCircle,
} from "lucide-react";

interface ProjectCardNewProps {
  project: Project;
  /** Passed in by the list: one hook call per card would re-evaluate every project. */
  riskVerdict?: RiskVerdict;
}

const defaultPhaseConfig = {
  mint: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-info/60",
    badge: "bg-info hover:bg-info",
    accent: "text-info-strong"
  },
  integration: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-purple-200/60 dark:border-purple-700/50",
    badge: "bg-purple-500 hover:bg-purple-600",
    accent: "text-purple-600 dark:text-purple-400"
  },
  ms: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-success/60",
    badge: "bg-success hover:bg-success",
    accent: "text-success-strong"
  },
  completed: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-gray-200/60 dark:border-gray-700/50",
    badge: "bg-gray-500 hover:bg-gray-600",
    accent: "text-gray-600 dark:text-gray-400"
  },
};

export const ProjectCardNew = ({ project, riskVerdict }: ProjectCardNewProps) => {
  const { currentUser } = useAuth();
  const { acceptProject, transferProject, updateProject, deleteProject, rejectProject } = useProjects();
  const { teamLabels, responsibilityLabels, getLabel, stateLabels } = useLabels();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const navigate = useNavigate();
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogType, setAiDialogType] = useState<"insights" | "summary">("insights");
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Calculate checklist per team
  const mintChecklist = project.checklist.filter(c => c.ownerTeam === "mint");
  const integrationChecklist = project.checklist.filter(c => c.ownerTeam === "integration");
  
  const mintCompleted = mintChecklist.filter(c => c.completed).length;
  const integrationCompleted = integrationChecklist.filter(c => c.completed).length;
  
  const computedResponsibility = calculateProjectResponsibilityFromChecklist(project.checklist);
  const timeByParty = calculateTimeFromChecklist(project.checklist);

  // Dynamic colors from settings
  const badgeColor = getLabel(`color_team_${project.currentPhase}_badge`);
  const cardBgColor = getLabel(`color_card_${project.currentPhase}_bg`);
  const hasDynamicBadge = badgeColor.startsWith("#");
  const hasDynamicCardBg = cardBgColor.startsWith("#");
  const phaseStyle = defaultPhaseConfig[project.currentPhase] || defaultPhaseConfig.completed;
  const teamDisplayLabel = teamLabels[project.currentOwnerTeam] || project.currentPhase || "Project";

  // Find next incomplete checklist item title (Project Phase display)
  // First try to find next incomplete item from the current owner team, then fallback to any team
  const currentTeamItems = project.checklist.filter(c => c.ownerTeam === project.currentOwnerTeam);
  const nextIncompleteItem = currentTeamItems.find(c => !c.completed) || project.checklist.find(c => !c.completed);
  const projectPhaseDisplay = nextIncompleteItem ? nextIncompleteItem.title : "All Complete";

  // Check if all current team's checklist items are completed
  const currentTeamChecklist = project.checklist.filter(c => c.ownerTeam === project.currentOwnerTeam);
  const allCurrentTeamChecklistCompleted = currentTeamChecklist.length > 0 && 
    currentTeamChecklist.every(c => c.completed);

  // Check if this project was rejected back to the current owner
  const lastTransfer = project.transferHistory.length > 0 
    ? project.transferHistory[project.transferHistory.length - 1] 
    : null;
  const isRejected = lastTransfer?.notes?.startsWith("REJECTED:") && 
    !project.pendingAcceptance && 
    currentUser?.team === project.currentOwnerTeam &&
    currentUser?.id === project.assignedOwner;

  const canTransfer = currentUser?.team === project.currentOwnerTeam && 
    !project.pendingAcceptance && 
    project.currentPhase !== "completed" &&
    project.currentOwnerTeam !== "ms" &&
    currentUser?.team !== "manager";

  const isTransferReady = canTransfer && allCurrentTeamChecklistCompleted;

  const isPending = project.pendingAcceptance && currentUser?.team === project.currentOwnerTeam;

  // Any team can reject a pending project — it goes back to whoever sent it. If there is
  // nothing to send it back to, the mutation surfaces that as the error.
  const canReject = isPending;
  const handleAccept = () => {
    // The mutation reports its own success/failure.
    acceptProject(project.id);
  };

  const handleReject = (reason: string) => {
    // The mutation reports its own success/failure, including the real reason it failed.
    rejectProject(project.id, reason);
  };

  const handleTransfer = (assigneeId: string, assigneeName: string, notes: string) => {
    const nextTeamKey = project.currentOwnerTeam === "mint" ? "integration" : "ms";
    const nextTeam = teamLabels[nextTeamKey] || nextTeamKey;
    const transferNote = notes || `Transferred to ${nextTeam} team`;
    transferProject(project.id, `${transferNote} (Assigned to: ${assigneeName})`, assigneeId);
  };

  const handleSaveEdit = (updatedProject: Project) => {
    // The update hook only toasts on failure, so confirm here — but only once it has landed.
    updateProject(updatedProject, {
      onSuccess: () => toast.success("Project updated successfully"),
    });
  };

  const handleDelete = () => {
    deleteProject(project.id);
    setDeleteConfirmOpen(false);
  };

  const handleStateChange = (newState: ProjectState) => {
    updateProject({ ...project, projectState: newState });
  };

  const handleAiAction = async (type: "insights" | "summary") => {
    setAiDialogType(type);
    setAiDialogOpen(true);
    setAiLoading(true);
    setAiResult("");
    try {
      const response = await fetch(
        `/api/public/ai-project-insights`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await apiAuthHeaders()),
          },
          body: JSON.stringify({ project, type }),
        }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed with status ${response.status}`);
      }
      const data = await response.json();
      setAiResult(data.result || "No insights generated.");
    } catch (err: any) {
      console.error("AI action error:", err);
      setAiResult(`Failed to generate AI ${type === "insights" ? "insights" : "task summary"}. ${err.message || "Please try again."}`);
    } finally {
      setAiLoading(false);
    }
  };

  const getResponsibilityDisplay = () => {
    if (computedResponsibility === "gokwik") return { label: responsibilityLabels.gokwik, icon: Building2, color: "text-primary bg-primary/10" };
    if (computedResponsibility === "merchant") return { label: responsibilityLabels.merchant, icon: Users, color: "text-warning-strong bg-warning/10" };
    return { label: responsibilityLabels.neutral, icon: Clock, color: "text-muted-foreground bg-muted" };
  };

  const responsibility = getResponsibilityDisplay();

  return (
    <>
      <Card
        className="border border-slate-200 bg-slate-50/80 shadow-sm transition-all duration-300 overflow-hidden cursor-pointer hover:bg-white hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-900/70"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("button,a,input,label,select,textarea,[role='menuitem'],[role='dialog'],[data-radix-popper-content-wrapper]")) return;
          navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
        }}
      >
        <CardContent className="p-0">
          <div>
            {/* Main project information */}
            <div className="p-5 pb-4">
              {/* Header Row */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      className="font-bold text-lg leading-tight text-foreground hover:text-primary hover:underline cursor-pointer transition-colors text-left"
                      onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                    >
                      {project.merchantName}
                    </button>
                    <RiskBadge projectId={project.id} verdict={riskVerdict} />
                    {isPending && (
                      <Badge className="bg-warning text-warning-foreground animate-pulse px-2 py-0.5 text-xs font-semibold">
                        <Sparkles className="h-3 w-3 mr-1" />
                        NEW
                      </Badge>
                    )}
                    {isRejected && (
                      <Badge className="bg-destructive text-destructive-foreground px-2 py-0.5 text-xs font-semibold border border-destructive animate-pulse">
                        <XCircle className="h-3 w-3 mr-1" />
                        REJECTED — Action Needed
                      </Badge>
                    )}
                    {!project.assignedOwner && project.notes?.currentPhaseComment?.includes("needs manager review") && (
                      <Badge className="bg-warning text-warning-foreground px-2 py-0.5 text-xs font-semibold animate-pulse">
                        <UserPlus className="h-3 w-3 mr-1" />
                        NEEDS ASSIGNMENT
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <Badge
                      className={`${hasDynamicBadge ? '' : phaseStyle.badge} text-white text-xs px-2.5 py-0.5`}
                      style={hasDynamicBadge ? { backgroundColor: badgeColor } : undefined}
                    >
                      {teamDisplayLabel.toUpperCase()}
                    </Badge>
                    {project.assignedOwnerName && (
                      <Badge variant="outline" className="text-xs px-2.5 py-0.5 bg-muted/50">
                        <User className="h-3 w-3 mr-1" />
                        {project.assignedOwnerName}
                      </Badge>
                     )}
                    {(() => {
                      const stage = getProjectFunnelStage(project);
                      if (stage === "none") return null;
                      const cls: Record<string, string> = {
                        live: "bg-success hover:bg-success text-success-foreground",
                        under_integration: "bg-warning hover:bg-warning text-warning-foreground",
                        pre_integration: "bg-pending hover:bg-pending text-pending-foreground",
                        sales: "bg-violet-500 hover:bg-violet-600 text-white",
                      };
                      return (
                        <Badge className={`text-xs px-2.5 py-0.5 ${cls[stage]}`}>
                          {funnelStageLabels[stage]}
                        </Badge>
                      );
                    })()}
                    {project.links.brandUrl && (
                      <a href={project.links.brandUrl} target="_blank" rel="noopener noreferrer">
                        <Badge variant="outline" className="text-xs px-2.5 py-0.5 bg-muted/50 hover:bg-muted cursor-pointer">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Website
                        </Badge>
                      </a>
                    )}
                    <Select value={project.projectState} onValueChange={(val) => handleStateChange(val as ProjectState)}>
                      <SelectTrigger className={cn(
                        "h-6 w-auto gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-none focus:ring-0",
                        project.projectState === "live" && "border-success/30 bg-success-soft text-success-strong",
                        project.projectState === "in_progress" && "border-info/30 bg-info-soft text-info-strong",
                        project.projectState === "on_hold" && "border-warning/30 bg-warning-soft text-warning-strong",
                        project.projectState === "not_started" && "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
                        project.projectState === "blocked" && "border-destructive/30 bg-destructive-soft text-destructive-strong",
                      )}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(projectStateLabels).map(([key, label]) => (
                          <SelectItem key={key} value={key} className="text-xs">
                            {stateLabels[key] || label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(isPending || canTransfer) && (
                      isPending ? (
                        <>
                          <Badge
                            className="bg-success hover:bg-success text-success-foreground text-xs px-2.5 py-0.5 cursor-pointer"
                            onClick={handleAccept}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Accept
                          </Badge>
                          {canReject && (
                            <Badge
                              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs px-2.5 py-0.5 cursor-pointer"
                              onClick={() => setRejectOpen(true)}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Badge>
                          )}
                        </>
                      ) : (
                        <Button
                          size="sm"
                          className={`text-sm px-4 py-2 h-9 font-semibold rounded-lg transition-all duration-300 ${
                            isTransferReady 
                              ? "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 hover:scale-105 animate-fade-in" 
                              : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                          }`}
                          onClick={() => isTransferReady && setTransferOpen(true)}
                          disabled={!isTransferReady}
                          title={!allCurrentTeamChecklistCompleted ? "Complete all checklist items before transferring" : "Transfer to next team"}
                        >
                          <ArrowRight className={`h-4 w-4 mr-1.5 ${isTransferReady ? "animate-[slide-in-right_0.5s_ease-out]" : ""}`} />
                          Transfer
                        </Button>
                      )
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-slate-600 hover:bg-info-soft hover:text-info-strong dark:text-slate-300"
                    onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                    title="View details"
                    aria-label="View details"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-slate-600 hover:bg-info-soft hover:text-info-strong dark:text-slate-300"
                    onClick={() => setChecklistOpen(true)}
                    title="Open checklist"
                    aria-label="Open checklist"
                  >
                    <ClipboardList className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-slate-600 hover:bg-info-soft hover:text-info-strong dark:text-slate-300"
                    onClick={() => setEditOpen(true)}
                    title="Edit project"
                    aria-label="Edit project"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-slate-600 hover:bg-info-soft hover:text-info-strong dark:text-slate-300"
                    onClick={() => setActivityHistoryOpen(true)}
                    title="Activity history"
                    aria-label="Activity history"
                  >
                    <Activity className="h-4 w-4" />
                  </Button>
                </div>
              </div>

            </div>

          </div>
        </CardContent>
      </Card>

      {/* AI Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {aiDialogType === "insights" ? (
                <><Brain className="h-5 w-5 text-violet-600" /> AI Project Insights</>
              ) : (
                <><ListChecks className="h-5 w-5 text-info-strong" /> AI Task Summary</>
              )}
              <span className="text-sm font-normal text-muted-foreground">— {project.merchantName}</span>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="mt-2 pr-4">
              {aiLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Generating...
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                  {aiResult.split('\n').filter(line => line.trim()).map((line, i) => {
                    const cleaned = line.replace(/^\s*\*\s*/, '').replace(/^\s*-\s*/, '').trim();
                    if (!cleaned) return null;
                    // Check if line starts with bullet marker or bold marker
                    const isBullet = /^\s*[\*\-]/.test(line) || /^\*\*/.test(cleaned);
                    if (isBullet) {
                      return (
                        <div key={i} className="flex items-start gap-2 mb-3">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          <span dangerouslySetInnerHTML={{ __html: cleaned.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      );
                    }
                    return <p key={i} className="mb-3" dangerouslySetInnerHTML={{ __html: cleaned.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />;
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <ProjectDialog
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
        onSave={handleSaveEdit}
      />
      <TransferDialog
        project={project}
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onTransfer={handleTransfer}
      />
      <AssignOwnerDialog
        project={project}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
      <RejectTransferDialog
        project={project}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onReject={handleReject}
      />
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{project.merchantName}</strong>? This will permanently remove the project and all its checklist items, comments, and history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProjectActivityHistory
        projectId={project.id}
        projectName={project.merchantName}
        open={activityHistoryOpen}
        onOpenChange={setActivityHistoryOpen}
      />
    </>
  );
};
