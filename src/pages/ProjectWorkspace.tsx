import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useParams } from "@/lib/router-compat";
import { apiAuthHeaders } from "@/lib/api-invoke";
import { useProjectDeepLink, useScrollToAnchor } from "@/hooks/useProjectDeepLink";
import { LoginScreen } from "@/components/LoginScreen";
import { AssignOwnerDialog } from "@/components/AssignOwnerDialog";
import { ChecklistDialog } from "@/components/ChecklistDialog";
import { EditProjectDialog } from "@/components/EditProjectDialog";
import { TransferDialog } from "@/components/TransferDialog";
import { PortalLinkButton } from "@/components/PortalLinkButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import {
  Project,
  ProjectState,
  calculateProjectResponsibilityFromChecklist,
  formatDuration,
  getProjectFunnelStage,
  funnelStageLabels,
  projectStateLabels,
} from "@/data/projectsData";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import type { RiskVerdict } from "@/data/riskRules";
import { RiskBadge } from "@/components/RiskBadge";
import { formatGoLiveDate } from "@/components/GoLiveDate";
import { cn } from "@/lib/utils";
import { WorkspaceSkeleton } from "@/components/skeletons/WorkspaceSkeleton";
import { ProjectActivityHistoryPanel } from "@/components/ProjectActivityHistoryPanel";
import { JiraTicketsSection } from "@/components/JiraTicketsSection";
import { WorkspaceTasksPanel } from "@/components/project-workspace/WorkspaceTasksPanel";
import { WorkspaceMeetingsPanel } from "@/components/project-workspace/WorkspaceMeetingsPanel";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  IndianRupee,
  Link2,
  Mail,
  MoreHorizontal,
  Pencil,
  Share2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatArrCr } from "@/lib/arr";

type WorkspaceTab = "activity" | "checklists" | "jira" | "tasks" | "meetings";
type ActivityKind = "user" | "system" | "handoff" | "milestone";

const TAB_ORDER_KEY = "workspace_tab_order";

const readTabOrder = (): WorkspaceTab[] => {
  const all = tabOptions.map((t) => t.value);
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "[]") as WorkspaceTab[];
    const kept = saved.filter((v) => all.includes(v));
    return [...kept, ...all.filter((v) => !kept.includes(v))];
  } catch {
    return all;
  }
};

const PROJECT_STATES: ProjectState[] = ["not_started", "on_hold", "in_progress", "live", "blocked"];

interface ProjectWorkspaceProps {
  projectId?: string;
  inModal?: boolean;
  onClose?: () => void;
  projectIds?: string[];
  onNavigate?: (id: string) => void;
}

const tabOptions: Array<{ value: WorkspaceTab; label: string }> = [
  { value: "checklists", label: "Checklist" },
  { value: "tasks", label: "Tasks" },
  { value: "meetings", label: "Meetings" },
  { value: "activity", label: "Activity" },
  { value: "jira", label: "Jira" },
];

const stateDotClass: Record<ProjectState, string> = {
  not_started: "bg-muted-foreground/50",
  on_hold: "bg-warning",
  in_progress: "bg-info",
  live: "bg-success",
  blocked: "bg-destructive",
};

/** "11 Sep 2026" */
const friendlyDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/** "in 22 days", "today", "7 days late" */
const relativeDay = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return undefined;
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOfDay(then) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days late`;
};

export const ProjectWorkspaceView = ({ projectId: projectIdProp, inModal = false, onClose, projectIds, onNavigate }: ProjectWorkspaceProps) => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const projectId = projectIdProp || routeProjectId;
  const { isAuthenticated, isLoading, currentUser } = useAuth();
  const { projects, updateProject, deleteProject, transferProject } = useProjects();
  const { teamLabels, stateLabels } = useLabels();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("checklists");
  const [tabOrder, setTabOrder] = useState<WorkspaceTab[]>(() => tabOptions.map((t) => t.value));
  const [draggingTab, setDraggingTab] = useState<WorkspaceTab | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);

  const openTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (inModal || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  };

  const deepLink = useProjectDeepLink();

  useEffect(() => {
    const known = tabOptions.some((t) => t.value === deepLink.tab);
    if (known) setActiveTab(deepLink.tab as WorkspaceTab);
    else if (deepLink.item || deepLink.task || deepLink.comment) setActiveTab("checklists");
  }, [deepLink.tab, deepLink.item, deepLink.task, deepLink.comment]);

  useScrollToAnchor(
    deepLink.item ? `checklist-item-${deepLink.item}` : null,
    !deepLink.comment && !deepLink.task,
  );

  useEffect(() => setTabOrder(readTabOrder()), []);

  const moveTab = (from: WorkspaceTab, to: WorkspaceTab) => {
    if (from === to) return;
    setTabOrder((current) => {
      const next = current.filter((v) => v !== from);
      next.splice(next.indexOf(to), 0, from);
      try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();
  const { isLoading: projectsLoading } = useProjects();
  const navigate = useNavigate();

  if (isLoading || projectsLoading) return <WorkspaceSkeleton inModal={inModal} />;
  if (!isAuthenticated) return <LoginScreen />;

  if (!project) {
    return (
      <div className={cn("flex items-center justify-center bg-background px-6", inModal ? "min-h-full" : "min-h-screen")}>
        <Card className="w-full max-w-xl">
          <CardHeader><CardTitle>Project not found</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">This project could not be found in your current workspace.</p>
            {inModal ? <Button onClick={onClose}>Close</Button> : <Button asChild><Link to="/">Back to dashboard</Link></Button>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Computed project values ---
  const crossTeamRoles = ["manager", "admin", "super_admin", "superadmin"];
  const userTeamSlug = (currentUser?.team || "").toLowerCase();
  const currentTeamChecklist = project.checklist.filter((item) => item.ownerTeam === project.currentOwnerTeam && !item.isTask);
  const allCurrentTeamChecklistCompleted = currentTeamChecklist.length > 0 && currentTeamChecklist.every((item) => item.completed);
  const canTransfer =
    (userTeamSlug === project.currentOwnerTeam || crossTeamRoles.includes(userTeamSlug)) &&
    !project.pendingAcceptance &&
    project.currentPhase !== "completed" &&
    project.currentOwnerTeam !== "ms";
  const isTransferReady = canTransfer && allCurrentTeamChecklistCompleted;
  const canAssignOwner = crossTeamRoles.includes(userTeamSlug);
  const openCurrentTeamItems = currentTeamChecklist.filter((item) => !item.completed).length;
  const transferBlockedReason = isTransferReady
    ? null
    : project.pendingAcceptance
      ? "The receiving team hasn't accepted the last handover yet"
      : project.currentPhase === "completed"
        ? "This project is complete"
        : project.currentOwnerTeam === "ms"
          ? `${teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam} is the last team`
          : !canTransfer
            ? "Only this team, or a manager, can transfer it"
            : `${openCurrentTeamItems} checklist item${openCurrentTeamItems === 1 ? "" : "s"} still open for ${teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam}`;

  const riskVerdict = riskVerdicts[project.id];
  const isAtRisk = riskVerdict?.level === "high";

  // Progress: groups with all items done / total groups
  const checklistItems = project.checklist.filter((i) => !i.isTask);
  const groupedForProgress = checklistItems.reduce((acc, item) => {
    const key = (item.ownerTeam || "").toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, typeof checklistItems>);
  const totalGroups = Object.keys(groupedForProgress).length;
  const completedGroups = Object.values(groupedForProgress).filter((items) => items.every((i) => i.completed)).length;
  const progressPct = totalGroups > 0 ? Math.round((completedGroups / totalGroups) * 100) : 0;

  const goLiveText = formatGoLiveDate(project, friendlyDate, "Not set");
  const goLiveDays = relativeDay(project.dates.expectedGoLiveDate);

  const handleSendMagicLink = async () => {
    if (!project.contactEmail) {
      toast.error("No contact email set", { description: "Add contact email in Edit Project first." });
      return;
    }
    setSendingMagic(true);
    try {
      const response = await fetch("/api/public/merchant-portal-data/send-magic-link", {
        method: "POST",
        headers: await apiAuthHeaders(),
        body: JSON.stringify({ project_id: project.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Failed");
      toast.success("Magic link sent!", { description: `Sent to ${result.sent_to}` });
    } catch (error: any) {
      toast.error("Failed to send magic link", { description: error.message });
    } finally {
      setSendingMagic(false);
    }
  };

  const handleSaveEdit = (updatedProject: Project) => {
    updateProject(updatedProject, { onSuccess: () => toast.success("Project updated successfully") });
  };

  const handleDelete = () => {
    deleteProject(project.id);
    setDeleteConfirmOpen(false);
  };

  const handleTransfer = (assigneeId: string, assigneeName: string, notes: string) => {
    const nextTeamKey = project.currentOwnerTeam === "mint" ? "integration" : "ms";
    const nextTeam = teamLabels[nextTeamKey] || nextTeamKey;
    transferProject(project.id, `${notes || `Transferred to ${nextTeam} team`} (Assigned to: ${assigneeName})`, assigneeId);
  };

  const handleStateChange = (newState: ProjectState) => {
    updateProject({ ...project, projectState: newState }, {
      onSuccess: () => toast.success(`Project state updated to ${projectStateLabels[newState]}`),
    });
  };

  return (
    <div className={cn("flex flex-col overflow-hidden bg-background", inModal ? "h-full rounded-lg border border-border" : "h-screen")}>
      <Tabs value={activeTab} onValueChange={(v) => openTab(v as WorkspaceTab)} className="flex flex-col flex-1 overflow-hidden">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border bg-card">
          <div className="mx-auto max-w-[1680px] px-5">

            {/* Row 1: breadcrumb + name + actions */}
            <div className="flex items-start justify-between gap-3 pt-3 pb-1">
              <div className="min-w-0 flex-1">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  {inModal ? (
                    <button type="button" onClick={onClose} className="hover:text-foreground">Projects</button>
                  ) : (
                    <Link to="/projects/list" className="hover:text-foreground">Projects</Link>
                  )}
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground/80 truncate max-w-[40vw]">{project.merchantName}</span>
                </div>
                {/* Name row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="heading-page text-foreground truncate max-w-[36vw]">{project.merchantName}</h1>
                  <RiskBadge projectId={project.id} verdict={riskVerdicts[project.id]} />
                  {/* Prev/Next in modal */}
                  {inModal && projectIds && projectIds.length > 1 && onNavigate && (() => {
                    const idx = projectIds.indexOf(project.id);
                    return (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={idx <= 0} onClick={() => idx > 0 && onNavigate(projectIds[idx - 1])}>
                          <ArrowLeft className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-muted-foreground tabular-nums">{idx + 1}/{projectIds.length}</span>
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={idx >= projectIds.length - 1} onClick={() => idx < projectIds.length - 1 && onNavigate(projectIds[idx + 1])}>
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Right actions */}
              <div className="flex items-center gap-1.5 shrink-0 pt-4">
                {inModal && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="h-8 gap-1.5 bg-navy px-3 text-sm font-semibold text-primary-foreground hover:bg-navy/90">
                      <Share2 className="h-3.5 w-3.5" />
                      Customer access
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => void handleSendMagicLink()} disabled={sendingMagic}>
                      <Mail className="mr-2 h-3.5 w-3.5" />
                      {sendingMagic ? "Sending…" : "Email a sign-in link"}
                    </DropdownMenuItem>
                    <PortalLinkButton
                      projectId={project.id}
                      renderTrigger={(open, isWorking) => (
                        <DropdownMenuItem disabled={isWorking} onSelect={(e) => { e.preventDefault(); open(); }}>
                          <Link2 className="mr-2 h-3.5 w-3.5" />
                          Copy portal link
                        </DropdownMenuItem>
                      )}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" className="h-8 gap-1.5 bg-navy px-3 text-sm font-semibold text-primary-foreground hover:bg-navy/90" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit project
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canAssignOwner && (
                      <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
                        <UserRound className="mr-2 h-3.5 w-3.5" />
                        Assign owner
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => isTransferReady && setTransferOpen(true)}
                      disabled={!isTransferReady}
                      title={transferBlockedReason || undefined}
                    >
                      <ArrowRight className="mr-2 h-3.5 w-3.5" />
                      Transfer project
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDeleteConfirmOpen(true)} className="text-destructive focus:text-destructive">
                      Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Row 2: metadata strip + progress */}
            <div className="flex items-center gap-x-4 gap-y-0.5 py-1.5 text-sm flex-wrap">
              {/* State */}
              <span className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", stateDotClass[project.projectState])} />
                <span className="text-foreground font-medium">{stateLabels?.[project.projectState] || projectStateLabels[project.projectState]}</span>
              </span>
              {/* Go-live */}
              {project.dates.expectedGoLiveDate && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Expected go-live: <span className="text-foreground">{goLiveText}</span>
                  {goLiveDays && <span className="text-xs text-muted-foreground">({goLiveDays})</span>}
                </span>
              )}
              {/* Revenue */}
              <span className="flex items-center gap-1 text-muted-foreground">
                <IndianRupee className="h-3.5 w-3.5" />
                Revenue: <span className="text-foreground">₹{formatArrCr(project.arr)}</span>
              </span>
              {/* Owner */}
              <span className="flex items-center gap-1 text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
                Owner: <span className="text-foreground">{project.assignedOwnerName || "Unassigned"}</span>
              </span>

              {/* Progress — pushed to the right */}
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span>Project progress</span>
                <span className="font-medium text-foreground tabular-nums">{completedGroups}/{totalGroups} stages</span>
                <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="font-medium text-foreground tabular-nums">{progressPct}%</span>
              </div>
            </div>

            {/* Row 3: navigation tabs */}
            <div className="-mb-px">
              <TabsList className="h-auto gap-0 rounded-none bg-transparent p-0">
                {tabOrder.map((value) => {
                  const tab = tabOptions.find((t) => t.value === value);
                  if (!tab) return null;
                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      draggable
                      onDragStart={() => setDraggingTab(tab.value)}
                      onDragEnd={() => setDraggingTab(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); if (draggingTab) moveTab(draggingTab, tab.value); setDraggingTab(null); }}
                      title="Drag to reorder"
                      className={cn(
                        "cursor-grab rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-foreground/60 active:cursor-grabbing",
                        "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
                        "dark:text-muted-foreground dark:data-[state=active]:text-foreground",
                        draggingTab === tab.value && "opacity-50",
                      )}
                    >
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        </div>

        {/* ── BODY ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden bg-background">
          <TabsContent value="checklists" className="m-0 h-full">
            <ChecklistDialog
              project={project}
              open={true}
              onOpenChange={() => undefined}
              variant="inline"
              onEditProject={() => setEditOpen(true)}
              onAssignOwner={canAssignOwner ? () => setAssignOpen(true) : undefined}
            />
          </TabsContent>

          <TabsContent value="activity" className="m-0 h-full">
            <ProjectActivityHistoryPanel projectId={project.id} />
          </TabsContent>

          <TabsContent value="jira" className="m-0 h-full overflow-y-auto p-4">
            <div className="h-full rounded-xl border border-border/60 bg-card/80 p-4">
              <JiraTicketsSection projectId={project.id} merchantName={project.merchantName} />
            </div>
          </TabsContent>

          <TabsContent value="tasks" className="m-0 h-full">
            <WorkspaceTasksPanel project={project} />
          </TabsContent>

          <TabsContent value="meetings" className="m-0 h-full">
            <WorkspaceMeetingsPanel project={project} />
          </TabsContent>
        </div>

      </Tabs>

      {/* ── DIALOGS ──────────────────────────────────────────────────────── */}
      <EditProjectDialog project={project} open={editOpen} onOpenChange={setEditOpen} onSave={handleSaveEdit} />
      <AssignOwnerDialog project={project} open={assignOpen} onOpenChange={setAssignOpen} />
      <TransferDialog project={project} open={transferOpen} onOpenChange={setTransferOpen} onTransfer={handleTransfer} />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{project.merchantName}</strong>? This action cannot be undone.
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
    </div>
  );
};

const ProjectWorkspace = () => <ProjectWorkspaceView />;
export default ProjectWorkspace;
