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
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileStack,
  Globe,
  Link2,
  Mail,
  Pencil,
  Share2,
  UserRound,
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

/** "11 Sep 2026" — the format the checklist uses, never a raw ISO date. */
const friendlyDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** "in 22 days", "today", "7 days late" — the part people actually work from. */
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

/**
 * One fact: muted label, value alongside, and — where the value can be changed —
 * a click that opens the right editor rather than a separate dialog for everything.
 */
const PanelRow = ({
  label,
  value,
  hint,
  avatar,
  onEdit,
}: {
  label: string;
  value: string;
  hint?: string;
  avatar?: string;
  onEdit?: () => void;
}) => {
  const body = (
    <>
      {avatar && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
          {avatar.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate" title={value}>{value}</span>
      {hint && <span className="shrink-0 text-xs text-muted-foreground">· {hint}</span>}
    </>
  );
  return (
    <div className="grid grid-cols-[minmax(84px,38%)_minmax(0,1fr)] items-center gap-3 border-b border-border/50 py-1.5 last:border-b-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="-mx-1.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left font-medium text-foreground hover:bg-muted"
          >
            {body}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 px-0 font-medium text-foreground">{body}</span>
        )}
      </dd>
    </div>
  );
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

  /** Keep the open tab in the URL, so it can be linked to and the back button works. */
  const openTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (inModal || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  };

  // Deep-link support: /projects/:id?tab=&item=&task=&comment=
  const deepLink = useProjectDeepLink();

  useEffect(() => {
    // An item/task/comment target only exists on the checklist tab.
    // Only tabs that exist: an unknown ?tab= used to render a hidden panel
    // with nothing marked active.
    const known = tabOptions.some((t) => t.value === deepLink.tab);
    if (known) setActiveTab(deepLink.tab as WorkspaceTab);
    else if (deepLink.item || deepLink.task || deepLink.comment) setActiveTab("checklists");
  }, [deepLink.tab, deepLink.item, deepLink.task, deepLink.comment]);

  // A comment or task target highlights its own row deeper in the tree; only
  // ring the item itself when it is the target.
  useScrollToAnchor(
    deepLink.item ? `checklist-item-${deepLink.item}` : null,
    !deepLink.comment && !deepLink.task,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);
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

  const handleSendMagicLink = async () => {
    if (!project.contactEmail) {
      toast.error(`No ${getLabel("field_contact_email").toLowerCase()} set`, { description: `Add ${getLabel("field_contact_email")} in Edit Project first.` });
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
              {riskReasons ? (
                <span className="hidden max-w-[28vw] truncate text-xs text-destructive-strong md:inline" title={riskReasons}>
                  {riskReasons}
                </span>
              ) : null}
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
            {/* Customer access — two ways of giving the customer a way in, in one place. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-3 text-sm font-medium text-primary hover:bg-primary-soft hover:text-primary">
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
                    <DropdownMenuItem
                      disabled={isWorking}
                      onSelect={(event) => {
                        event.preventDefault();
                        open();
                      }}
                    >
                      <Link2 className="mr-2 h-3.5 w-3.5" />
                      Copy portal link
                    </DropdownMenuItem>
                  )}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {currentUser?.team === "manager" ? (
              <Button variant="ghost" size="sm" className="h-9 px-3 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setAssignOpen(true)}>
                <UserRound className="mr-1 h-3.5 w-3.5" />
                Assign owner
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-md border-primary/40 px-3 text-sm font-medium text-primary hover:bg-primary-soft hover:text-primary" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit project
            </Button>
            {/* The one action that moves the project on. */}
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-md bg-navy px-3 text-sm font-semibold text-navy-foreground hover:bg-navy/90"
              onClick={() => isTransferReady && setTransferOpen(true)}
              disabled={!isTransferReady}
              title={isTransferReady ? undefined : "Finish this team's checklist items first"}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Transfer
            </Button>
          </div>
        </div>
      </div>




      {/* Body: the record on the left, the work on the right. Stacks below lg. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col bg-white dark:bg-card lg:flex-row">
        <ScrollArea className="order-1 max-h-[45vh] shrink-0 border-b border-slate-200 bg-white dark:border-border dark:bg-card lg:max-h-none lg:w-[268px] lg:border-b-0 lg:border-r">
          <div className="p-4">
            {/* Where the project is, before any label is read. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={project.projectState} onValueChange={(value) => handleStateChange(value as ProjectState)}>
                <SelectTrigger
                  aria-label={getLabel("field_project_state")}
                  className={cn(
                    "h-7 w-auto gap-1.5 rounded-full border-0 px-3 text-xs font-medium shadow-none focus:ring-1",
                    stateSelectToneMap[project.projectState],
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATES.map((state) => (
                    <SelectItem key={state} value={state}>{stateLabels[state] || projectStateLabels[state]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="inline-flex h-7 items-center rounded-full bg-primary-soft px-3 text-xs font-medium text-primary">
                Waiting on {waitingOnLabel}
              </span>
              {isAtRisk && (
                <span className="inline-flex h-7 items-center rounded-full bg-destructive-soft px-3 text-xs font-medium text-destructive-strong" title={riskReasons || undefined}>
                  Needs attention
                </span>
              )}
            </div>

            {/* The five facts people ask for, editable where they are read. */}
            <dl className="text-sm">
              <PanelRow label="Next step" value={nextStepLabel} />
              <PanelRow
                label={getLabel("field_project_stage")}
                value={funnelStageLabels[getProjectFunnelStage(project)] || getProjectFunnelStage(project)}
              />
              <PanelRow
                label={getLabel("field_expected_go_live_date")}
                value={formatGoLiveDate(project, friendlyDate, "Not set")}
                hint={relativeDay(project.dates.expectedGoLiveDate)}
                onEdit={() => setEditOpen(true)}
              />
              <PanelRow
                label={getLabel("field_assigned_owner")}
                value={project.assignedOwnerName || "Unassigned"}
                avatar={project.assignedOwnerName || undefined}
                onEdit={currentUser?.team === "manager" ? () => setAssignOpen(true) : undefined}
              />
              <PanelRow label={getLabel("field_arr")} value={`₹${formatArrCr(project.arr)}`} onEdit={() => setEditOpen(true)} />
            </dl>

            {/* Everything else, one click away — rows, not another stack of cards. */}
            <button
              type="button"
              onClick={() => setShowAllFields((open) => !open)}
              className="mt-3 flex w-full items-center justify-between rounded-md py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>{showAllFields ? "Fewer details" : "More details"}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAllFields && "rotate-180")} />
            </button>

            {showAllFields && (
              <div className="pb-1">
                {[
                  // The chips and rows above already carry state, owner, go-live and MRR.
                  { title: "Ownership", rows: [["Team", teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam], [getLabel("field_sales_spoc"), project.salesSpoc || "—"]] },
                  { title: "Delivery", rows: [["Checklist", `${completedChecklist} of ${project.checklist.length}`], ["Responsibility", responsibilityLabels[pendingOn] || pendingOn], [getLabel("field_kick_off_date"), friendlyDate(project.dates.kickOffDate)], [getLabel("field_actual_go_live_date"), friendlyDate(project.dates.goLiveDate)], ["Last update", getLastUpdated(project)], [`${responsibilityLabels.gokwik} time`, formatDuration(timeByParty.gokwik)], [`${responsibilityLabels.merchant} time`, formatDuration(timeByParty.merchant)]] },
                  { title: "Business", rows: [[getLabel("field_platform"), project.platform], [getLabel("field_category"), project.category || "—"], [getLabel("field_txns_per_day"), `${project.txnsPerDay}`], [getLabel("field_aov"), `₹${project.aov.toLocaleString()}`], [getLabel("field_integration_type"), project.integrationType || "—"], [getLabel("field_pg_onboarding"), project.pgOnboarding || "—"]] },
                  ...(customFieldRows.length ? [{ title: "Custom fields", rows: customFieldRows }] : []),
                ].map((section) => (
                  <section key={section.title} className="mt-3">
                    <p className="mb-1 text-xs font-semibold text-foreground">{section.title}</p>
                    <dl className="text-sm">
                      {section.rows
                        .filter(([, value]) => value && value !== "—")
                        .map(([label, value]) => <PanelRow key={label} label={label} value={value} />)}
                    </dl>
                  </section>
                ))}
                {/* Notes and links sit with the rest of the detail. */}
                <section className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-foreground">Notes</p>
                  <div className="space-y-2">
                    {noteSections
                      .filter(([, value]) => value && !value.startsWith("No "))
                      .map(([label, value]) => (
                        <div key={label}>
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="whitespace-pre-line text-sm text-foreground">{value}</p>
                        </div>
                      ))}
                    {noteSections.every(([, value]) => !value || value.startsWith("No ")) && (
                      <p className="text-sm text-muted-foreground">No notes yet.</p>
                    )}
                  </div>
                </section>

                <section className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-foreground">Links</p>
                  {quickLinks.length ? (
                    <div className="space-y-1">
                      {quickLinks.map((link) => (
                        <a
                          key={link.label}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between py-0.5 text-sm text-primary hover:underline"
                        >
                          <span>{link.label}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No links attached.</p>
                  )}
                </section>
              </div>
            )}

          </div>

        </ScrollArea>

        {/* The work: checklist, activity, Jira */}
        <main className="order-2 flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-card">
          <Tabs value={activeTab} onValueChange={(value) => openTab(value as WorkspaceTab)} className="flex flex-1 flex-col overflow-hidden">
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

            <div className="flex-1 overflow-y-auto bg-background px-4 pb-20 pt-4">
              <TabsContent value="activity" className="m-0">
                <ProjectActivityHistoryPanel projectId={project.id} />
              </TabsContent>

              <TabsContent value="jira" className="m-0">
                <div className="rounded-xl border border-border/60 bg-card/80 p-4">
                  <JiraTicketsSection projectId={project.id} merchantName={project.merchantName} />
                </div>
              </TabsContent>


              <TabsContent value="checklists" className="m-0 h-full">
                <div className="h-full">
                  <ChecklistDialog project={project} open={true} onOpenChange={() => undefined} variant="inline" />
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
