import { useState } from "react";
import { Project, calculateTimeFromChecklist, calculateProjectResponsibilityFromChecklist, formatDuration, projectStateLabels, projectStateColors, ProjectState, isProjectUnderIntegration, getProjectFunnelStage, funnelStageLabels } from "@/data/projectsData";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectDetailsDialog } from "./ProjectDetailsDialog";
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
}

const defaultPhaseConfig = {
  mint: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-blue-200/60 dark:border-blue-700/50",
    badge: "bg-blue-500 hover:bg-blue-600",
    accent: "text-blue-600 dark:text-blue-400"
  },
  integration: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-purple-200/60 dark:border-purple-700/50",
    badge: "bg-purple-500 hover:bg-purple-600",
    accent: "text-purple-600 dark:text-purple-400"
  },
  ms: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-emerald-200/60 dark:border-emerald-700/50",
    badge: "bg-emerald-500 hover:bg-emerald-600",
    accent: "text-emerald-600 dark:text-emerald-400"
  },
  completed: { 
    bg: "bg-card dark:bg-[hsl(222,18%,16%)]", 
    border: "border-gray-200/60 dark:border-gray-700/50",
    badge: "bg-gray-500 hover:bg-gray-600",
    accent: "text-gray-600 dark:text-gray-400"
  },
};

export const ProjectCardNew = ({ project }: ProjectCardNewProps) => {
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
  const phaseStyle = defaultPhaseConfig[project.currentPhase];

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

  // Can reject if pending and team is integration or ms (not mint, since mint is the first team)
  const canReject = isPending && (currentUser?.team === "integration" || currentUser?.team === "ms");
  const handleAccept = () => {
    acceptProject(project.id);
    toast.success(`Accepted ${project.merchantName}`);
  };

  const handleReject = (reason: string) => {
    rejectProject(project.id, reason);
    toast.success(`Rejected ${project.merchantName} — sent back for corrections`);
  };

  const handleTransfer = (assigneeId: string, assigneeName: string, notes: string) => {
    const nextTeamKey = project.currentOwnerTeam === "mint" ? "integration" : "ms";
    const nextTeam = teamLabels[nextTeamKey] || nextTeamKey;
    const transferNote = notes || `Transferred to ${nextTeam} team`;
    transferProject(project.id, `${transferNote} (Assigned to: ${assigneeName})`, assigneeId);
    toast.success(`Transferred ${project.merchantName} to ${assigneeName} (${nextTeam} team)`);
  };

  const handleSaveEdit = (updatedProject: Project) => {
    updateProject(updatedProject);
    toast.success("Project updated successfully");
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
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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
    if (computedResponsibility === "merchant") return { label: responsibilityLabels.merchant, icon: Users, color: "text-amber-600 bg-amber-500/10" };
    return { label: responsibilityLabels.neutral, icon: Clock, color: "text-muted-foreground bg-muted" };
  };

  const responsibility = getResponsibilityDisplay();

  return (
    <>
      <Card
        className="border border-sky-200 bg-sky-50/70 shadow-sm hover:bg-sky-100/70 hover:shadow-lg transition-all duration-300 overflow-hidden dark:border-sky-800 dark:bg-sky-950/30 dark:hover:bg-sky-950/45"
      >
        <CardContent className="p-0">
          <div>
            {/* Main project information */}
            <div className="p-5 pb-4">
              {/* Header Row */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      className="font-bold text-lg leading-tight text-foreground hover:text-primary hover:underline cursor-pointer transition-colors text-left"
                      onClick={(e) => { e.stopPropagation(); setActivityHistoryOpen(true); }}
                    >
                      {project.merchantName}
                    </button>
                    {isPending && (
                      <Badge className="bg-amber-500 text-white animate-pulse px-2 py-0.5 text-xs font-semibold">
                        <Sparkles className="h-3 w-3 mr-1" />
                        NEW
                      </Badge>
                    )}
                    {isRejected && (
                      <Badge className="bg-red-500 text-white px-2 py-0.5 text-xs font-semibold border border-red-600 animate-pulse">
                        <XCircle className="h-3 w-3 mr-1" />
                        REJECTED — Action Needed
                      </Badge>
                    )}
                    {!project.assignedOwner && project.notes.currentPhaseComment?.includes("needs manager review") && (
                      <Badge className="bg-orange-500 text-white px-2 py-0.5 text-xs font-semibold animate-pulse">
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
                      {(teamLabels[project.currentOwnerTeam] || project.currentPhase).toUpperCase()}
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
                        live: "bg-emerald-500 hover:bg-emerald-600 text-white",
                        under_integration: "bg-amber-500 hover:bg-amber-600 text-white",
                        pre_integration: "bg-sky-500 hover:bg-sky-600 text-white",
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
                      <SelectTrigger className="h-6 w-auto gap-1 rounded-full border border-blue-200 bg-white/70 px-2.5 py-0.5 text-xs font-medium text-slate-700 shadow-none focus:ring-0 dark:border-blue-800 dark:bg-blue-950/40 dark:text-slate-200">
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
                            className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs px-2.5 py-0.5 cursor-pointer"
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
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {/* ARR */}
                <div className="rounded-lg border border-sky-200/80 bg-white/45 p-2.5 dark:border-sky-800/60 dark:bg-sky-950/20">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                    <TrendingUp className="h-3 w-3" />
                    {getLabel("field_arr")}
                  </div>
                  <p className="text-sm font-bold text-foreground">{project.arr} Cr</p>
                </div>

                {/* Pending With */}
                <div className="rounded-lg border border-sky-200/80 bg-white/45 p-2.5 dark:border-sky-800/60 dark:bg-sky-950/20">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Pending With</div>
                  <div className={`flex items-center gap-1 font-semibold ${responsibility.color} px-1.5 py-0.5 rounded-md w-fit`}>
                    <responsibility.icon className="h-3.5 w-3.5" />
                    <span className="text-sm">{responsibility.label}</span>
                  </div>
                </div>

                {/* Time Tracked */}
                <div className="rounded-lg border border-sky-200/80 bg-white/45 p-2.5 dark:border-sky-800/60 dark:bg-sky-950/20">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                    <Clock className="h-3 w-3" />
                    Time
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold">
                    <span className="text-primary">{formatDuration(timeByParty.gokwik)}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-amber-500">{formatDuration(timeByParty.merchant)}</span>
                  </div>
                </div>

                {/* Checklist Team-wise */}
                <div className="rounded-lg border border-sky-200/80 bg-white/45 p-2.5 dark:border-sky-800/60 dark:bg-sky-950/20">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                    <ClipboardList className="h-3 w-3" />
                    Checklist
                  </div>
                  <div className="flex flex-col gap-0 text-xs font-semibold">
                    <div className="flex items-center gap-1">
                      <span className="text-blue-600 dark:text-blue-400">{mintCompleted}/{mintChecklist.length}</span>
                      <span className="text-muted-foreground/60 text-[10px]">{teamLabels.mint || "MINT"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-purple-600 dark:text-purple-400">{integrationCompleted}/{integrationChecklist.length}</span>
                      <span className="text-muted-foreground/60 text-[10px]">{teamLabels.integration || "Integration"}</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Card actions */}
            <div className="border-t border-sky-200/80 bg-sky-100/55 p-3 dark:border-sky-800/60 dark:bg-sky-950/25">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="gradient-primary w-full justify-center gap-2 h-9 border-0 text-xs text-primary-foreground shadow-sm hover:opacity-90"
                  onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                >
                  <FileText className="h-3.5 w-3.5" />
                  View Details
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="gradient-primary w-full justify-center gap-2 h-9 border-0 text-xs text-primary-foreground shadow-sm hover:opacity-90"
                  onClick={() => setChecklistOpen(true)}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  Open Checklist
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="gradient-primary w-full justify-center gap-2 h-9 border-0 text-xs text-primary-foreground shadow-sm hover:opacity-90"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Project
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gradient-primary w-full justify-center gap-2 h-9 border-0 text-xs text-primary-foreground shadow-sm hover:opacity-90"
                  onClick={() => setActivityHistoryOpen(true)}
                >
                  <Activity className="h-3.5 w-3.5" />
                  Activity History
                </Button>
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
                <><ListChecks className="h-5 w-5 text-cyan-600" /> AI Task Summary</>
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
