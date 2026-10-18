import { useMemo, useEffect, useRef, useState, Fragment } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Project, calculateTimeByParty, formatDuration, ResponsibilityParty, projectStateLabels, ProjectState, ProjectChecklist } from "@/data/projectsData";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectDeepLink, useScrollToAnchor } from "@/hooks/useProjectDeepLink";
import { useLabels } from "@/contexts/LabelsContext";
import { useFormAssignments, useFormTemplates } from "@/hooks/useChecklistForms";
import { useTeams } from "@/hooks/useTeams";
import { useProfilesLookup, useChecklistTemplateTitles } from "@/hooks/useLookups";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChecklistCommentThread } from "@/components/ChecklistCommentThread";
import { ChecklistFormDialog } from "@/components/ChecklistFormDialog";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { ChecklistItemMeetings } from "@/components/ChecklistItemMeetings";
import { ProjectActivityHistoryPanel } from "@/components/ProjectActivityHistoryPanel";
import { useChecklistTasks, useAddChecklistTask, useUpdateChecklistTask, useDeleteChecklistTask } from "@/hooks/useChecklistTasks";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { formatArrCr } from "@/lib/arr";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, ClipboardList, Minus, FileText, ListTodo, Trash2, Calendar, Video,
  Building2, Users, Plus, MoreHorizontal, MessageSquare, Pencil,
  ExternalLink, IndianRupee, UserRound, ChevronDown, FileStack, Paperclip,
} from "lucide-react";

/** "9 Sep 2026" */
const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Phase-to-stage label mapping for "Project Stages" grouping */
const PHASE_STAGE_LABELS: Record<string, string> = {
  mint: "Pre Sales",
  integration: "Implementation",
  ms: "Go Live",
  completed: "Closure",
};

const PHASE_ORDER = ["mint", "integration", "ms", "completed"];

type ItemStatus = "completed" | "overdue" | "in_progress" | "upcoming" | "todo";

const STATUS_CONFIG: Record<ItemStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-success/15 text-success-strong" },
  overdue: { label: "Overdue", className: "bg-destructive/10 text-destructive" },
  in_progress: { label: "In Progress", className: "bg-info/10 text-info-strong" },
  upcoming: { label: "Upcoming", className: "bg-muted text-muted-foreground" },
  todo: { label: "To do", className: "bg-muted text-muted-foreground" },
};

const STATE_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  on_hold: "bg-warning-soft text-warning-strong",
  in_progress: "bg-info-soft text-info-strong",
  live: "bg-success-soft text-success-strong",
  blocked: "bg-destructive-soft text-destructive-strong",
};

type StatusFilterValue = "all" | "todo" | "in_progress" | "completed" | "overdue";

const getItemStatus = (item: ProjectChecklist): ItemStatus => {
  if (item.completed) return "completed";
  const now = new Date();
  if (item.dueDate && new Date(item.dueDate) < now) return "overdue";
  if (item.currentResponsibility !== "neutral") return "in_progress";
  if (item.dueDate && new Date(item.dueDate) >= now) return "upcoming";
  return "todo";
};

const matchesFilter = (item: ProjectChecklist, filter: StatusFilterValue): boolean => {
  if (filter === "all") return true;
  const status = getItemStatus(item);
  if (filter === "todo") return status === "todo" || status === "upcoming";
  return status === filter;
};

const StatusBadge = ({ status }: { status: ItemStatus }) => {
  const config = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", config.className)}>
      {config.label}
    </span>
  );
};

/** "in 22 days", "12 days" — relative day helper for the details panel. */
const daysRelative = (v?: string | null) => {
  if (!v) return null;
  const then = new Date(v);
  if (Number.isNaN(then.getTime())) return null;
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOfDay(then) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "today";
  if (days > 0) return `${days} days`;
  return `${Math.abs(days)} days late`;
};

const friendlyDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

interface GroupData {
  key: string;
  label: string;
  color: string;
  items: ProjectChecklist[];
  completed: number;
  total: number;
}

/* ── Shell ────────────────────────────────────────────────────────── */

const Shell = ({
  variant,
  open,
  onOpenChange,
  children,
}: {
  variant: "dialog" | "inline";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) =>
  variant === "inline" ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] h-[95vh] max-h-[95vh] flex flex-col overflow-hidden">
        {children}
      </DialogContent>
    </Dialog>
  );

/* ── Component ────────────────────────────────────────────────────── */

interface ChecklistDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "dialog" | "inline";
  onEditProject?: () => void;
  onAssignOwner?: () => void;
}

export const ChecklistDialog = ({
  project,
  open,
  onOpenChange,
  variant = "dialog",
  onEditProject,
  onAssignOwner,
}: ChecklistDialogProps) => {
  const { updateChecklist, toggleChecklistResponsibility } = useProjects();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { teamLabels, responsibilityLabels } = useLabels();
  const { assignments } = useFormAssignments();
  const { templates: formTemplates } = useFormTemplates();
  const { allTeams, teamLabelMap, teamColorMap, checklistTeamSlugs } = useTeams();
  const { data: allTasks = [] } = useChecklistTasks(project?.id);
  const { data: allMeetings = [] } = useChecklistMeetings(project?.id);
  const addTaskMutation = useAddChecklistTask();
  const updateTaskMutation = useUpdateChecklistTask();
  const deleteTaskMutation = useDeleteChecklistTask();

  // Dialog state
  const [taskDialogState, setTaskDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
  } | null>(null);

  const [meetingDialogState, setMeetingDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
  } | null>(null);

  const deepLink = useProjectDeepLink();
  useScrollToAnchor(deepLink.task ? `task-${deepLink.task}` : null, !!project);

  const [commentPrompt, setCommentPrompt] = useState<{ itemId: string; at: number } | null>(null);
  const { profiles } = useProfilesLookup();

  const [formDialogState, setFormDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
    formTemplateId: string;
    formTemplateName: string;
  } | null>(null);

  // ── Inline-specific state ──
  const [groupBy, setGroupBy] = useState<"teams" | "stages">("teams");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [detailsTab, setDetailsTab] = useState<"details" | "people" | "activity">("details");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const formsByChecklistTemplateId = useMemo(() => {
    const map = new Map<string, { formTemplateId: string; formTemplateName: string }>();
    assignments.forEach(a => {
      const ft = formTemplates.find(t => t.id === a.form_template_id);
      if (ft) map.set(a.checklist_template_id, { formTemplateId: ft.id, formTemplateName: ft.name });
    });
    return map;
  }, [assignments, formTemplates]);

  const getTeamLabel = (slug: string) =>
    teamLabels[slug as keyof typeof teamLabels] || teamLabelMap[slug] || slug;

  const getTeamColor = (slug: string) => teamColorMap[slug] || "#6b7280";

  const { titlesToId: checklistTemplatesByTitle } = useChecklistTemplateTitles();

  const checklist = project?.checklist || [];

  const currentTeamChecklist = project ? checklist.filter(c => c.ownerTeam === project.currentOwnerTeam) : [];
  const allCurrentTeamDone = currentTeamChecklist.length > 0 && currentTeamChecklist.every(c => c.completed);
  const prevAllDoneRef = useRef(allCurrentTeamDone);

  useEffect(() => {
    if (allCurrentTeamDone && !prevAllDoneRef.current && open) {
      toast.success("🎉 All tasks complete! Transfer is now unlocked.", {
        duration: 5000,
        description: "You can now transfer this project to the next team.",
      });
    }
    prevAllDoneRef.current = allCurrentTeamDone;
  }, [allCurrentTeamDone, open]);

  if (!project || !currentUser) return null;

  // ── Grouping logic (shared) ──
  const groupedByTeam = project.checklist.reduce((acc, item) => {
    const team = (item.ownerTeam || "").toLowerCase();
    if (!acc[team]) acc[team] = [];
    acc[team].push(item);
    return acc;
  }, {} as Record<string, typeof project.checklist>);

  const userTeam = (currentUser.team || "").toLowerCase();
  const hasFullChecklistAccess = ["manager", "admin", "super_admin", "superadmin"].includes(userTeam);

  const systemSlugs = ["mint", "integration", "ms"];
  const allSlugsInChecklist = Object.keys(groupedByTeam);

  const orderedTeams: string[] = [];
  if (userTeam && allSlugsInChecklist.includes(userTeam) && !hasFullChecklistAccess) orderedTeams.push(userTeam);
  systemSlugs.forEach(s => { if (allSlugsInChecklist.includes(s) && !orderedTeams.includes(s)) orderedTeams.push(s); });
  allSlugsInChecklist.forEach(s => { if (!orderedTeams.includes(s) && !systemSlugs.includes(s)) orderedTeams.push(s); });
  if (hasFullChecklistAccess && orderedTeams.length === 0) {
    systemSlugs.forEach(s => { if (allSlugsInChecklist.includes(s)) orderedTeams.push(s); });
    allSlugsInChecklist.forEach(s => { if (!orderedTeams.includes(s)) orderedTeams.push(s); });
  }

  const teamCounts = Object.entries(groupedByTeam).reduce((acc, [team, items]) => {
    acc[team] = { completed: items.filter(i => i.completed).length, total: items.length };
    return acc;
  }, {} as Record<string, { completed: number; total: number }>);

  const canEditChecklistItem = (ownerTeam: string) =>
    hasFullChecklistAccess || userTeam === (ownerTeam || "").toLowerCase();

  const handleResponsibilityChange = (checklistId: string, newParty: string) => {
    if (newParty && (newParty === "gokwik" || newParty === "merchant" || newParty === "neutral")) {
      toggleChecklistResponsibility(project.id, checklistId, newParty as ResponsibilityParty);
    }
  };

  // ── Groups for inline sidebar ──
  const activeGroups: GroupData[] = useMemo(() => {
    const items = checklist.filter(i => !i.isTask);

    if (groupBy === "stages") {
      const map: Record<string, ProjectChecklist[]> = {};
      items.forEach(item => {
        const phase = PHASE_ORDER.includes(item.phase as string) ? (item.phase as string) : "integration";
        if (!map[phase]) map[phase] = [];
        map[phase].push(item);
      });
      return PHASE_ORDER
        .filter(p => map[p]?.length > 0)
        .map(p => ({
          key: p,
          label: PHASE_STAGE_LABELS[p] || p,
          color: getTeamColor(p),
          items: map[p],
          completed: map[p].filter(i => i.completed).length,
          total: map[p].length,
        }));
    }

    return orderedTeams.map(team => ({
      key: team,
      label: getTeamLabel(team),
      color: getTeamColor(team),
      items: (groupedByTeam[team] || []).filter(i => !i.isTask),
      completed: (groupedByTeam[team] || []).filter(i => !i.isTask && i.completed).length,
      total: (groupedByTeam[team] || []).filter(i => !i.isTask).length,
    }));
  }, [groupBy, checklist, orderedTeams, groupedByTeam]);

  const effectiveSelectedGroup = selectedGroup && activeGroups.some(g => g.key === selectedGroup)
    ? selectedGroup
    : activeGroups[0]?.key ?? null;

  const selectedGroupData = activeGroups.find(g => g.key === effectiveSelectedGroup) ?? null;

  const getAssignee = (item: ProjectChecklist): string => {
    if (item.completedBy) return item.completedBy;
    return project.assignedOwnerName || getTeamLabel(item.ownerTeam || "");
  };

  const filteredItems = useMemo(() => {
    const items = selectedGroupData?.items || [];
    return items.filter(item => matchesFilter(item, statusFilter));
  }, [selectedGroupData, statusFilter]);

  const filterCounts = useMemo(() => {
    const items = selectedGroupData?.items || [];
    return {
      all: items.length,
      todo: items.filter(i => { const s = getItemStatus(i); return s === "todo" || s === "upcoming"; }).length,
      in_progress: items.filter(i => getItemStatus(i) === "in_progress").length,
      completed: items.filter(i => i.completed).length,
      overdue: items.filter(i => getItemStatus(i) === "overdue").length,
    };
  }, [selectedGroupData]);

  // Next action for the right panel
  const nextStep = useMemo(() => {
    const open = project.checklist.filter(item => !item.completed && !item.isTask);
    if (open.length === 0) return { label: "All checklist items complete", hint: undefined as string | undefined };
    const ownTeam = open.filter(item => (item.ownerTeam || "").toLowerCase() === project.currentOwnerTeam);
    if (ownTeam.length === 0) {
      const next = project.currentOwnerTeam === "mint" ? "integration" : project.currentOwnerTeam === "integration" ? "ms" : null;
      if (next) return { label: `Transfer to ${getTeamLabel(next)}`, hint: undefined };
    }
    const pool = ownTeam.length > 0 ? ownTeam : open;
    const pick = [...pool].sort((a, b) =>
      (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity),
    )[0];
    const overdue = pick.dueDate ? new Date(pick.dueDate) < new Date() : false;
    return { label: pick.title, hint: overdue ? "Overdue" : pick.dueDate ? `due ${shortDate(pick.dueDate)}` : undefined };
  }, [project]);

  // ── FILTER PILLS CONFIG ──
  const filterPills: Array<{ value: StatusFilterValue; label: string; count: number; highlight?: boolean }> = [
    { value: "all", label: "All", count: filterCounts.all },
    { value: "todo", label: "To do", count: filterCounts.todo },
    { value: "in_progress", label: "In progress", count: filterCounts.in_progress },
    { value: "completed", label: "Completed", count: filterCounts.completed },
    { value: "overdue", label: "Overdue", count: filterCounts.overdue, highlight: filterCounts.overdue > 0 },
  ];

  // ── Shared sub-dialogs JSX ──
  const subDialogs = (
    <>
      {formDialogState && project && (
        <ChecklistFormDialog
          open={formDialogState.open}
          onOpenChange={(o) => { if (!o) setFormDialogState(null); }}
          projectId={project.id}
          projectName={project.merchantName}
          checklistItemId={formDialogState.checklistItemId}
          checklistItemTitle={formDialogState.checklistItemTitle}
          formTemplateId={formDialogState.formTemplateId}
          formTemplateName={formDialogState.formTemplateName}
        />
      )}
      {taskDialogState && project && (
        <TaskManagementDialog
          open={taskDialogState.open}
          onOpenChange={(o) => { if (!o) setTaskDialogState(null); }}
          checklistItemId={taskDialogState.checklistItemId}
          checklistItemTitle={taskDialogState.checklistItemTitle}
          projectId={project.id}
          profiles={profiles}
        />
      )}
      {meetingDialogState && project && (
        <MeetingSchedulerDialog
          open={meetingDialogState.open}
          onOpenChange={(o) => { if (!o) setMeetingDialogState(null); }}
          checklistItemId={meetingDialogState.checklistItemId}
          checklistItemTitle={meetingDialogState.checklistItemTitle}
          projectId={project.id}
          projectName={project.merchantName}
        />
      )}
    </>
  );

  /* ================================================================
   * DIALOG VARIANT — preserved as-is
   * ================================================================ */
  if (variant !== "inline") {
    return (
      <Shell variant={variant} open={open} onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
              <ClipboardList className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <span className="text-xl">Project Checklist</span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">{project.merchantName}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-6">
            {orderedTeams.map((team) => {
              const items = groupedByTeam[team];
              const isOwnTeam = team === userTeam;
              const canEditSection = hasFullChecklistAccess || isOwnTeam;
              const teamCount = teamCounts[team];
              const checklistItems = items.filter(i => !i.isTask);

              return (
                <div key={team} className={canEditSection ? "" : "opacity-60"}>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getTeamColor(team) }} />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{getTeamLabel(team)}</h3>
                        <p className="text-xs text-muted-foreground">{teamCount?.completed} of {teamCount?.total} done</p>
                      </div>
                    </div>
                    {isOwnTeam && <span className="text-xs text-muted-foreground">Your team</span>}
                  </div>

                  <div className="space-y-3 pl-2 ml-4">
                    {checklistItems.map((item, index) => {
                      const timeStats = calculateTimeByParty(item.responsibilityLog);
                      const canEdit = canEditChecklistItem(item.ownerTeam || "");
                      const itemTasks = allTasks.filter(t => t.checklist_item_id === item.id);
                      const itemMeetings = allMeetings.filter(m => m.checklist_item_id === item.id);

                      return (
                        <div key={item.id} id={`checklist-item-${item.id}`}
                          className={`p-4 rounded-xl border transition-all scroll-mt-24 ${item.completed ? "bg-success/5 border-success/30" : "bg-card border-border hover:border-primary/30 hover:shadow-md"}`}
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-mono p-0">{index + 1}</Badge>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild>
                                <div><Checkbox checked={item.completed} onCheckedChange={(checked) => { if (canEdit) updateChecklist(project.id, item.id, checked as boolean); }} disabled={!canEdit} className="h-5 w-5" /></div>
                              </TooltipTrigger><TooltipContent>{!canEdit ? "Only team members can complete this" : item.completed ? "Click to mark as incomplete" : "Click to mark as complete"}</TooltipContent></Tooltip></TooltipProvider>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</span>
                                {item.completed && <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />}
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                  {(() => { const tid = checklistTemplatesByTitle[item.title]; const fi = tid ? formsByChecklistTemplateId.get(tid) : undefined; if (!fi) return null; return (<Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium" onClick={(e) => { e.stopPropagation(); setFormDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title, formTemplateId: fi.formTemplateId, formTemplateName: fi.formTemplateName }); }}><FileText className="h-3 w-3" />{fi.formTemplateName}</Button>); })()}
                                  {(() => { const tc = allTasks.filter(t => t.checklist_item_id === item.id).length; const oc = allTasks.filter(t => t.checklist_item_id === item.id && t.status !== "done").length; return (<Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium" onClick={(e) => { e.stopPropagation(); setTaskDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title }); }}><Plus className="h-3 w-3" />Task{tc > 0 ? ` (${oc}/${tc})` : ""}</Button>); })()}
                                  {(() => { const im = allMeetings.filter(m => m.checklist_item_id === item.id); const up = im.filter(m => m.status === "scheduled" && new Date(m.scheduled_at) >= new Date()).length; return (<Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium" onClick={(e) => { e.stopPropagation(); setMeetingDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title }); }}><Plus className="h-3 w-3" />Meeting{im.length > 0 ? ` (${up}/${im.length})` : ""}</Button>); })()}
                                </div>
                              </div>
                              {(item.dueDate || (canEdit && !item.completed)) && (
                                <div className="flex items-center gap-2 mb-2">
                                  <Calendar className="h-3 w-3 text-muted-foreground" />
                                  {item.dueDate ? (<span className={`text-xs ${!item.completed && new Date(item.dueDate) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}>Due: {shortDate(item.dueDate)}{!item.completed && new Date(item.dueDate) < new Date() && " (Overdue)"}</span>) : (<span className="text-xs text-muted-foreground">No due date</span>)}
                                  {canEdit && !item.completed && (<Input type="date" defaultValue={item.dueDate || ""} aria-label="Due date" className="h-6 w-32 text-xs px-1" onChange={async (e) => { const nd = e.target.value || null; await supabase.from("checklist_items").update({ due_date: nd }).eq("id", item.id); queryClient.invalidateQueries({ queryKey: ["projects"] }); }} />)}
                                </div>
                              )}
                              {item.completedBy && (<p className="text-xs text-muted-foreground mb-2">✓ Completed by {item.completedBy}{item.completedAt && ` on ${shortDate(item.completedAt)}`}</p>)}
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1"><Building2 className="h-3 w-3 text-primary" /><span>{responsibilityLabels.gokwik}: {formatDuration(timeStats.gokwik)}</span></div>
                                <div className="flex items-center gap-1"><Users className="h-3 w-3 text-warning-strong" /><span>{responsibilityLabels.merchant}: {formatDuration(timeStats.merchant)}</span></div>
                              </div>
                              <ChecklistCommentThread checklistItemId={item.id} checklistItemTitle={item.title} projectId={project.id} projectName={project.merchantName} focusSignal={commentPrompt?.itemId === item.id ? commentPrompt.at : undefined} />
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <ToggleGroup type="single" value={item.currentResponsibility} onValueChange={(v) => handleResponsibilityChange(item.id, v)} disabled={item.completed || !canEdit} className="gap-0 border rounded-lg overflow-hidden">
                                <ToggleGroupItem value="gokwik" aria-label={responsibilityLabels.gokwik} className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-primary data-[state=on]:text-white"><Building2 className="h-3 w-3 mr-1" />{responsibilityLabels.gokwik}</ToggleGroupItem>
                                <ToggleGroupItem value="neutral" aria-label={responsibilityLabels.neutral} className="text-xs px-3 py-1.5 h-8 rounded-none border-x data-[state=on]:bg-muted"><Minus className="h-3 w-3" /></ToggleGroupItem>
                                <ToggleGroupItem value="merchant" aria-label={responsibilityLabels.merchant} className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-warning data-[state=on]:text-warning-foreground"><Users className="h-3 w-3 mr-1" />{responsibilityLabels.merchant}</ToggleGroupItem>
                              </ToggleGroup>
                            </div>
                          </div>

                          {(() => {
                            const hasSubItems = itemTasks.length > 0 || itemMeetings.length > 0;
                            return !hasSubItems ? null : (
                              <div className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 md:grid-cols-2">
                                <div className="min-w-0">
                                  <div className="mb-1.5 flex items-center gap-2 px-1">
                                    <ListTodo className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</span>
                                    <span className="text-xs text-muted-foreground">{itemTasks.filter(t => t.status === "done").length} of {itemTasks.length} done</span>
                                    <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setTaskDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title }); }}><Plus className="h-3 w-3" />Add task</Button>
                                  </div>
                                  <div className="space-y-1">
                                    {itemTasks.map(task => {
                                      const od = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                                      return (
                                        <div key={task.id} id={`task-${task.id}`} className="group flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/30">
                                          <Checkbox checked={task.status === "done"} onCheckedChange={(checked) => { updateTaskMutation.mutate({ id: task.id, status: checked ? "done" : "open" }); if (checked) toast.success(`Completed "${task.title}"`, { action: { label: "Add comment", onClick: () => setCommentPrompt({ itemId: item.id, at: Date.now() }) } }); }} className="h-4 w-4 shrink-0" />
                                          <span className={`flex-1 truncate text-sm ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</span>
                                          {task.assigned_to && <span className="shrink-0 text-2xs text-muted-foreground">{profiles.find(p => p.id === task.assigned_to)?.name || task.assigned_to}</span>}
                                          {task.due_date && <span className={`flex shrink-0 items-center gap-0.5 text-2xs ${od ? "font-medium text-destructive" : "text-muted-foreground"}`}><Calendar className="h-2.5 w-2.5" />{shortDate(task.due_date)}</span>}
                                          <Button variant="ghost" size="sm" className="h-5 w-5 shrink-0 p-0 text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100" onClick={() => deleteTaskMutation.mutate(task.id)}><Trash2 className="h-3 w-3" /></Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div className="min-w-0 md:border-l md:border-border/60 md:pl-2">
                                  <div className="mb-1.5 flex items-center gap-2 px-1">
                                    <Video className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meetings</span>
                                    <span className="text-xs text-muted-foreground">{itemMeetings.length}</span>
                                    <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setMeetingDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title }); }}><Plus className="h-3 w-3" />Schedule</Button>
                                  </div>
                                  {itemMeetings.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">No meetings for this step yet.</p> : <ChecklistItemMeetings meetings={itemMeetings} />}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {subDialogs}
      </Shell>
    );
  }

  /* ================================================================
   * INLINE VARIANT — new 3-column layout
   * ================================================================ */
  const progressPct = selectedGroupData
    ? Math.round((selectedGroupData.completed / Math.max(selectedGroupData.total, 1)) * 100)
    : 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Column A: Groups sidebar ──────────────────────────────── */}
      <div className="w-52 shrink-0 border-r border-border/60 flex flex-col overflow-hidden bg-card">
        {/* Sidebar header */}
        <div className="shrink-0 border-b border-border/50 px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">
              {groupBy === "stages" ? "Project stages" : "Teams"}
            </span>
          </div>
          <ToggleGroup
            type="single"
            value={groupBy}
            onValueChange={(v) => { if (v) { setGroupBy(v as "teams" | "stages"); setSelectedGroup(null); setStatusFilter("all"); } }}
            className="w-full"
          >
            <ToggleGroupItem value="stages" className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Stages
            </ToggleGroupItem>
            <ToggleGroupItem value="teams" className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              Teams
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Group list */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {activeGroups.map((group) => {
              const isSelected = group.key === effectiveSelectedGroup;
              const r = 7;
              const circ = 2 * Math.PI * r;
              const dash = (group.completed / Math.max(group.total, 1)) * circ;
              const allDone = group.completed === group.total && group.total > 0;

              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => { setSelectedGroup(group.key); setStatusFilter("all"); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2",
                    isSelected
                      ? "bg-primary/8 border-primary"
                      : "border-transparent hover:bg-muted/50",
                  )}
                >
                  {/* Circle progress */}
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 18 18">
                    <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
                    {group.completed > 0 && (
                      <circle
                        cx="9" cy="9" r={r}
                        fill="none"
                        stroke={allDone ? "#10b981" : isSelected ? "#2166F3" : group.color}
                        strokeWidth="1.5"
                        strokeDasharray={`${dash} ${circ}`}
                        strokeLinecap="round"
                        style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
                      />
                    )}
                    {allDone && (
                      <path d="M6.5 9.2l1.8 1.8 3.2-3.6" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    )}
                  </svg>

                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", isSelected ? "text-primary" : "text-foreground")}>{group.label}</p>
                    <p className="text-xs text-muted-foreground">{group.completed} / {group.total} done</p>
                  </div>

                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform", isSelected && "rotate-180")} />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ── Column B: Task table ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Stage header */}
        <div className="shrink-0 border-b border-border/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{selectedGroupData?.label ?? "—"}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedGroupData?.completed ?? 0} of {selectedGroupData?.total ?? 0} tasks done
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => {
                const first = selectedGroupData?.items?.[0];
                if (first) setTaskDialogState({ open: true, checklistItemId: first.id, checklistItemTitle: first.title });
              }}>
                <Plus className="h-3 w-3" />Task
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => {
                const first = selectedGroupData?.items?.[0];
                if (first) setMeetingDialogState({ open: true, checklistItemId: first.id, checklistItemTitle: first.title });
              }}>
                <Plus className="h-3 w-3" />Meeting
              </Button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-2.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Filter pills */}
        <div className="shrink-0 border-b border-border/30 px-4 py-2 flex items-center gap-1.5 overflow-x-auto">
          {filterPills.map((pill) => (
            <button
              key={pill.value}
              type="button"
              onClick={() => setStatusFilter(pill.value)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full border whitespace-nowrap transition-colors",
                statusFilter === pill.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : pill.highlight && statusFilter !== pill.value
                    ? "border-destructive/40 text-destructive bg-destructive/5"
                    : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
          <span className="flex-1" />
          <Select value="all">
            <SelectTrigger className="h-7 w-28 text-xs border-border">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Task table */}
        <ScrollArea className="flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border/50">
                <th className="w-10 text-left px-3 py-2 text-xs font-medium text-muted-foreground">#</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Task</th>
                <th className="w-28 text-left px-3 py-2 text-xs font-medium text-muted-foreground">Due date</th>
                <th className="w-36 text-left px-3 py-2 text-xs font-medium text-muted-foreground">Assignee</th>
                <th className="w-24 text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                <th className="w-24 text-left px-3 py-2 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, index) => {
                const status = getItemStatus(item);
                const assignee = getAssignee(item);
                const canEdit = canEditChecklistItem(item.ownerTeam || "");
                const taskCount = allTasks.filter(t => t.checklist_item_id === item.id).length;
                const commentCount = item.comment ? 1 : 0;
                const isExpanded = expandedItemId === item.id;
                const templateId = checklistTemplatesByTitle[item.title];
                const formInfo = templateId ? formsByChecklistTemplateId.get(templateId) : undefined;

                return (
                  <Fragment key={item.id}>
                    <tr
                      id={`checklist-item-${item.id}`}
                      className={cn(
                        "group border-b border-border/30 transition-colors scroll-mt-24",
                        item.completed ? "bg-success/3" : "hover:bg-muted/30",
                      )}
                    >
                      {/* Row number */}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground align-middle">{index + 1}</td>

                      {/* Checkbox + Title */}
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-2.5">
                          <Checkbox
                            checked={item.completed}
                            onCheckedChange={(checked) => { if (canEdit) updateChecklist(project.id, item.id, checked as boolean); }}
                            disabled={!canEdit}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className={cn("font-medium", item.completed && "line-through text-muted-foreground")}>{item.title}</span>
                          {taskCount > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <MessageSquare className="h-3 w-3" />{taskCount}
                            </span>
                          )}
                          {commentCount > 0 && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      </td>

                      {/* Due date */}
                      <td className="px-3 py-2.5 align-middle">
                        {item.dueDate ? (
                          <span className={cn("text-xs", status === "overdue" ? "text-destructive font-medium" : "text-muted-foreground")}>
                            {shortDate(item.dueDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Assignee */}
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground shrink-0">
                            {assignee.charAt(0).toUpperCase()}{assignee.split(" ")[1]?.[0]?.toUpperCase() || ""}
                          </span>
                          <span className="text-xs truncate max-w-24">{assignee}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 align-middle">
                        <StatusBadge status={status} />
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                            className={cn("p-1 rounded hover:bg-muted transition-colors", isExpanded && "bg-muted")}
                            title="Toggle details"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setTaskDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title })}
                            className="p-1 rounded hover:bg-muted"
                            title="Manage tasks"
                          >
                            <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="p-1 rounded hover:bg-muted">
                                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {formInfo && (
                                <DropdownMenuItem onSelect={() => setFormDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title, formTemplateId: formInfo.formTemplateId, formTemplateName: formInfo.formTemplateName })}>
                                  <FileText className="mr-2 h-3.5 w-3.5" />{formInfo.formTemplateName}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => setMeetingDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title })}>
                                <Video className="mr-2 h-3.5 w-3.5" />Schedule meeting
                              </DropdownMenuItem>
                              {!item.completed && canEdit && item.dueDate && (
                                <DropdownMenuItem onSelect={async () => {
                                  await supabase.from("checklist_items").update({ due_date: null }).eq("id", item.id);
                                  queryClient.invalidateQueries({ queryKey: ["projects"] });
                                }}>
                                  <Calendar className="mr-2 h-3.5 w-3.5" />Clear due date
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-muted/20 border-b border-border/30">
                          <div className="space-y-3">
                            {/* Responsibility toggle */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground">Waiting on:</span>
                              <ToggleGroup
                                type="single"
                                value={item.currentResponsibility}
                                onValueChange={(v) => handleResponsibilityChange(item.id, v)}
                                disabled={item.completed || !canEdit}
                                className="gap-0 border rounded-lg overflow-hidden"
                              >
                                <ToggleGroupItem value="gokwik" className="text-xs px-2.5 py-1 h-7 rounded-none data-[state=on]:bg-primary data-[state=on]:text-white">
                                  <Building2 className="h-3 w-3 mr-1" />{responsibilityLabels.gokwik}
                                </ToggleGroupItem>
                                <ToggleGroupItem value="neutral" className="text-xs px-2.5 py-1 h-7 rounded-none border-x data-[state=on]:bg-muted">
                                  <Minus className="h-3 w-3" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="merchant" className="text-xs px-2.5 py-1 h-7 rounded-none data-[state=on]:bg-warning data-[state=on]:text-warning-foreground">
                                  <Users className="h-3 w-3 mr-1" />{responsibilityLabels.merchant}
                                </ToggleGroupItem>
                              </ToggleGroup>
                            </div>

                            {/* Due date editor */}
                            {canEdit && !item.completed && (
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Due date:</span>
                                <Input
                                  type="date"
                                  defaultValue={item.dueDate || ""}
                                  className="h-6 w-32 text-xs px-1"
                                  onChange={async (e) => {
                                    const nd = e.target.value || null;
                                    await supabase.from("checklist_items").update({ due_date: nd }).eq("id", item.id);
                                    queryClient.invalidateQueries({ queryKey: ["projects"] });
                                  }}
                                />
                              </div>
                            )}

                            {/* Time stats */}
                            {(() => {
                              const ts = calculateTimeByParty(item.responsibilityLog);
                              return (
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3 text-primary" />{responsibilityLabels.gokwik}: {formatDuration(ts.gokwik)}</span>
                                  <span className="flex items-center gap-1"><Users className="h-3 w-3 text-warning-strong" />{responsibilityLabels.merchant}: {formatDuration(ts.merchant)}</span>
                                </div>
                              );
                            })()}

                            {/* Comment thread */}
                            <ChecklistCommentThread
                              checklistItemId={item.id}
                              checklistItemTitle={item.title}
                              projectId={project.id}
                              projectName={project.merchantName}
                              focusSignal={commentPrompt?.itemId === item.id ? commentPrompt.at : undefined}
                            />

                            {/* Sub-tasks */}
                            {(() => {
                              const itemTasks = allTasks.filter(t => t.checklist_item_id === item.id);
                              if (itemTasks.length === 0) return null;
                              return (
                                <div className="rounded-lg border border-border/50 bg-card p-2">
                                  <div className="flex items-center gap-2 mb-1.5 px-1">
                                    <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold text-muted-foreground">Tasks</span>
                                    <span className="text-xs text-muted-foreground">{itemTasks.filter(t => t.status === "done").length}/{itemTasks.length}</span>
                                  </div>
                                  <div className="space-y-1">
                                    {itemTasks.map(task => (
                                      <div key={task.id} id={`task-${task.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/30">
                                        <Checkbox
                                          checked={task.status === "done"}
                                          onCheckedChange={(checked) => {
                                            updateTaskMutation.mutate({ id: task.id, status: checked ? "done" : "open" });
                                            if (checked) toast.success(`Completed "${task.title}"`, { action: { label: "Add comment", onClick: () => setCommentPrompt({ itemId: item.id, at: Date.now() }) } });
                                          }}
                                          className="h-3.5 w-3.5 shrink-0"
                                        />
                                        <span className={cn("flex-1 truncate text-xs", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
                                        {task.due_date && <span className="text-2xs text-muted-foreground">{shortDate(task.due_date)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Add new task row */}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:bg-muted/30 border-t border-border/30"
            onClick={() => {
              const first = selectedGroupData?.items?.[0];
              if (first) setTaskDialogState({ open: true, checklistItemId: first.id, checklistItemTitle: first.title });
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add new task
          </button>
        </ScrollArea>
      </div>

      {/* ── Column C: Project details panel ───────────────────────── */}
      <div className="w-64 shrink-0 border-l border-border/60 flex flex-col overflow-hidden bg-card">
        <Tabs value={detailsTab} onValueChange={(v) => setDetailsTab(v as typeof detailsTab)} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 rounded-none border-b border-border/50 bg-transparent px-1 justify-start gap-0 h-auto">
            <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Details
            </TabsTrigger>
            <TabsTrigger value="people" className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              People
            </TabsTrigger>
            <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Activity
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            {/* Details tab */}
            <TabsContent value="details" className="m-0 p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">Project details</span>
                {onEditProject && (
                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1 px-2" onClick={onEditProject}>
                    <Pencil className="h-3 w-3" />Edit
                  </Button>
                )}
              </div>

              <dl className="space-y-2.5">
                {/* Project state */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Project state</dt>
                  <dd>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATE_TONE[project.projectState] || "bg-muted text-muted-foreground")}>
                      {projectStateLabels[project.projectState as ProjectState] || project.projectState}
                    </span>
                  </dd>
                </div>

                {/* Expected go-live */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Expected go-live</dt>
                  <dd className="text-xs font-medium text-foreground">
                    {friendlyDate(project.dates.expectedGoLiveDate)}
                    {project.dates.expectedGoLiveDate && (
                      <span className="text-muted-foreground ml-1">({daysRelative(project.dates.expectedGoLiveDate)})</span>
                    )}
                  </dd>
                </div>

                {/* Next action */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Next action</dt>
                  <dd className="text-xs font-medium text-foreground">
                    {nextStep.label}
                    {nextStep.hint && (
                      <span className={cn("block text-2xs mt-0.5", nextStep.hint === "Overdue" ? "text-destructive font-medium" : "text-muted-foreground")}>
                        {nextStep.hint === "Overdue" ? "◆ Overdue" : nextStep.hint}
                      </span>
                    )}
                  </dd>
                </div>

                {/* Revenue */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Revenue</dt>
                  <dd className="text-xs font-medium text-foreground">₹{formatArrCr(project.arr)}</dd>
                </div>

                {/* Project owner */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Project owner</dt>
                  <dd className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground shrink-0">
                      {(project.assignedOwnerName || "U").charAt(0).toUpperCase()}
                    </span>
                    {project.assignedOwnerName || "Unassigned"}
                  </dd>
                </div>

                {/* Client */}
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Client</dt>
                  <dd className="text-xs font-medium text-foreground">{project.merchantName}</dd>
                </div>

                {/* Description */}
                {project.notes.projectNotes && (
                  <div>
                    <dt className="text-2xs text-muted-foreground mb-0.5">Description</dt>
                    <dd className="text-xs text-muted-foreground whitespace-pre-line">{project.notes.projectNotes}</dd>
                  </div>
                )}
              </dl>

              {/* Attachments section */}
              <div className="mt-4 border-t border-border/50 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">
                    Attachments ({(project.links.brdLink ? 1 : 0) + (project.links.sowLink ? 1 : 0)})
                  </span>
                  {onEditProject && (
                    <Button size="sm" variant="ghost" className="h-5 text-xs px-1 text-primary" onClick={onEditProject}>+ Add</Button>
                  )}
                </div>
                {project.links.brdLink && (
                  <a href={project.links.brdLink} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                    <FileStack className="h-4 w-4 text-destructive shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">BRD Document</p>
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                  </a>
                )}
                {project.links.sowLink && (
                  <a href={project.links.sowLink} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                    <FileText className="h-4 w-4 text-info shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">SOW Document</p>
                    </div>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                  </a>
                )}
                {!project.links.brdLink && !project.links.sowLink && (
                  <p className="text-xs text-muted-foreground">No attachments yet.</p>
                )}
              </div>
            </TabsContent>

            {/* People tab */}
            <TabsContent value="people" className="m-0 p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">People</span>
                {onAssignOwner && (
                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1 px-2" onClick={onAssignOwner}>
                    <UserRound className="h-3 w-3" />Assign
                  </Button>
                )}
              </div>
              <dl className="space-y-3">
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Project owner</dt>
                  <dd className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground shrink-0">
                      {(project.assignedOwnerName || "U").charAt(0).toUpperCase()}
                    </span>
                    {project.assignedOwnerName || "Unassigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Sales SPOC</dt>
                  <dd className="text-xs font-medium text-foreground">{project.salesSpoc || "—"}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Contact email</dt>
                  <dd className="text-xs font-medium text-foreground">{project.contactEmail || "—"}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-muted-foreground mb-0.5">Current team</dt>
                  <dd className="text-xs font-medium text-foreground">{getTeamLabel(project.currentOwnerTeam)}</dd>
                </div>
              </dl>
            </TabsContent>

            {/* Activity tab */}
            <TabsContent value="activity" className="m-0 h-full min-h-[300px]">
              <ProjectActivityHistoryPanel projectId={project.id} height="100%" />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {subDialogs}
    </div>
  );
};
