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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import {
  Project,
  ProjectState,
  calculateProjectResponsibilityFromChecklist,
  calculateTimeFromChecklist,
  formatDuration,
  getProjectFunnelStage,
  funnelStageLabels,
  projectStateLabels,
} from "@/data/projectsData";
import { fetchAiInsights } from "@/utils/aiInsights";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import type { RiskVerdict } from "@/data/riskRules";
import { RiskBadge } from "@/components/RiskBadge";
import { formatGoLiveDate } from "@/components/GoLiveDate";
import { cn } from "@/lib/utils";
import { WorkspaceSkeleton } from "@/components/skeletons/WorkspaceSkeleton";
import { ProjectActivityHistoryPanel } from "@/components/ProjectActivityHistoryPanel";
import { JiraTicketsSection } from "@/components/JiraTicketsSection";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  ExternalLink,
  FileStack,
  Globe,
  Loader2,
  ListTodo,
  Mail,
  MessageSquareText,
  Pencil,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatArrCr } from "@/lib/arr";

type WorkspaceTab = "activity" | "checklists" | "jira";
type ActivityKind = "user" | "system" | "handoff" | "milestone";

const PROJECT_STATES: ProjectState[] = ["not_started", "on_hold", "in_progress", "live", "blocked"];

interface ProjectWorkspaceProps {
  projectId?: string;
  inModal?: boolean;
  onClose?: () => void;
  projectIds?: string[];
  onNavigate?: (id: string) => void;
}

interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string;
  actor: string;
  source: string;
  timestamp: number;
  timestampLabel: string;
  dateLabel: string;
}

interface RiskDriver {
  label: string;
  points: number;
}

interface RiskAssessment {
  score: number;
  label: "Low risk" | "Medium risk" | "High risk";
  tone: string;
  drivers: RiskDriver[];
}

const tabOptions: Array<{ value: WorkspaceTab; label: string }> = [
  { value: "checklists", label: "Checklist" },
  { value: "activity", label: "Activity" },
  { value: "jira", label: "Jira" },
];

// Project states use the theme's status tokens, so they read the same as
// everywhere else in the product and switch with dark mode.
const stateToneMap: Record<ProjectState, string> = {
  not_started: "bg-muted text-muted-foreground border-border",
  on_hold: "bg-warning-soft text-warning-strong border-warning/30",
  in_progress: "bg-info-soft text-info-strong border-info/30",
  live: "bg-success-soft text-success-strong border-success/30",
  blocked: "bg-destructive-soft text-destructive-strong border-destructive/30",
};

const stateSelectToneMap: Record<ProjectState, string> = stateToneMap;

const activityToneMap: Record<ActivityKind, string> = {
  user: "bg-success",
  system: "bg-slate-500",
  handoff: "bg-info",
  milestone: "bg-warning",
};

const activityBadgeToneMap: Record<ActivityKind, string> = {
  user: "bg-success-soft text-success-strong border-success/30",
  system: "bg-muted text-muted-foreground border-border",
  handoff: "bg-info-soft text-info-strong border-info/30",
  milestone: "bg-warning-soft text-warning-strong border-warning/30",
};

const formatDateTime = (value?: string) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    timestamp: date.getTime(),
    timestampLabel: new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
    dateLabel: new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date),
  };
};

const buildActivityFeed = (project: Project): ActivityEntry[] => {
  const items: ActivityEntry[] = [];

  const pushEvent = (
    id: string,
    kind: ActivityKind,
    title: string,
    description: string,
    actor: string,
    source: string,
    date?: string,
  ) => {
    const parsed = formatDateTime(date);
    if (!parsed) return;

    items.push({
      id,
      kind,
      title,
      description,
      actor,
      source,
      timestamp: parsed.timestamp,
      timestampLabel: parsed.timestampLabel,
      dateLabel: parsed.dateLabel,
    });
  };

  pushEvent(
    `${project.id}-kickoff`,
    "milestone",
    "Kickoff scheduled",
    `Project workspace opened for ${project.merchantName}.`,
    "System",
    "Project milestone",
    project.dates.kickOffDate,
  );

  pushEvent(
    `${project.id}-target`,
    "milestone",
    "Target go-live date updated",
    `Expected go-live is ${project.dates.expectedGoLiveDate || "not set yet"}.`,
    "System",
    "Project milestone",
    project.dates.expectedGoLiveDate,
  );

  pushEvent(
    `${project.id}-live`,
    "milestone",
    "Project marked live",
    "Merchant went live successfully.",
    "System",
    "Lifecycle milestone",
    project.dates.goLiveDate,
  );

  project.transferHistory.forEach((transfer) => {
    if (transfer.notes?.startsWith("OWNER_CHANGE:")) {
      const ownerName = transfer.notes.replace("OWNER_CHANGE:", "").trim() || "Unassigned";
      pushEvent(
        `owner-change-${transfer.id}`,
        "user",
        `Owner changed to ${ownerName}`,
        `Ownership assignment updated for ${project.merchantName}.`,
        transfer.transferredBy || "System",
        "Owner assignment",
        transfer.transferredAt,
      );
      return;
    }

    pushEvent(
      `transfer-${transfer.id}`,
      "handoff",
      `Transferred from ${transfer.fromTeam} to ${transfer.toTeam}`,
      transfer.notes || "Project ownership moved to the next team.",
      transfer.transferredBy || "System",
      "Team handoff",
      transfer.transferredAt,
    );

    pushEvent(
      `accept-${transfer.id}`,
      "user",
      `Transfer accepted by ${transfer.acceptedBy || transfer.toTeam}`,
      `Project is now active with ${transfer.toTeam}.`,
      transfer.acceptedBy || "System",
      "Team handoff",
      transfer.acceptedAt,
    );
  });

  project.responsibilityLog.forEach((entry) => {
    pushEvent(
      `project-responsibility-${entry.id}`,
      "system",
      `${entry.party} responsibility started`,
      `Execution moved into the ${entry.phase} phase.`,
      "System",
      "Responsibility",
      entry.startedAt,
    );
  });

  project.checklist.forEach((item) => {
    pushEvent(
      `checklist-done-${item.id}`,
      "user",
      `${item.title} completed`,
      `Responsibility at completion: ${item.currentResponsibility}.`,
      item.completedBy || "User",
      `${item.ownerTeam} checklist`,
      item.completedAt,
    );

    pushEvent(
      `checklist-comment-${item.id}`,
      "system",
      `Note added on ${item.title}`,
      item.comment || "Inline task note captured.",
      item.commentBy || "System",
      `${item.ownerTeam} checklist`,
      item.commentAt,
    );
  });

  return items.sort((a, b) => b.timestamp - a.timestamp);
};

const groupByDate = (items: ActivityEntry[]) =>
  items.reduce(
    (acc, item) => {
      const list = acc[item.dateLabel] || [];
      list.push(item);
      acc[item.dateLabel] = list;
      return acc;
    },
    {} as Record<string, ActivityEntry[]>,
  );

const getLatestProjectTimestamp = (project: Project) => {
  const candidateDates = [
    project.dates.goLiveDate,
    project.dates.expectedGoLiveDate,
    ...project.transferHistory.map((entry) => entry.acceptedAt || entry.transferredAt),
    ...project.responsibilityLog.map((entry) => entry.startedAt),
    ...project.checklist.flatMap((item) => [item.completedAt, item.commentAt]),
  ].filter(Boolean) as string[];

  return candidateDates
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => b - a)[0];
};

/**
 * Adapts the shared risk engine's verdict to the gauge this page already
 * renders. The engine decides high/low; the score and findings drive the
 * display so it stays consistent with the Risks tab.
 */
const riskAssessmentFromVerdict = (verdict: RiskVerdict | undefined): RiskAssessment => {
  const findings = verdict?.findings ?? [];
  const score = verdict?.score ?? 0;

  if (verdict?.level === "high") {
    return {
      score,
      label: "High risk",
      tone: "bg-destructive-soft text-destructive-strong border-destructive/30",
      drivers: findings.map((f) => ({ label: f.detail, points: f.magnitude ?? 0 })),
    };
  }

  return {
    score,
    label: "Low risk",
    tone: "bg-success-soft text-success-strong border-success/30",
    drivers: [{ label: "No major delivery or ownership risks detected", points: 0 }],
  };
};

const getLastUpdated = (project: Project) => {
  const latest = getLatestProjectTimestamp(project);

  if (!latest) return "No recent updates";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(latest));
};

const parseAiBullets = (content: string) =>
  content
    .split("\n")
    .map((line) =>
      line
        .replace(/^[-*•]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^Here is the project summary for.*?:/i, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 4);

const buildActionDrivenSummary = (
  project: Project,
  aiBullets: string[],
  risk: RiskAssessment,
  openTasksCount: number,
  completedChecklist: number,
  isTransferReady: boolean,
): Array<{ title: string; body: string; tone: string }> => {
  const nextPending = project.checklist.find((item) => !item.completed);
  const aiSignal = aiBullets[0];

  const cards = [
    {
      title: "Next best action",
      body: isTransferReady
        ? "All current-team checklist items are complete. Review delivery context and transition ownership to the next team."
        : nextPending
          ? `Prioritize "${nextPending.title}" with the ${project.currentOwnerTeam} team to maintain delivery momentum.`
          : "No immediate execution blocker is visible in the current delivery data.",
      tone: "border-primary/20 bg-primary-soft",
    },
    {
      title: "Delivery status",
      body: `${project.merchantName} is in ${project.currentPhase} and currently marked ${project.projectState.replace(/_/g, " ")} with ${completedChecklist}/${project.checklist.length} checklist items complete.`,
      tone: "border-border bg-card",
    },
    {
      title: "Risk watch",
      body:
        risk.label === "High risk"
          ? `High risk. ${risk.drivers.map((d) => d.label).join("; ")}.`
          : "No risk rules are currently firing for this project.",
      tone: "border-border bg-card",
    },
    {
      title: "Operational insight",
      body:
        aiSignal ||
        `${openTasksCount} checklist item${openTasksCount === 1 ? "" : "s"} remain open. Review notes, handoff readiness, and linked documentation before the next status update.`,
      tone: "border-border bg-card",
    },
  ];

  return cards;
};

export const ProjectWorkspaceView = ({ projectId: projectIdProp, inModal = false, onClose, projectIds, onNavigate }: ProjectWorkspaceProps) => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const projectId = projectIdProp || routeProjectId;
  const { fields: customFields } = useCustomFields();
  const { values: customFieldValues } = useCustomFieldValues(projectId);
  const { isAuthenticated, isLoading, currentUser } = useAuth();
  const {
    projects,
    updateProject,
    deleteProject,
    transferProject,
  } = useProjects();
  const { teamLabels, stateLabels, phaseLabels, responsibilityLabels, getLabel } = useLabels();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("checklists");

  // Deep-link support: /projects/:id?tab=&item=&task=&comment=
  const deepLink = useProjectDeepLink();

  useEffect(() => {
    // An item/task/comment target only exists on the checklist tab.
    if (deepLink.tab) setActiveTab(deepLink.tab as WorkspaceTab);
    else if (deepLink.item || deepLink.task || deepLink.comment) setActiveTab("checklists");
  }, [deepLink.tab, deepLink.item, deepLink.task, deepLink.comment]);

  // A comment or task target highlights its own row deeper in the tree; only
  // ring the item itself when it is the target.
  useScrollToAnchor(
    deepLink.item ? `checklist-item-${deepLink.item}` : null,
    !deepLink.comment && !deepLink.task,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState<string[]>([]);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [sendingMagic, setSendingMagic] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    ownership: true,
    execution: true,
  });

  const project = projects.find((entry) => entry.id === projectId) ?? null;

  // Same engine as the Risks tab and the at-risk lists, so a project cannot read
  // as fine here while being flagged elsewhere.
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();

  const activityFeed = useMemo(() => (project ? buildActivityFeed(project) : []), [project]);
  const groupedActivity = useMemo(() => groupByDate(activityFeed), [activityFeed]);

  const { isLoading: projectsLoading } = useProjects();
  const navigate = useNavigate();

  if (isLoading || projectsLoading) {
    return <WorkspaceSkeleton inModal={inModal} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (!project) {
    return (
      <div className={cn("flex items-center justify-center bg-background px-6", inModal ? "min-h-full" : "min-h-screen")}>
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Project not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              This project could not be found in your current workspace.
            </p>
            {inModal ? (
              <Button onClick={onClose}>Close</Button>
            ) : (
              <Button asChild>
                <Link to="/">Back to dashboard</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const completedChecklist = project.checklist.filter((item) => item.completed).length;
  const pendingOn = calculateProjectResponsibilityFromChecklist(project.checklist);
  const timeByParty = calculateTimeFromChecklist(project.checklist);
  const currentTeamChecklist = project.checklist.filter((item) => item.ownerTeam === project.currentOwnerTeam);
  const allCurrentTeamChecklistCompleted =
    currentTeamChecklist.length > 0 && currentTeamChecklist.every((item) => item.completed);
  const canTransfer =
    currentUser?.team === project.currentOwnerTeam &&
    !project.pendingAcceptance &&
    project.currentPhase !== "completed" &&
    project.currentOwnerTeam !== "ms" &&
    currentUser?.team !== "manager";
  const isTransferReady = canTransfer && allCurrentTeamChecklistCompleted;
  const risk = riskAssessmentFromVerdict(riskVerdicts[project.id]);
  // Only a firing rule is worth surfacing — "low risk" is the absence of a
  // signal, and badging it just adds noise to every healthy project.
  const isAtRisk = risk.label === "High risk";
  const riskReasons = isAtRisk ? risk.drivers.map((d) => d.label).join("; ") : null;
  const openTasksCount = project.checklist.length - completedChecklist;
  const nextPendingItem = project.checklist.find((item) => !item.completed);
  const waitingOnLabel = pendingOn === "merchant" ? responsibilityLabels.merchant : teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam;
  const waitingOnSub = pendingOn === "merchant" ? "External work outstanding" : `${openTasksCount} checklist item${openTasksCount === 1 ? "" : "s"} remaining`;
  const nextStepLabel = nextPendingItem?.title || "Ready to transfer";
  const summaryCards = buildActionDrivenSummary(
    project,
    aiSummary,
    risk,
    openTasksCount,
    completedChecklist,
    isTransferReady,
  );

  const projectDetails = [
    [getLabel("field_mid"), project.mid],
    [getLabel("field_platform"), project.platform],
    [getLabel("field_category"), project.category || "—"],
    [getLabel("field_arr"), formatArrCr(project.arr)],
    [getLabel("field_txns_per_day"), `${project.txnsPerDay}`],
    [getLabel("field_aov"), `₹${project.aov.toLocaleString()}`],
    [getLabel("field_sales_spoc"), project.salesSpoc || "—"],
    [getLabel("field_integration_type"), project.integrationType || "—"],
    [getLabel("field_pg_onboarding"), project.pgOnboarding || "—"],
    [getLabel("field_kick_off_date"), project.dates.kickOffDate || "—"],
    [getLabel("field_expected_go_live_date"), formatGoLiveDate(project)],
    [getLabel("field_current_responsibility"), responsibilityLabels[pendingOn] || pendingOn],
  ];

  const detailRows = [
    [getLabel("field_assigned_owner"), project.assignedOwnerName || "Unassigned"],
    ["Reporter", project.salesSpoc || currentUser?.name || "—"],
    ["Current team", teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam],
    ["Needs Attention", riskReasons || "—"],
    ["Last update", getLastUpdated(project)],
    [getLabel("field_current_responsibility"), responsibilityLabels[pendingOn] || pendingOn],
    ["Original estimate", formatDuration(timeByParty.gokwik + timeByParty.merchant)],
    ["Merchant time", formatDuration(timeByParty.merchant)],
    ["Internal time", formatDuration(timeByParty.gokwik)],
    [getLabel("field_arr"), formatArrCr(project.arr)],
    [getLabel("field_platform"), project.platform],
    [getLabel("field_expected_go_live_date"), formatGoLiveDate(project)],
  ];

  // Workspace-defined extra fields (Settings → Custom Fields)
  const customFieldRows: string[][] = customFields
    .filter((f) => (customFieldValues[f.id] ?? "").length > 0)
    .map((f) => [
      f.field_label,
      f.field_type === "boolean"
        ? customFieldValues[f.id] === "true"
          ? "Yes"
          : "No"
        : customFieldValues[f.id],
    ]);

  const noteSections = [
    ["Current phase", project.notes.currentPhaseComment || "No current phase note added."],
    ["Project notes", project.notes.projectNotes || "No project notes added."],
    ["Pre-sales notes", project.notes.mintNotes || "No pre-sales note added."],
    ["Phase 2 notes", project.notes.phase2Comment || "No phase 2 note added."],
  ];

  const quickLinks = [
    project.links.brandUrl ? { label: "Website", href: project.links.brandUrl, icon: Globe } : null,
    project.links.jiraLink ? { label: "JIRA", href: project.links.jiraLink, icon: ArrowUpRight } : null,
    project.links.brdLink ? { label: "BRD", href: project.links.brdLink, icon: FileStack } : null,
    project.links.mintChecklistLink ? { label: "MINT Checklist", href: project.links.mintChecklistLink, icon: CheckCheck } : null,
    project.links.integrationChecklistLink
      ? { label: "Integration Checklist", href: project.links.integrationChecklistLink, icon: CheckCheck }
      : null,
  ].filter(Boolean) as Array<{ label: string; href: string; icon: typeof Globe }>;

  const actionRecommendations = [
    !project.assignedOwnerName && currentUser?.team === "manager"
      ? { label: "Assign owner", sublabel: "Establish clear ownership", onClick: () => setAssignOpen(true) }
      : null,
    project.links.jiraLink
      ? { label: "Open delivery tracker", sublabel: "Review execution tracking", href: project.links.jiraLink }
      : { label: "Add tracker link", sublabel: "Attach execution artifacts", onClick: () => setEditOpen(true) },
    openTasksCount > 0
      ? {
          label: "Review pending checklist",
          sublabel: `${openTasksCount} item${openTasksCount === 1 ? "" : "s"} require attention`,
          onClick: () => setActiveTab("checklists"),
        }
      : null,
    isAtRisk
      ? { label: "Review activity", sublabel: "Inspect blockers and handoffs", onClick: () => setActiveTab("activity") }
      : null,
    canTransfer && isTransferReady
      ? { label: "Initiate transfer", sublabel: "Ownership can progress", onClick: () => setTransferOpen(true) }
      : null,
  ].filter(Boolean) as Array<
    | { label: string; sublabel: string; onClick: () => void; href?: undefined }
    | { label: string; sublabel: string; href: string; onClick?: undefined }
  >;

  const handleGenerateAiSummary = async () => {
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    try {
      const result = await fetchAiInsights({ project, type: "summary" });
      setAiSummary(parseAiBullets(result));
    } catch (error) {
      setAiSummaryError(error instanceof Error ? error.message : "Unable to generate AI summary.");
      setAiSummary([]);
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const handleSendMagicLink = async () => {
    if (!project.contactEmail) {
      toast.error("No merchant contact email set", { description: "Add a Merchant Contact Email in Edit Project first." });
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
    // The update hook only toasts on failure, so confirm here — but only once it has landed.
    updateProject(updatedProject, {
      onSuccess: () => toast.success("Project updated successfully"),
    });
  };

  const handleDelete = () => {
    // The mutation reports its own success/failure.
    deleteProject(project.id);
    setDeleteConfirmOpen(false);
  };

  const handleTransfer = (assigneeId: string, assigneeName: string, notes: string) => {
    const nextTeamKey = project.currentOwnerTeam === "mint" ? "integration" : "ms";
    const nextTeam = teamLabels[nextTeamKey] || nextTeamKey;
    const transferNote = notes || `Transferred to ${nextTeam} team`;
    transferProject(project.id, `${transferNote} (Assigned to: ${assigneeName})`, assigneeId);
  };

  const handleStateChange = (newState: ProjectState) => {
    updateProject(
      { ...project, projectState: newState },
      {
        onSuccess: () => toast.success(`Project state updated to ${projectStateLabels[newState]}`),
      },
    );
  };

  return (
    <div className={cn("flex flex-col overflow-hidden bg-background", inModal ? "h-full rounded-lg border border-border" : "h-screen")}>
      {/* Unified header */}
      <div className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {inModal ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kanban
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const from = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("from");
                  if (from === "list") navigate({ to: "/projects/list" });
                  else if (from === "go-live") navigate({ to: "/projects/go-live" });
                  else if (currentUser?.team === "manager" || currentUser?.team === "admin" || currentUser?.team === "super_admin" || currentUser?.team === "superadmin" || currentUser?.team === "gokwik_general") navigate({ to: "/projects/kanban" });
                  else navigate({ to: "/" });
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 shrink-0 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
              >
                Projects
              </button>
            )}
            <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0 dark:text-muted-foreground" />
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="max-w-[34vw] truncate heading-page text-foreground">{project.merchantName}</h1>
              <RiskBadge projectId={project.id} verdict={riskVerdicts[project.id]} className="ml-2" />
              {/* Prev/Next navigation inline */}
              {inModal && projectIds && projectIds.length > 1 && onNavigate && (() => {
                const currentIndex = projectIds.indexOf(project.id);
                const hasPrev = currentIndex > 0;
                const hasNext = currentIndex < projectIds.length - 1;
                return (
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={!hasPrev}
                      onClick={() => hasPrev && onNavigate(projectIds[currentIndex - 1])}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="px-1 text-xs text-muted-foreground tabular-nums">{currentIndex + 1}/{projectIds.length}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={!hasNext}
                      onClick={() => hasNext && onNavigate(projectIds[currentIndex + 1])}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {inModal ? (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            ) : null}
            {currentUser?.team === "manager" ? (
              <Button variant="outline" size="sm" className="h-9 rounded-lg border-border/70 bg-background px-3 text-sm font-semibold" onClick={() => setAssignOpen(true)}>
                <UserRound className="h-3 w-3 mr-1" />
                Assign owner
              </Button>
            ) : null}
            <Button size="sm" className="h-9 gap-1.5 rounded-md bg-navy px-3 text-sm font-semibold text-navy-foreground hover:bg-navy/90" onClick={handleSendMagicLink} disabled={sendingMagic}>
              <Mail className="h-3.5 w-3.5" />
              {sendingMagic ? "Sending..." : "Send Magic Link"}
            </Button>
            <PortalLinkButton projectId={project.id} label="Share Portal Link" className="border-transparent bg-navy text-navy-foreground hover:bg-navy/90 hover:text-navy-foreground" />
            <Button size="sm" className="h-9 gap-1.5 rounded-md bg-navy px-3 text-sm font-semibold text-navy-foreground hover:bg-navy/90" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit project
            </Button>
            <Button size="sm" className="h-9 gap-1.5 rounded-md bg-navy px-3 text-sm font-semibold text-navy-foreground hover:bg-navy/90" onClick={() => isTransferReady && setTransferOpen(true)} disabled={!isTransferReady}>
              <ArrowRight className="h-3.5 w-3.5" />
              Transfer
            </Button>
          </div>
        </div>
      </div>




      {/* 3-panel body */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 bg-white dark:bg-card">
        {/* RIGHT PANEL — Status & Context */}

        <ScrollArea className="order-1 hidden w-1/4 min-w-[300px] max-w-[420px] shrink-0 border-r border-slate-200 bg-white dark:border-border dark:bg-card lg:block">
          <div className="space-y-3 p-4">
            <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="border-b border-navy/40 bg-navy px-4 py-3">
                <p className="text-sm font-semibold text-navy-foreground">Project Details</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4">
                <div className="col-span-2 min-w-0">
                  <p className="text-2xs font-bold tracking-widest text-muted-foreground">{getLabel("field_project_state")}</p>
                  <Select value={project.projectState} onValueChange={(value) => handleStateChange(value as ProjectState)}>
                    <SelectTrigger className={cn("mt-1 h-9 w-full text-sm font-semibold", stateSelectToneMap[project.projectState])}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATES.map((state) => <SelectItem key={state} value={state}>{stateLabels[state] || projectStateLabels[state]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {[
                  [getLabel("field_project_stage"), funnelStageLabels[getProjectFunnelStage(project)] || getProjectFunnelStage(project)],
                  [getLabel("field_expected_go_live_date"), formatGoLiveDate(project, undefined, "Not set")],
                  [getLabel("field_assigned_owner"), project.assignedOwnerName || "Unassigned"],
                  [getLabel("field_arr"), formatArrCr(project.arr)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <p className="text-2xs font-bold tracking-widest text-muted-foreground">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>{value}</p>
                  </div>
                ))}
              </div>
            </section>

            {[
              { title: "Ownership", rows: [[getLabel("field_assigned_owner"), project.assignedOwnerName || "Unassigned"], ["Team", teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam], [getLabel("field_sales_spoc"), project.salesSpoc || "—"]] },
              { title: "Delivery", rows: [["Checklist", `${completedChecklist}/${project.checklist.length}`], ["Responsibility", responsibilityLabels[pendingOn] || pendingOn], [getLabel("field_kick_off_date"), project.dates.kickOffDate || "—"], [getLabel("field_expected_go_live_date"), formatGoLiveDate(project)], [getLabel("field_actual_go_live_date"), project.dates.goLiveDate || "—"], ["Internal time", formatDuration(timeByParty.gokwik)], ["Merchant time", formatDuration(timeByParty.merchant)]] },
              { title: "Business", rows: [[getLabel("field_platform"), project.platform], [getLabel("field_category"), project.category || "—"], [getLabel("field_arr"), formatArrCr(project.arr)], [getLabel("field_txns_per_day"), `${project.txnsPerDay}`], [getLabel("field_aov"), `₹${project.aov.toLocaleString()}`], [getLabel("field_integration_type"), project.integrationType || "—"], [getLabel("field_pg_onboarding"), project.pgOnboarding || "—"]] },
              { title: "Notes", rows: noteSections },
              ...(customFieldRows.length ? [{ title: "Custom Fields", rows: customFieldRows }] : []),
            ].map((section) => (
              <details key={section.title} className="group rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground">
                  {section.title}<ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border px-4 py-3 space-y-2">
                  {section.rows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">{label}</span><span className="max-w-[62%] text-right font-medium text-foreground">{value}</span></div>)}
                </div>
              </details>
            ))}

            <details className="group rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground">Links<ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
              <div className="border-t border-border px-4 py-3 space-y-2">
                {quickLinks.length ? quickLinks.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="flex items-center justify-between text-sm font-medium text-primary hover:underline"><span>{link.label}</span><ExternalLink className="h-3.5 w-3.5" /></a>) : <p className="text-sm text-muted-foreground">No links attached.</p>}
              </div>
            </details>
          </div>

        </ScrollArea>

        {/* CENTER PANEL — Tabs */}
        <main className="order-2 flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-card">
          {/* Compact status grid for screens below lg (context panel hidden) */}
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3 dark:border-border dark:bg-muted/30 lg:hidden">
            {[
              { label: "Waiting on", value: waitingOnLabel },
              { label: "Next step", value: nextStepLabel },
              { label: "Go-live", value: formatGoLiveDate(project, undefined, "Not set") },
              { label: "Needs Attention", value: isAtRisk ? "Yes" : "—" },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-border dark:bg-card">
                <p className="text-2xs font-bold tracking-widest text-slate-500 dark:text-muted-foreground">{item.label}</p>
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-foreground" title={item.value}>{item.value}</p>
              </div>
            ))}
          </div>



          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WorkspaceTab)} className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-0 dark:border-border dark:bg-card">
              <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                {tabOptions.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm font-semibold text-slate-500 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-slate-950 data-[state=active]:shadow-none dark:text-muted-foreground dark:data-[state=active]:text-foreground"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto bg-background px-4 py-4">
              {/* OVERVIEW TAB — Rich dashboard */}
              <TabsContent value="overview" className="m-0">
                <div className="space-y-3">
                  {/* Key Metrics Row */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Checklist Progress", value: `${completedChecklist}/${project.checklist.length}`, sub: `${project.checklist.length ? Math.round((completedChecklist / project.checklist.length) * 100) : 0}% complete` },
                      { label: "Go-Live %", value: `${project.goLivePercent}%`, sub: project.projectState === "live" ? "Live" : "In progress" },
                      { label: "Needs Attention", value: isAtRisk ? "Yes" : "No", sub: riskReasons || "No rules firing" },
                      { label: "Handoffs", value: `${project.transferHistory.length}`, sub: `${activityFeed.length} total events` },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-lg border border-border/60 bg-card/80 p-3">
                        <p className="text-2xs font-semibold tracking-widest text-muted-foreground">{metric.label}</p>
                        <p className="mt-1 text-xl font-bold tracking-tight text-foreground">{metric.value}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">{metric.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* Checklist by team + Timeline snapshot */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Checklist breakdown */}
                    <div className="rounded-lg border border-border/60 bg-card/80 p-3">
                      <p className="text-2xs font-semibold tracking-widest text-muted-foreground">Checklist by team</p>
                      <div className="mt-2 space-y-1.5">
                        {Object.entries(
                          project.checklist.reduce(
                            (acc, item) => {
                              const bucket = acc[item.ownerTeam] || { done: 0, total: 0 };
                              bucket.total += 1;
                              if (item.completed) bucket.done += 1;
                              acc[item.ownerTeam] = bucket;
                              return acc;
                            },
                            {} as Record<string, { done: number; total: number }>,
                          ),
                        ).map(([team, summary]) => (
                          <div key={team}>
                            <div className="flex items-center justify-between mb-0.5">
                              <p className="text-xs font-semibold text-foreground">{teamLabels[team] || team}</p>
                              <span className="text-2xs font-semibold text-muted-foreground">{summary.done}/{summary.total}</span>
                            </div>
                            <Progress value={summary.total ? (summary.done / summary.total) * 100 : 0} className="h-1 bg-secondary" />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Recent activity snapshot */}
                    <div className="rounded-lg border border-border/60 bg-card/80 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-2xs font-semibold tracking-widest text-muted-foreground">Recent activity</p>
                        <button type="button" onClick={() => setActiveTab("activity")} className="text-2xs font-semibold text-primary hover:underline">View all</button>
                      </div>
                      <div className="space-y-1.5">
                        {activityFeed.slice(0, 4).map((item) => (
                          <div key={item.id} className="flex items-start gap-2">
                            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", activityToneMap[item.kind])} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate">{item.title}</p>
                              <p className="text-2xs text-muted-foreground">{item.actor} · {item.timestampLabel}</p>
                            </div>
                          </div>
                        ))}
                        {activityFeed.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No activity recorded.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                </div>
              </TabsContent>

              <TabsContent value="activity" className="m-0">
                <ProjectActivityHistoryPanel projectId={project.id} />
              </TabsContent>

              <TabsContent value="jira" className="m-0">
                <div className="rounded-xl border border-border/60 bg-card/80 p-4">
                  <JiraTicketsSection projectId={project.id} merchantName={project.merchantName} />
                </div>
              </TabsContent>


              <TabsContent value="checklists" className="m-0 h-full">
                <div className="h-full min-h-[500px]">
                  <ChecklistDialog project={project} open={true} onOpenChange={() => undefined} variant="inline" />
                </div>
              </TabsContent>

              <TabsContent value="notes" className="m-0">
                <div className="space-y-2">
                  {noteSections.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border/60 bg-card/80 p-3">
                      <p className="text-2xs font-semibold tracking-widest text-muted-foreground">{label}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="details" className="m-0">
                <div className="max-w-3xl space-y-2">
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-border dark:bg-muted/30">
                    <p className="text-xs font-bold tracking-widest text-slate-500 dark:text-muted-foreground">Project overview</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500 dark:text-muted-foreground">Project ID</span><Badge variant="outline" className="max-w-[175px] truncate px-1.5 py-0.5 text-2xs font-semibold">MID {project.mid}</Badge></div>
                      <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">State</span><span className="font-semibold text-pending-strong">{stateLabels[project.projectState] || projectStateLabels[project.projectState]}</span></div>
                      {isAtRisk && <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Needs Attention</span><span className="font-semibold text-destructive-strong">Yes</span></div>}
                      <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500 dark:text-muted-foreground">Go-live</span><span className="font-semibold text-slate-700 dark:text-foreground">{formatGoLiveDate(project)}</span></div>
                    </div>
                  </div>

                  <div className="px-4 py-3">

                    <p className="mb-2 text-xs font-bold tracking-widest text-slate-500">Update state</p>
                    <Select value={project.projectState} onValueChange={(v) => handleStateChange(v as ProjectState)}>
                      <SelectTrigger className={cn("h-9 rounded-md text-sm font-semibold border", stateSelectToneMap[project.projectState])}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={cn(inModal && "z-[90]")}>
                        {PROJECT_STATES.map((state) => (
                          <SelectItem key={state} value={state} className={cn("rounded-2xl my-1 text-base font-medium", stateSelectToneMap[state])}>
                            {stateLabels[state] || projectStateLabels[state]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="h-px bg-slate-200 dark:bg-border" />

                  {/* Collapsible sections */}
                  {[
                    {
                      key: "ownership",
                      title: "Ownership",
                      content: (
                        <div className="space-y-2">
                          {[
                            ["Owner", project.assignedOwnerName || "Unassigned"],
                            ["Team", teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam],
                            [getLabel("field_sales_spoc"), project.salesSpoc || "—"],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-baseline justify-between gap-2">
                              <p className="text-xs font-medium tracking-normal text-muted-foreground">{label}</p>
                              <p className="text-sm font-semibold text-foreground text-right truncate max-w-[120px]">{value}</p>
                            </div>
                          ))}
                        </div>
                      ),
                    },
                    {
                      key: "execution",
                      title: "Execution",
                      content: (
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs font-medium tracking-normal text-muted-foreground">Responsibility</p>
                            <p className="text-sm font-semibold text-foreground">{responsibilityLabels[pendingOn] || pendingOn}</p>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs font-medium tracking-normal text-muted-foreground">Checklist</p>
                            <p className="text-sm font-semibold text-foreground">{completedChecklist}/{project.checklist.length}</p>
                          </div>
                          <Progress
                            value={project.checklist.length ? (completedChecklist / project.checklist.length) * 100 : 0}
                            className="h-1.5 rounded-full bg-secondary"
                          />
                          <div className="grid grid-cols-2 gap-1.5 pt-1">
                            <div className="rounded-md border border-border/60 bg-card/80 px-2 py-1.5 text-center">
                              <p className="text-xs font-bold text-foreground">{formatDuration(timeByParty.gokwik)}</p>
                              <p className="text-2xs tracking-normal text-muted-foreground">Internal</p>
                            </div>
                            <div className="rounded-md border border-border/60 bg-card/80 px-2 py-1.5 text-center">
                              <p className="text-xs font-bold text-foreground">{formatDuration(timeByParty.merchant)}</p>
                              <p className="text-2xs tracking-normal text-muted-foreground">Merchant</p>
                            </div>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "dates",
                      title: "Key dates",
                      content: (
                        <div className="space-y-1.5">
                          {[
                            [getLabel("field_kick_off_date"), project.dates.kickOffDate || "—"],
                            [getLabel("field_expected_go_live_date"), formatGoLiveDate(project)],
                            ["Go-live", project.dates.goLiveDate || "—"],
                            ["Last update", getLastUpdated(project)],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-baseline justify-between gap-2">
                              <p className="text-xs font-medium tracking-normal text-muted-foreground">{label}</p>
                              <p className="text-sm font-semibold text-foreground text-right truncate max-w-[110px]">{value}</p>
                            </div>
                          ))}
                        </div>
                      ),
                    },
                    {
                      key: "business",
                      title: "Business",
                      content: (
                        <div className="space-y-1.5">
                          {[
                            [getLabel("field_platform"), project.platform],
                            [getLabel("field_category"), project.category || "—"],
                            [getLabel("field_arr"), formatArrCr(project.arr)],
                            [getLabel("field_txns_per_day"), `${project.txnsPerDay}`],
                            [getLabel("field_aov"), `₹${project.aov.toLocaleString()}`],
                            [getLabel("field_integration_type"), project.integrationType || "—"],
                            [getLabel("field_pg_onboarding"), project.pgOnboarding || "—"],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-baseline justify-between gap-2">
                              <p className="text-xs font-medium tracking-normal text-muted-foreground">{label}</p>
                              <p className="text-sm font-semibold text-foreground text-right truncate max-w-[110px]">{value}</p>
                            </div>
                          ))}
                        </div>
                      ),
                    },
                    {
                      key: "links",
                      title: "Links",
                      content: (
                        <div className="space-y-1">
                          {quickLinks.length > 0 ? (
                            quickLinks.map((link) => (
                              <a
                                key={link.label}
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between rounded-md border border-border/60 bg-card/80 px-2.5 py-2 text-xs font-semibold text-foreground transition hover:bg-accent/60"
                              >
                                <div className="flex items-center gap-1.5">
                                  <link.icon className="h-3 w-3" />
                                  <span>{link.label}</span>
                                </div>
                                <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                              </a>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">No links attached.</p>
                          )}
                        </div>
                      ),
                    },
                  ].map((section) => (
                    <div key={section.key} className="px-4">
                      <div className="py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedSections(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                          className="flex w-full items-center justify-between group"
                        >
                          <p className="text-xs font-bold tracking-widest text-slate-500 dark:text-muted-foreground">{section.title}</p>
                          <ChevronDown className={cn("h-3 w-3 text-slate-400 transition-transform dark:text-muted-foreground", expandedSections[section.key] ? "rotate-0" : "-rotate-90")} />
                        </button>
                        {expandedSections[section.key] && (
                          <div className="mt-2">{section.content}</div>
                        )}
                      </div>
                      <div className="h-px bg-slate-200 dark:bg-border" />
                    </div>
                  ))}

                  {detailRows.map(([label, value]) => (
                    <div key={label} className="flex items-center gap-4 border-b border-border/60 px-3 py-3 last:border-b-0">
                      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

            </div>
          </Tabs>
        </main>

      </div>

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
