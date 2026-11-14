import React, { useMemo, useEffect, useRef, useState, Fragment, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Project,
  calculateTimeByParty,
  formatDuration,
  ResponsibilityParty,
  projectStateLabels,
  ProjectState,
  ProjectChecklist,
} from "@/data/projectsData";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectDeepLink, useScrollToAnchor } from "@/hooks/useProjectDeepLink";
import { useLabels } from "@/contexts/LabelsContext";
import { useFormAssignments, useFormTemplates } from "@/hooks/useChecklistForms";
import { useMerchantPortalUploads } from "@/hooks/useMerchantPortalUploads";
import { useChecklistSets } from "@/hooks/useChecklistSets";
import { useTeams } from "@/hooks/useTeams";
import { useProfilesLookup, useChecklistTemplateTitles } from "@/hooks/useLookups";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChecklistCommentThread } from "@/components/ChecklistCommentThread";
import { ChecklistFormDialog } from "@/components/ChecklistFormDialog";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { ChecklistItemMeetings } from "@/components/ChecklistItemMeetings";
import {
  useChecklistTasks,
  useAddChecklistTask,
  useUpdateChecklistTask,
  useDeleteChecklistTask,
} from "@/hooks/useChecklistTasks";
import { useAddChecklistComment } from "@/hooks/useChecklistComments";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { useChecklistActivity } from "@/hooks/useChecklistActivity";
import { formatArrCr } from "@/lib/arr";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ClipboardList,
  Minus,
  FileText,
  ListTodo,
  Trash2,
  Calendar,
  Video,
  Building2,
  Users,
  Plus,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  ExternalLink,
  IndianRupee,
  UserRound,
  ChevronDown,
  FileStack,
  Paperclip,
  Copy,
  CheckSquare,
  Square,
  X,
  Activity,
  GitBranch,
  CalendarPlus,
  Tag,
  GripVertical,
  Eye,
  EyeOff,
} from "lucide-react";

/** "9 Sep 2026" */
const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Stage slugs in display order */

const STAGE_ORDER = ["mint", "integration", "ms", "completed"];

type ItemStatus = "completed" | "overdue" | "in_progress" | "upcoming" | "todo";

const STATUS_CONFIG: Record<ItemStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-success/15 text-success-strong" },
  overdue: { label: "Overdue", className: "bg-destructive/15 text-destructive font-medium" },
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

const getItemStatus = (item: ProjectChecklist): ItemStatus => {
  if (item.completed) return "completed";
  const now = new Date();
  if (item.dueDate && new Date(item.dueDate) < now) return "overdue";
  if (item.currentResponsibility !== "neutral") return "in_progress";
  if (item.dueDate && new Date(item.dueDate) >= now) return "upcoming";
  return "todo";
};

/** §8.1 Health & Risk Flags — colored dot indicators derived from existing fields */
type HealthFlag = { key: string; color: string; title: string };
const getHealthFlags = (item: ProjectChecklist): HealthFlag[] => {
  if (item.completed) return [];
  const now = new Date();
  const flags: HealthFlag[] = [];
  if (item.dueDate && new Date(item.dueDate) < now) {
    flags.push({ key: "overdue", color: "bg-red-500", title: "Overdue" });
  } else if (item.dueDate) {
    const daysLeft = Math.ceil((new Date(item.dueDate).getTime() - now.getTime()) / 86_400_000);
    if (daysLeft <= 3) flags.push({ key: "at_risk", color: "bg-amber-400", title: `At risk (${daysLeft}d)` });
  } else {
    flags.push({ key: "no_date", color: "bg-slate-300 dark:bg-slate-600", title: "No due date" });
  }
  if (item.status === "blocked") {
    flags.push({ key: "blocked", color: "bg-blue-500", title: "Blocked" });
  }
  return flags;
};

/** §8.5 SLA chip for completed items */
const SlaChip = ({ item }: { item: ProjectChecklist }) => {
  if (!item.completed || !item.slaDays || !item.startDate || !item.completedAt) return null;
  const msPerDay = 86_400_000;
  const actual = Math.round((new Date(item.completedAt).getTime() - new Date(item.startDate).getTime()) / msPerDay);
  const variance = actual - item.slaDays;
  if (variance <= 0) {
    return (
      <span className="ml-1 inline-flex items-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-2xs px-1.5 py-0 font-medium">
        {Math.abs(variance)}d early
      </span>
    );
  }
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-2xs px-1.5 py-0 font-medium">
      {variance}d late
    </span>
  );
};

const StatusBadge = ({ status }: { status: ItemStatus }) => {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        config.className,
      )}
    >
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
  v
    ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

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

/* ── Right-panel field picker ─────────────────────────────────────── */

type FieldDef = { key: string; label: string; group?: string };

const DETAILS_FIELDS: FieldDef[] = [
  { key: "project_state",    label: "Project state" },
  { key: "expected_golive",  label: "Expected go-live" },
  { key: "next_action",      label: "Next action" },
  { key: "revenue",          label: "Revenue" },
  { key: "project_owner",    label: "Project owner" },
  { key: "client",           label: "Client" },
  { key: "description",      label: "Description" },
  { key: "mid",              label: "MID" },
  { key: "platform",         label: "Platform" },
  { key: "integration_type", label: "Integration type" },
  { key: "pg_onboarding",    label: "PG Onboarding" },
  { key: "txns_per_day",     label: "Txns/Day" },
  { key: "aov",              label: "AOV" },
  { key: "category",         label: "Category" },
  { key: "sales_spoc",       label: "Sales SPOC" },
  { key: "brand_url",        label: "Brand URL" },
  { key: "kick_off_date",    label: "Kick-off date" },
  { key: "go_live_date",     label: "Go-live date" },
];

const PEOPLE_FIELDS: FieldDef[] = [
  { key: "project_owner",  label: "Project owner" },
  { key: "sales_spoc",     label: "Sales SPOC" },
  { key: "contact_email",  label: "Contact email" },
  { key: "current_team",   label: "Current team" },
  { key: "current_stage",  label: "Current stage" },
];

const DETAILS_DEFAULTS = ["project_state", "expected_golive", "next_action", "revenue", "project_owner", "client", "description"];
const PEOPLE_DEFAULTS  = ["project_owner", "sales_spoc", "contact_email", "current_team"];

function loadFields(key: string, defaults: string[]): string[] {
  try {
    const v = localStorage.getItem(key);
    if (v) return JSON.parse(v) as string[];
  } catch { /* ignore */ }
  return defaults;
}

function saveFields(key: string, value: string[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function FieldPickerDialog({
  open,
  onOpenChange,
  title,
  allFields,
  selected,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  allFields: FieldDef[];
  selected: string[];
  onApply: (keys: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  useEffect(() => { if (open) setDraft(selected); }, [open, selected]);

  const toggle = (key: string) =>
    setDraft((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Select which fields to show</p>
        </DialogHeader>
        <div className="px-4 py-3 space-y-2 max-h-72 overflow-y-auto">
          {allFields.map((f) => (
            <label key={f.key} className="flex items-center gap-2.5 cursor-pointer group">
              <Checkbox
                checked={draft.includes(f.key)}
                onCheckedChange={() => toggle(f.key)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs group-hover:text-foreground text-muted-foreground transition-colors">
                {f.label}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => { onApply(draft); onOpenChange(false); }}>Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Component ────────────────────────────────────────────────────── */

interface ChecklistDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "dialog" | "inline";
  onEditProject?: () => void;
  onAssignOwner?: () => void;
  onTransferProject?: () => void;
  initialExpandedItemId?: string;
}

function SortableGroupButton({
  id,
  children,
  className,
  onClick,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="relative group/grip"
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
      >
        {children}
      </button>
      <button
        {...attributes}
        {...listeners}
        className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/grip:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-opacity px-0.5"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3" />
      </button>
    </div>
  );
}

function SortableTr({
  id,
  children,
  className,
  onClick,
  style,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement> & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, ...style }}
      className={className}
      onClick={onClick}
      {...rest}
    >
      <td className="w-6 px-1 align-middle">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab text-muted-foreground/30 hover:text-muted-foreground active:cursor-grabbing"
          tabIndex={-1}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      {children}
    </tr>
  );
}

export const ChecklistDialog = ({
  project,
  open,
  onOpenChange,
  variant = "dialog",
  onEditProject,
  onAssignOwner,
  onTransferProject,
  initialExpandedItemId,
}: ChecklistDialogProps) => {
  const { updateChecklist, toggleChecklistResponsibility, updateProject } = useProjects();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { teamLabels, responsibilityLabels, stageLabels } = useLabels();
  const { assignments } = useFormAssignments();
  const { templates: formTemplates } = useFormTemplates();
  const { sets: checklistSets } = useChecklistSets();
  const checklistSetName = project?.checklistSetId
    ? (checklistSets.find((s) => s.id === project.checklistSetId)?.name ?? null)
    : null;
  const { allTeams, teamLabelMap, teamColorMap, checklistTeamSlugs } = useTeams();
  const { data: allTasks = [] } = useChecklistTasks(project?.id);
  const { data: allMeetings = [] } = useChecklistMeetings(project?.id);
  const { data: activityEvents = [] } = useChecklistActivity(project?.id);
  const addTaskMutation = useAddChecklistTask();
  const updateTaskMutation = useUpdateChecklistTask();
  const deleteTaskMutation = useDeleteChecklistTask();
  const addCommentMutation = useAddChecklistComment();

  // Task completion comment: tracks which task is awaiting an inline note.
  const [taskCommentPending, setTaskCommentPending] = useState<{
    taskId: string;
    itemId: string;
    text: string;
  } | null>(null);

  // Dialog state
  const [taskDialogState, setTaskDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
    task?: { id: string; title: string; description?: string | null; assigned_to?: string | null; due_date?: string | null };
  } | null>(null);
  const [addItemState, setAddItemState] = useState<{ team: string } | null>(null);
  const [addItemTitle, setAddItemTitle] = useState("");

  const handleAddItem = async (team: string, title: string) => {
    if (!title.trim() || !project) return;
    await supabase.from("checklist_items").insert({
      project_id: project.id,
      tenant_id: currentUser?.tenantId ?? null,
      title: title.trim(),
      owner_team: team,
      completed: false,
      is_task: false,
      current_responsibility: "neutral",
    });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setAddItemState(null);
    setAddItemTitle("");
  };

  const [meetingDialogState, setMeetingDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
  } | null>(null);

  const deepLink = useProjectDeepLink();
  useScrollToAnchor(deepLink.task ? `task-${deepLink.task}` : null, !!project);
  useScrollToAnchor(deepLink.item ? `checklist-item-${deepLink.item}` : null, !!project);

  const [commentPrompt, setCommentPrompt] = useState<{ itemId: string; at: number } | null>(null);
  const { profiles } = useProfilesLookup();
  const { data: portalUploads = [] } = useMerchantPortalUploads(project?.id);
  const customerUploads = portalUploads.filter((u) => u.upload_type === "customer_document" || u.uploaded_by === "merchant");

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
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [detailsTab, setDetailsTab] = useState<"details" | "people" | "activity">("details");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(initialExpandedItemId ?? null);

  // Right-panel field visibility (persisted in localStorage)
  const [visibleDetailsFields, setVisibleDetailsFields] = useState<string[]>(() => loadFields("checklist_details_fields", DETAILS_DEFAULTS));
  const [visiblePeopleFields,  setVisiblePeopleFields]  = useState<string[]>(() => loadFields("checklist_people_fields",  PEOPLE_DEFAULTS));
  const [detailsPickerOpen, setDetailsPickerOpen] = useState(false);
  const [peoplePickerOpen,  setPeoplePickerOpen]  = useState(false);

  const applyDetailsFields = (keys: string[]) => { setVisibleDetailsFields(keys); saveFields("checklist_details_fields", keys); };
  const applyPeopleFields  = (keys: string[]) => { setVisiblePeopleFields(keys);  saveFields("checklist_people_fields",  keys); };

  // §4.3 Bulk edit mode
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  function toggleBulkItem(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkComplete() {
    if (!project) return;
    const ids = [...selectedItemIds];
    await Promise.all(ids.map((id) =>
      supabase.from("checklist_items").update({
        completed: true, status: "done",
        completed_at: new Date().toISOString(),
        completed_by: currentUser?.name || "Unknown",
      }).eq("id", id)
    ));
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setSelectedItemIds(new Set());
    setBulkSelectMode(false);
  }

  async function bulkDelete() {
    if (!project) return;
    const ids = [...selectedItemIds];
    await Promise.all(ids.map((id) =>
      supabase.from("checklist_items").delete().eq("id", id)
    ));
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setSelectedItemIds(new Set());
    setBulkSelectMode(false);
  }

  async function bulkChangeTeam(team: string) {
    if (!project) return;
    const ids = [...selectedItemIds];
    await Promise.all(ids.map((id) =>
      supabase.from("checklist_items").update({ owner_team: team }).eq("id", id)
    ));
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setSelectedItemIds(new Set());
    setBulkSelectMode(false);
  }

  const formsByChecklistTemplateId = useMemo(() => {
    const map = new Map<string, { formTemplateId: string; formTemplateName: string }>();
    assignments.forEach((a) => {
      const ft = formTemplates.find((t) => t.id === a.form_template_id);
      if (ft)
        map.set(a.checklist_template_id, { formTemplateId: ft.id, formTemplateName: ft.name });
    });
    return map;
  }, [assignments, formTemplates]);

  const getTeamLabel = (slug: string) =>
    teamLabels[slug as keyof typeof teamLabels] || teamLabelMap[slug] || slug;

  const getTeamColor = (slug: string) => teamColorMap[slug] || "#6b7280";

  const { titlesToId: checklistTemplatesByTitle } = useChecklistTemplateTitles();

  const taskTitleMap = useMemo(
    () => Object.fromEntries(allTasks.map((t) => [t.id, t.title])),
    [allTasks],
  );

  const checklist = project?.checklist || [];

  const currentTeamChecklist = project
    ? checklist.filter((c) => c.ownerTeam === project.currentOwnerTeam)
    : [];
  const allCurrentTeamDone =
    currentTeamChecklist.length > 0 && currentTeamChecklist.every((c) => c.completed);
  const prevAllDoneRef = useRef(allCurrentTeamDone);

  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (allCurrentTeamDone && !prevAllDoneRef.current && open) {
      setShowCelebration(true);
    }
    prevAllDoneRef.current = allCurrentTeamDone;
  }, [allCurrentTeamDone, open]);

  // ── Grouping logic (shared) ──
  // Note: early return moved below the hooks to satisfy rules-of-hooks
  const groupedByTeam = (project?.checklist || []).reduce(
    (acc, item) => {
      const team = (item.ownerTeam || "").toLowerCase();
      if (!acc[team]) acc[team] = [];
      acc[team].push(item);
      return acc;
    },
    {} as Record<string, NonNullable<typeof project>["checklist"]>,
  );

  const userTeam = (currentUser?.team || "").toLowerCase();
  const hasFullChecklistAccess = ["manager", "admin", "super_admin", "superadmin"].includes(
    userTeam,
  );

  const systemSlugs = ["mint", "integration", "ms"];
  const allSlugsInChecklist = Object.keys(groupedByTeam);

  const orderedTeams: string[] = [];
  if (userTeam && allSlugsInChecklist.includes(userTeam) && !hasFullChecklistAccess)
    orderedTeams.push(userTeam);
  systemSlugs.forEach((s) => {
    if (allSlugsInChecklist.includes(s) && !orderedTeams.includes(s)) orderedTeams.push(s);
  });
  allSlugsInChecklist.forEach((s) => {
    if (!orderedTeams.includes(s) && !systemSlugs.includes(s)) orderedTeams.push(s);
  });
  if (hasFullChecklistAccess && orderedTeams.length === 0) {
    systemSlugs.forEach((s) => {
      if (allSlugsInChecklist.includes(s)) orderedTeams.push(s);
    });
    allSlugsInChecklist.forEach((s) => {
      if (!orderedTeams.includes(s)) orderedTeams.push(s);
    });
  }

  const teamCounts = Object.entries(groupedByTeam).reduce(
    (acc, [team, items]) => {
      acc[team] = { completed: items.filter((i) => i.completed).length, total: items.length };
      return acc;
    },
    {} as Record<string, { completed: number; total: number }>,
  );

  const canEditChecklistItem = (ownerTeam: string) =>
    hasFullChecklistAccess || userTeam === (ownerTeam || "").toLowerCase();

  const handleResponsibilityChange = (checklistId: string, newParty: string) => {
    if (newParty && (newParty === "gokwik" || newParty === "merchant" || newParty === "neutral")) {
      toggleChecklistResponsibility(
        project?.id ?? "",
        checklistId,
        newParty as ResponsibilityParty,
      );
    }
  };

  // ── Groups for inline sidebar ──
  const activeGroups: GroupData[] = useMemo(() => {
    const items = checklist.filter((i) => !i.isTask);

    let groups: GroupData[];

    if (groupBy === "stages") {
      const map: Record<string, typeof items> = {};
      items.forEach((item) => {
        const key = item.stage?.trim() || "Ungrouped";
        if (!map[key]) map[key] = [];
        map[key].push(item);
      });
      // Default: named stages alphabetically, Ungrouped last
      const defaultKeys = Object.keys(map).sort((a, b) => {
        if (a === "Ungrouped") return 1;
        if (b === "Ungrouped") return -1;
        return a.localeCompare(b);
      });
      groups = defaultKeys.map((key) => ({
        key,
        label: key,
        color: "#6b7280",
        items: map[key],
        completed: map[key].filter((i) => i.completed).length,
        total: map[key].length,
      }));
    } else {
      groups = orderedTeams.map((team) => ({
        key: team,
        label: getTeamLabel(team),
        color: getTeamColor(team),
        items: (groupedByTeam[team] || []).filter((i) => !i.isTask),
        completed: (groupedByTeam[team] || []).filter((i) => !i.isTask && i.completed).length,
        total: (groupedByTeam[team] || []).filter((i) => !i.isTask).length,
      }));
    }

    // Apply user-defined order if present (only reorder known keys; append new ones at end)
    if (groupOrder.length > 0) {
      const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
      const ordered = groupOrder.filter((k) => byKey[k]).map((k) => byKey[k]);
      const rest = groups.filter((g) => !groupOrder.includes(g.key));
      return [...ordered, ...rest];
    }
    return groups;
  }, [groupBy, checklist, orderedTeams, groupedByTeam, groupOrder]);

  const handleGroupDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const keys = activeGroups.map((g) => g.key);
      const oldIdx = keys.indexOf(active.id as string);
      const newIdx = keys.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) return;
      const newOrder = arrayMove(keys, oldIdx, newIdx);
      setGroupOrder(newOrder);
      try {
        localStorage.setItem(
          `checklist_group_order_${project?.id}_${groupBy}`,
          JSON.stringify(newOrder),
        );
      } catch {}
    },
    [activeGroups, project?.id, groupBy],
  );

  // Restore saved group order from localStorage when project or groupBy changes
  useEffect(() => {
    if (!project?.id) return;
    try {
      const saved = localStorage.getItem(`checklist_group_order_${project.id}_${groupBy}`);
      setGroupOrder(saved ? JSON.parse(saved) : []);
    } catch {
      setGroupOrder([]);
    }
  }, [project?.id, groupBy]);

  // When a deep-link item id arrives (or changes), switch to the group that contains it
  // and open the item panel. This handles both first load and navigating to a second
  // notification while already on the project page.
  useEffect(() => {
    if (!initialExpandedItemId || activeGroups.length === 0) return;
    const group = activeGroups.find((g) => g.items.some((i) => i.id === initialExpandedItemId));
    if (group) setSelectedGroup(group.key);
    setExpandedItemId(initialExpandedItemId);
  }, [initialExpandedItemId, activeGroups]);

  const effectiveSelectedGroup =
    selectedGroup && activeGroups.some((g) => g.key === selectedGroup)
      ? selectedGroup
      : (activeGroups[0]?.key ?? null);

  const selectedGroupData = activeGroups.find((g) => g.key === effectiveSelectedGroup) ?? null;

  const getAssignee = (item: ProjectChecklist): string => {
    if (item.completedBy) return item.completedBy;
    return project?.assignedOwnerName || getTeamLabel(item.ownerTeam || "");
  };

  // Local item order per group key — overrides server order optimistically
  const [localItemOrder, setLocalItemOrder] = useState<Record<string, string[]>>({});

  const filteredItems = useMemo(() => {
    const serverItems = selectedGroupData?.items || [];
    const order = effectiveSelectedGroup ? localItemOrder[effectiveSelectedGroup] : undefined;
    if (!order) return serverItems;
    const byId = Object.fromEntries(serverItems.map((i) => [i.id, i]));
    const ordered = order.filter((id) => byId[id]).map((id) => byId[id]);
    const rest = serverItems.filter((i) => !order.includes(i.id));
    return [...ordered, ...rest];
  }, [selectedGroupData, effectiveSelectedGroup, localItemOrder]);

  const handleItemDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !project || !effectiveSelectedGroup) return;
      const oldIndex = filteredItems.findIndex((i) => i.id === active.id);
      const newIndex = filteredItems.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(filteredItems, oldIndex, newIndex);
      // Update UI immediately
      setLocalItemOrder((prev) => ({
        ...prev,
        [effectiveSelectedGroup]: reordered.map((i) => i.id),
      }));
      // Persist sort_order for changed rows only
      await Promise.all(
        reordered.map((item, i) =>
          item.sort_order !== i
            ? supabase.from("checklist_items").update({ sort_order: i }).eq("id", item.id)
            : Promise.resolve(),
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    [filteredItems, project, effectiveSelectedGroup, queryClient],
  );

  // Next action for the right panel
  const nextStep = useMemo(() => {
    const open = (project?.checklist || []).filter((item) => !item.completed && !item.isTask);
    if (open.length === 0)
      return { label: "All checklist items complete", hint: undefined as string | undefined };
    const ownTeam = open.filter(
      (item) => (item.ownerTeam || "").toLowerCase() === project?.currentOwnerTeam,
    );
    if (ownTeam.length === 0) {
      const next =
        project?.currentOwnerTeam === "mint"
          ? "integration"
          : project?.currentOwnerTeam === "integration"
            ? "ms"
            : null;
      if (next) return { label: `Transfer to ${getTeamLabel(next)}`, hint: undefined };
    }
    const pool = ownTeam.length > 0 ? ownTeam : open;
    const pick = [...pool].sort(
      (a, b) =>
        (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) -
        (b.dueDate ? new Date(b.dueDate).getTime() : Infinity),
    )[0];
    const overdue = pick.dueDate ? new Date(pick.dueDate) < new Date() : false;
    return {
      label: pick.title,
      hint: overdue ? "Overdue" : pick.dueDate ? `due ${shortDate(pick.dueDate)}` : undefined,
    };
  }, [project]);

  if (!project || !currentUser) return null;

  // ── Shared sub-dialogs JSX ──
  const subDialogs = (
    <>
      {formDialogState && project && (
        <ChecklistFormDialog
          open={formDialogState.open}
          onOpenChange={(o) => {
            if (!o) setFormDialogState(null);
          }}
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
          onOpenChange={(o) => {
            if (!o) setTaskDialogState(null);
          }}
          checklistItemId={taskDialogState.checklistItemId}
          checklistItemTitle={taskDialogState.checklistItemTitle}
          projectId={project.id}
          profiles={profiles}
          task={taskDialogState.task}
        />
      )}
      {meetingDialogState && project && (
        <MeetingSchedulerDialog
          open={meetingDialogState.open}
          onOpenChange={(o) => {
            if (!o) setMeetingDialogState(null);
          }}
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
              <div className="flex items-center gap-2">
                <span className="text-xl">Project Checklist</span>
                {checklistSetName && (
                  <Badge variant="secondary" className="text-2xs font-normal">
                    {checklistSetName}
                  </Badge>
                )}
              </div>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {project.merchantName}
              </p>
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
              const checklistItems = items.filter((i) => !i.isTask);

              return (
                <div key={team} className={canEditSection ? "" : "opacity-60"}>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: getTeamColor(team) }}
                      />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {getTeamLabel(team)}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {teamCount?.completed} of {teamCount?.total} done
                        </p>
                      </div>
                    </div>
                    {isOwnTeam && <span className="text-xs text-muted-foreground">Your team</span>}
                  </div>

                  <div className="space-y-3 pl-2 ml-4">
                    {checklistItems.map((item, index) => {
                      const timeStats = calculateTimeByParty(item.responsibilityLog);
                      const canEdit = canEditChecklistItem(item.ownerTeam || "");
                      const itemTasks = allTasks.filter((t) => t.checklist_item_id === item.id);
                      const itemMeetings = allMeetings.filter(
                        (m) => m.checklist_item_id === item.id,
                      );

                      return (
                        <div
                          key={item.id}
                          id={`checklist-item-${item.id}`}
                          className={`p-4 rounded-xl border transition-all scroll-mt-24 ${item.completed ? "bg-success/5 border-success/30" : "bg-card border-border hover:border-primary/30 hover:shadow-md"}`}
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex flex-col items-center gap-1">
                              <Badge
                                variant="outline"
                                className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-mono p-0"
                              >
                                {index + 1}
                              </Badge>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div>
                                      <Checkbox
                                        checked={item.completed}
                                        onCheckedChange={(checked) => {
                                          if (canEdit)
                                            updateChecklist(
                                              project.id,
                                              item.id,
                                              checked as boolean,
                                            );
                                        }}
                                        disabled={!canEdit}
                                        className="h-5 w-5"
                                      />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {!canEdit
                                      ? "Only team members can complete this"
                                      : item.completed
                                        ? "Click to mark as incomplete"
                                        : "Click to mark as complete"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span
                                  className={`font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}
                                >
                                  {item.title}
                                </span>
                                {item.completed && (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />
                                )}
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                  {(() => {
                                    const tid = checklistTemplatesByTitle[item.title];
                                    const fi = tid
                                      ? formsByChecklistTemplateId.get(tid)
                                      : undefined;
                                    if (!fi) return null;
                                    return (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setFormDialogState({
                                            open: true,
                                            checklistItemId: item.id,
                                            checklistItemTitle: item.title,
                                            formTemplateId: fi.formTemplateId,
                                            formTemplateName: fi.formTemplateName,
                                          });
                                        }}
                                      >
                                        <FileText className="h-3 w-3" />
                                        {fi.formTemplateName}
                                      </Button>
                                    );
                                  })()}
                                  {(() => {
                                    const tc = allTasks.filter(
                                      (t) => t.checklist_item_id === item.id,
                                    ).length;
                                    const oc = allTasks.filter(
                                      (t) => t.checklist_item_id === item.id && t.status !== "done",
                                    ).length;
                                    return (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTaskDialogState({
                                            open: true,
                                            checklistItemId: item.id,
                                            checklistItemTitle: item.title,
                                          });
                                        }}
                                      >
                                        <Plus className="h-3 w-3" />
                                        Task{tc > 0 ? ` (${oc}/${tc})` : ""}
                                      </Button>
                                    );
                                  })()}
                                  {(() => {
                                    const im = allMeetings.filter(
                                      (m) => m.checklist_item_id === item.id,
                                    );
                                    const up = im.filter(
                                      (m) =>
                                        m.status === "scheduled" &&
                                        new Date(m.scheduled_at) >= new Date(),
                                    ).length;
                                    return (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMeetingDialogState({
                                            open: true,
                                            checklistItemId: item.id,
                                            checklistItemTitle: item.title,
                                          });
                                        }}
                                      >
                                        <Plus className="h-3 w-3" />
                                        Meeting{im.length > 0 ? ` (${up}/${im.length})` : ""}
                                      </Button>
                                    );
                                  })()}
                                </div>
                              </div>
                              {(item.startDate || item.dueDate || (canEdit && !item.completed)) && (
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <Calendar className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">Start:</span>
                                  {canEdit && !item.completed ? (
                                    <Input
                                      type="date"
                                      defaultValue={item.startDate || ""}
                                      aria-label="Start date"
                                      className="h-6 w-32 text-xs px-1"
                                      onChange={async (e) => {
                                        const nd = e.target.value || null;
                                        await supabase
                                          .from("checklist_items")
                                          .update({ start_date: nd })
                                          .eq("id", item.id);
                                        queryClient.invalidateQueries({ queryKey: ["projects"] });
                                      }}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {item.startDate ? shortDate(item.startDate) : "—"}
                                    </span>
                                  )}
                                  <span className="text-xs text-muted-foreground">→ Due:</span>
                                  {item.dueDate ? (
                                    <span
                                      className={`text-xs ${!item.completed && new Date(item.dueDate) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}
                                    >
                                      {shortDate(item.dueDate)}
                                      {!item.completed &&
                                        new Date(item.dueDate) < new Date() &&
                                        " (Overdue)"}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                  {canEdit && !item.completed && (
                                    <Input
                                      type="date"
                                      defaultValue={item.dueDate || ""}
                                      aria-label="Due date"
                                      className="h-6 w-32 text-xs px-1"
                                      onChange={async (e) => {
                                        const nd = e.target.value || null;
                                        await supabase
                                          .from("checklist_items")
                                          .update({ due_date: nd })
                                          .eq("id", item.id);
                                        queryClient.invalidateQueries({ queryKey: ["projects"] });
                                      }}
                                    />
                                  )}
                                </div>
                              )}
                              {item.completedBy && (
                                <p className="text-xs text-muted-foreground mb-2">
                                  ✓ Completed by {item.completedBy}
                                  {item.completedAt && ` on ${shortDate(item.completedAt)}`}
                                </p>
                              )}
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3 text-primary" />
                                  <span>
                                    {responsibilityLabels.gokwik}:{" "}
                                    {formatDuration(timeStats.gokwik)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Users className="h-3 w-3 text-warning-strong" />
                                  <span>
                                    {responsibilityLabels.merchant}:{" "}
                                    {formatDuration(timeStats.merchant)}
                                  </span>
                                </div>
                              </div>
                              <ChecklistCommentThread
                                checklistItemId={item.id}
                                checklistItemTitle={item.title}
                                projectId={project.id}
                                projectName={project.merchantName}
                                focusSignal={
                                  commentPrompt?.itemId === item.id ? commentPrompt.at : undefined
                                }
                                taskTitleMap={taskTitleMap}
                              />
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <ToggleGroup
                                type="single"
                                value={item.currentResponsibility}
                                onValueChange={(v) => handleResponsibilityChange(item.id, v)}
                                disabled={item.completed || !canEdit}
                                className="gap-0 border rounded-lg overflow-hidden"
                              >
                                <ToggleGroupItem
                                  value="gokwik"
                                  aria-label={responsibilityLabels.gokwik}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-primary data-[state=on]:text-white"
                                >
                                  <Building2 className="h-3 w-3 mr-1" />
                                  {responsibilityLabels.gokwik}
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="neutral"
                                  aria-label={responsibilityLabels.neutral}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none border-x data-[state=on]:bg-muted"
                                >
                                  <Minus className="h-3 w-3" />
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="merchant"
                                  aria-label={responsibilityLabels.merchant}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-warning data-[state=on]:text-warning-foreground"
                                >
                                  <Users className="h-3 w-3 mr-1" />
                                  {responsibilityLabels.merchant}
                                </ToggleGroupItem>
                              </ToggleGroup>
                            </div>
                          </div>

                          {(() => {
                            const hasSubItems = itemTasks.length > 0 || itemMeetings.length > 0;
                            return !hasSubItems ? null : (
                              <div className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 md:grid-cols-2">
                                <div className="min-w-0">
                                  <div className="mb-1.5 flex items-center gap-2 px-1">
                                    <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Tasks
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {itemTasks.filter((t) => t.status === "done").length} of{" "}
                                      {itemTasks.length} done
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="ml-auto h-6 gap-1 px-2 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Add task
                                    </Button>
                                  </div>
                                  <div className="space-y-1">
                                    {itemTasks.map((task) => {
                                      const od =
                                        task.due_date &&
                                        task.status !== "done" &&
                                        new Date(task.due_date) < new Date();
                                      const isAwaitingComment =
                                        taskCommentPending?.taskId === task.id;
                                      return (
                                        <div key={task.id} id={`task-${task.id}`}>
                                          <div className="group flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/30">
                                            <Checkbox
                                              checked={task.status === "done"}
                                              onCheckedChange={(checked) => {
                                                updateTaskMutation.mutate({
                                                  id: task.id,
                                                  status: checked ? "done" : "open",
                                                });
                                                if (checked) {
                                                  setTaskCommentPending({
                                                    taskId: task.id,
                                                    itemId: item.id,
                                                    text: "",
                                                  });
                                                } else {
                                                  if (isAwaitingComment)
                                                    setTaskCommentPending(null);
                                                }
                                              }}
                                              className="h-4 w-4 shrink-0"
                                            />
                                            <span
                                              className={`flex-1 truncate text-sm ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}
                                            >
                                              {task.title}
                                            </span>
                                            {task.assigned_to && (
                                              <span className="shrink-0 text-2xs text-muted-foreground">
                                                {profiles.find((p) => p.id === task.assigned_to)
                                                  ?.name || task.assigned_to}
                                              </span>
                                            )}
                                            {task.due_date && (
                                              <span
                                                className={`flex shrink-0 items-center gap-0.5 text-2xs ${od ? "font-medium text-destructive" : "text-muted-foreground"}`}
                                              >
                                                <Calendar className="h-2.5 w-2.5" />
                                                {shortDate(task.due_date)}
                                              </span>
                                            )}
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-5 w-5 shrink-0 p-0 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setTaskDialogState({
                                                  open: true,
                                                  checklistItemId: item.id,
                                                  checklistItemTitle: item.title,
                                                  task,
                                                });
                                              }}
                                            >
                                              <Pencil className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-5 w-5 shrink-0 p-0 text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                              onClick={() => deleteTaskMutation.mutate(task.id)}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                          {isAwaitingComment && (
                                            <div className="ml-6 mt-1 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
                                              <Input
                                                autoFocus
                                                placeholder="Add a completion note… (Enter to save, Esc to skip)"
                                                value={taskCommentPending.text}
                                                onChange={(e) =>
                                                  setTaskCommentPending((prev) =>
                                                    prev ? { ...prev, text: e.target.value } : prev,
                                                  )
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    const text = taskCommentPending.text.trim();
                                                    if (text) {
                                                      addCommentMutation.mutate({
                                                        checklistItemId: taskCommentPending.itemId,
                                                        checklistTaskId: taskCommentPending.taskId,
                                                        comment: text,
                                                      });
                                                    }
                                                    setTaskCommentPending(null);
                                                  } else if (e.key === "Escape") {
                                                    setTaskCommentPending(null);
                                                  }
                                                }}
                                                className="h-7 flex-1 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                                              />
                                              <Button
                                                size="sm"
                                                className="h-6 px-2 text-xs"
                                                disabled={!taskCommentPending.text.trim() || addCommentMutation.isPending}
                                                onClick={() => {
                                                  const text = taskCommentPending.text.trim();
                                                  if (text) {
                                                    addCommentMutation.mutate({
                                                      checklistItemId: taskCommentPending.itemId,
                                                      checklistTaskId: taskCommentPending.taskId,
                                                      comment: text,
                                                    });
                                                  }
                                                  setTaskCommentPending(null);
                                                }}
                                              >
                                                Save
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 text-xs text-muted-foreground"
                                                onClick={() => setTaskCommentPending(null)}
                                              >
                                                Skip
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div className="min-w-0 md:border-l md:border-border/60 md:pl-2">
                                  <div className="mb-1.5 flex items-center gap-2 px-1">
                                    <Video className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Meetings
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {itemMeetings.length}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="ml-auto h-6 gap-1 px-2 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMeetingDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Schedule
                                    </Button>
                                  </div>
                                  {itemMeetings.length === 0 ? (
                                    <p className="px-1 py-2 text-xs text-muted-foreground">
                                      No meetings for this step yet.
                                    </p>
                                  ) : (
                                    <ChecklistItemMeetings meetings={itemMeetings} />
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    {/* Inline add item row */}
                    {canEditSection && (
                      addItemState?.team === team ? (
                        <div className="flex items-center gap-2 mt-2 px-1">
                          <Input
                            autoFocus
                            placeholder="New item title… (Enter to save, Esc to cancel)"
                            value={addItemTitle}
                            onChange={(e) => setAddItemTitle(e.target.value)}
                            className="h-7 text-xs flex-1"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddItem(team, addItemTitle);
                              if (e.key === "Escape") { setAddItemState(null); setAddItemTitle(""); }
                            }}
                          />
                          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleAddItem(team, addItemTitle)} disabled={!addItemTitle.trim()}>Save</Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setAddItemState(null); setAddItemTitle(""); }}>Cancel</Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mt-2 flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => { setAddItemState({ team }); setAddItemTitle(""); }}
                        >
                          <Plus className="h-3 w-3" /> Add item
                        </button>
                      )
                    )}
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
      <div className="w-52 shrink-0 border-r border-border/60 flex flex-col overflow-hidden bg-white dark:bg-background">
        {/* Sidebar header */}
        <div className="shrink-0 border-b border-border/50 px-3 py-3">
          <ToggleGroup
            type="single"
            value={groupBy}
            onValueChange={(v) => {
              if (v) {
                setGroupBy(v as "teams" | "stages");
                setSelectedGroup(null);
              }
            }}
            className="w-full"
          >
            <ToggleGroupItem
              value="stages"
              className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Stages
            </ToggleGroupItem>
            <ToggleGroupItem
              value="teams"
              className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Teams
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Group list */}
        <ScrollArea className="flex-1">
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
            <SortableContext items={activeGroups.map((g) => g.key)} strategy={verticalListSortingStrategy}>
          <div className="py-1">
            {activeGroups.map((group) => {
              const isSelected = group.key === effectiveSelectedGroup;
              const r = 7;
              const circ = 2 * Math.PI * r;
              const dash = (group.completed / Math.max(group.total, 1)) * circ;
              const allDone = group.completed === group.total && group.total > 0;

              return (
                <SortableGroupButton
                  key={group.key}
                  id={group.key}
                  onClick={() => setSelectedGroup(group.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2",
                    isSelected ? "border-primary" : "border-transparent hover:bg-muted/50",
                  )}
                >
                  {/* Circle progress */}
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 18 18">
                    <circle
                      cx="9"
                      cy="9"
                      r={r}
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity="0.15"
                      strokeWidth="1.5"
                    />
                    {group.completed > 0 && (
                      <circle
                        cx="9"
                        cy="9"
                        r={r}
                        fill="none"
                        stroke={allDone ? "#10b981" : isSelected ? "#2166F3" : group.color}
                        strokeWidth="1.5"
                        strokeDasharray={`${dash} ${circ}`}
                        strokeLinecap="round"
                        style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
                      />
                    )}
                    {allDone && (
                      <path
                        d="M6.5 9.2l1.8 1.8 3.2-3.6"
                        stroke="#10b981"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    )}
                  </svg>

                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        isSelected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {group.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {group.completed} / {group.total} done
                    </p>
                  </div>

                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                      isSelected && "rotate-180",
                    )}
                  />
                </SortableGroupButton>
              );
            })}
          </div>
            </SortableContext>
          </DndContext>
        </ScrollArea>
      </div>

      {/* ── Column B: Task table ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-background">
        {/* Task table */}
        <ScrollArea className="flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted border-b border-border/50">
              <tr className="border-b border-border/50">
                <th className="w-6" />
                <th className="w-10 text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  #
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  Checklist
                </th>
                <th className="w-24 text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  Start
                </th>
                <th className="w-28 text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  Due date
                </th>
                <th className="w-36 text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  Owner
                </th>
                <th className="w-24 text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
              <SortableContext items={filteredItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {filteredItems.map((item, index) => {
                const status = getItemStatus(item);
                const assignee = getAssignee(item);
                const canEdit = canEditChecklistItem(item.ownerTeam || "");
                const taskCount = allTasks.filter((t) => t.checklist_item_id === item.id).length;
                const commentCount = item.comment ? 1 : 0;
                const isExpanded = expandedItemId === item.id;
                const templateId = checklistTemplatesByTitle[item.title];
                const formInfo = templateId
                  ? formsByChecklistTemplateId.get(templateId)
                  : undefined;

                return (
                  <Fragment key={item.id}>
                    <SortableTr
                      id={item.id}
                      data-id={`checklist-item-${item.id}`}
                      onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                      className={cn(
                        "group border-b border-border/30 transition-colors scroll-mt-24 cursor-pointer",
                        "hover:bg-muted/10",
                      )}
                    >
                      {/* Row number / bulk checkbox */}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground align-middle">
                        {bulkSelectMode ? (
                          <span onClick={(e) => { e.stopPropagation(); toggleBulkItem(item.id); }}>
                            <Checkbox
                              checked={selectedItemIds.has(item.id)}
                              className="h-4 w-4"
                            />
                          </span>
                        ) : (
                          index + 1
                        )}
                      </td>

                      {/* Checkbox + Title */}
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-2.5">
                          <span onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={item.completed}
                              onCheckedChange={(checked) => {
                                if (canEdit)
                                  updateChecklist(project.id, item.id, checked as boolean);
                              }}
                              disabled={!canEdit}
                              className="h-4 w-4 shrink-0"
                            />
                          </span>
                          {/* §8.1 Health & Risk Flags */}
                          {getHealthFlags(item).map((flag) => (
                            <TooltipProvider key={flag.key} delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`h-2 w-2 rounded-full shrink-0 cursor-default ${flag.color}`} />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {flag.title}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ))}
                          <span
                            className={cn(
                              "font-medium",
                              item.completed && "line-through text-muted-foreground",
                            )}
                          >
                            {item.title}
                          </span>
                          {/* §8.5 SLA chip */}
                          <SlaChip item={item} />
                          {taskCount > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <MessageSquare className="h-3 w-3" />
                              {taskCount}
                            </span>
                          )}
                          {commentCount > 0 && (
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </td>

                      {/* Start date */}
                      <td className="px-3 py-2.5 align-middle">
                        {item.startDate ? (
                          <span className="text-xs text-muted-foreground">{shortDate(item.startDate)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Due date */}
                      <td className="px-3 py-2.5 align-middle">
                        {item.dueDate ? (
                          <span
                            className={cn(
                              "text-xs",
                              status === "overdue"
                                ? "text-destructive font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {shortDate(item.dueDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Assignee */}
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <UserAvatar
                            name={assignee}
                            avatarUrl={profiles.find((p) => p.id === project?.assignedOwner)?.avatar_url}
                            size="xs"
                          />
                          <span className="text-xs truncate max-w-24">{assignee}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 align-middle">
                        <StatusBadge status={status} />
                      </td>

                    </SortableTr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="px-4 py-3 border-b border-border/30 bg-muted/5">
                          <div className="space-y-3">
                            {/* Metadata bar: Waiting on | Timeline | Time tracking */}
                            <div className="flex items-center gap-0 rounded-lg border border-border/40 bg-background divide-x divide-border/40 overflow-hidden">
                              {/* Waiting on */}
                              <div className="flex items-center gap-2 px-3 py-2 min-w-0">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 cursor-default whitespace-nowrap">
                                        Waiting on
                                        <span className="text-muted-foreground/50 text-2xs leading-none">ⓘ</span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Who is currently responsible for this task</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <ToggleGroup
                                  type="single"
                                  value={item.currentResponsibility}
                                  onValueChange={(v) => handleResponsibilityChange(item.id, v)}
                                  disabled={item.completed || !canEdit}
                                  className="gap-0 rounded-md overflow-hidden border border-border/50"
                                >
                                  <ToggleGroupItem
                                    value="gokwik"
                                    className="text-xs px-2.5 h-6 rounded-none data-[state=on]:bg-primary data-[state=on]:text-white data-[state=off]:text-muted-foreground"
                                  >
                                    <Building2 className="h-3 w-3 mr-1" />
                                    {responsibilityLabels.gokwik}
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="neutral"
                                    className="text-xs px-2 h-6 rounded-none border-x border-border/40 data-[state=on]:bg-muted data-[state=off]:text-muted-foreground"
                                  >
                                    <Minus className="h-3 w-3" />
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="merchant"
                                    className="text-xs px-2.5 h-6 rounded-none data-[state=on]:bg-amber-100 data-[state=on]:text-amber-800 data-[state=off]:text-muted-foreground"
                                  >
                                    <Users className="h-3 w-3 mr-1" />
                                    {responsibilityLabels.merchant}
                                  </ToggleGroupItem>
                                </ToggleGroup>
                              </div>

                              {/* Timeline */}
                              <div className="flex items-center gap-2 px-3 py-2">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Start</span>
                                {canEdit && !item.completed ? (
                                  <Input
                                    type="date"
                                    defaultValue={item.startDate || ""}
                                    className="h-6 w-30 text-xs px-1.5 border-border/50"
                                    onChange={async (e) => {
                                      const nd = e.target.value || null;
                                      await supabase.from("checklist_items").update({ start_date: nd }).eq("id", item.id);
                                      queryClient.invalidateQueries({ queryKey: ["projects"] });
                                    }}
                                  />
                                ) : (
                                  <span className="text-xs font-medium">{item.startDate ? shortDate(item.startDate) : "—"}</span>
                                )}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">→ Due</span>
                                {canEdit && !item.completed ? (
                                  <Input
                                    type="date"
                                    defaultValue={item.dueDate || ""}
                                    className="h-6 w-30 text-xs px-1.5 border-border/50"
                                    onChange={async (e) => {
                                      const nd = e.target.value || null;
                                      await supabase.from("checklist_items").update({ due_date: nd }).eq("id", item.id);
                                      queryClient.invalidateQueries({ queryKey: ["projects"] });
                                    }}
                                  />
                                ) : (
                                  <span className="text-xs font-medium">{item.dueDate ? shortDate(item.dueDate) : "—"}</span>
                                )}
                              </div>

                              {/* Time tracking */}
                              {(() => {
                                const ts = calculateTimeByParty(item.responsibilityLog);
                                return (
                                  <div className="flex items-center gap-4 px-3 py-2 text-xs">
                                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                                      <Building2 className="h-3.5 w-3.5 text-primary" />
                                      <span className="text-muted-foreground">{responsibilityLabels.gokwik}:</span>
                                      <span className="font-semibold text-primary">{formatDuration(ts.gokwik)}</span>
                                    </span>
                                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                                      <Users className="h-3.5 w-3.5 text-amber-500" />
                                      <span className="text-muted-foreground">{responsibilityLabels.merchant}:</span>
                                      <span className="font-semibold text-amber-600">{formatDuration(ts.merchant)}</span>
                                    </span>
                                  </div>
                                );
                              })()}

                              {/* More options (⋯) */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="flex items-center px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60 p-2 space-y-1">
                                  {/* Stage */}
                                  <div className="flex items-center gap-2 px-1 py-1">
                                    <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">Stage</span>
                                    {canEdit && !item.completed ? (
                                      <Input
                                        type="text"
                                        defaultValue={item.stage ?? ""}
                                        placeholder="e.g. Pre Sales"
                                        className="h-6 flex-1 text-xs px-1.5 border-border/50"
                                        onBlur={async (e) => {
                                          const val = e.target.value.trim() || null;
                                          await supabase.from("checklist_items").update({ stage: val }).eq("id", item.id);
                                          queryClient.invalidateQueries({ queryKey: ["projects"] });
                                        }}
                                      />
                                    ) : (
                                      <span className="text-xs font-medium">{item.stage || "—"}</span>
                                    )}
                                  </div>
                                  {/* Customer portal visibility */}
                                  {canEdit && (
                                    <button
                                      type="button"
                                      className="flex items-center gap-2 px-1 py-1 w-full rounded hover:bg-muted/40 transition-colors"
                                      onClick={async () => {
                                        const next = item.isClientVisible === false ? null : false;
                                        await supabase.from("checklist_items").update({ is_client_visible: next }).eq("id", item.id);
                                        queryClient.invalidateQueries({ queryKey: ["projects"] });
                                      }}
                                    >
                                      {item.isClientVisible === false
                                        ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        : <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                                      }
                                      <span className="text-xs whitespace-nowrap">
                                        {item.isClientVisible === false ? "Hidden from portal" : "Visible in portal"}
                                      </span>
                                    </button>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {/* Tasks + Meetings side-by-side — always shown */}
                            {(() => {
                              const itemTasks = allTasks.filter(
                                (t) => t.checklist_item_id === item.id,
                              );
                              const itemMeetings = allMeetings.filter(
                                (m) => m.checklist_item_id === item.id,
                              );
                              const doneTasks = itemTasks.filter((t) => t.status === "done").length;
                              const pct = itemTasks.length
                                ? Math.round((doneTasks / itemTasks.length) * 100)
                                : 0;
                              return (
                                <div className="grid grid-cols-2 gap-3">
                                  {/* Tasks box */}
                                  <div className="rounded-lg border border-border/50 bg-background flex flex-col overflow-hidden">
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                                      <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-xs font-semibold text-foreground">Tasks</span>
                                      <span className="ml-auto text-2xs text-muted-foreground">
                                        {doneTasks}/{itemTasks.length} done ({pct}%)
                                      </span>
                                    </div>
                                    {/* Progress bar */}
                                    <div className="h-0.5 bg-border/30">
                                      <div
                                        className="h-full bg-primary transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    {/* Column headers */}
                                    <div className="grid grid-cols-[1fr_6rem_6rem_1.5rem] gap-x-2 px-3 py-1.5 text-2xs font-medium text-muted-foreground border-b border-border/30 bg-muted/20">
                                      <span>Task</span>
                                      <span>Owner</span>
                                      <span>Due date</span>
                                      <span />
                                    </div>
                                    <div className="flex-1 overflow-y-auto max-h-[160px] divide-y divide-border/20">
                                      {itemTasks.map((task) => {
                                        const isAwaitingComment =
                                          taskCommentPending?.taskId === task.id;
                                        const assigneeProfile = task.assigned_to
                                          ? profiles.find((p) => p.id === task.assigned_to)
                                          : null;
                                        const assigneeName = assigneeProfile
                                          ? (assigneeProfile.name ?? "—")
                                          : "—";
                                        return (
                                          <div key={task.id} id={`task-${task.id}`}>
                                            <div className="group grid grid-cols-[1fr_6rem_6rem_1.5rem] gap-x-2 items-center px-3 py-2 hover:bg-muted/30">
                                              <div className="flex items-center gap-2 min-w-0">
                                                <Checkbox
                                                  checked={task.status === "done"}
                                                  onCheckedChange={(checked) => {
                                                    updateTaskMutation.mutate({
                                                      id: task.id,
                                                      status: checked ? "done" : "open",
                                                    });
                                                    if (checked) {
                                                      setTaskCommentPending({
                                                        taskId: task.id,
                                                        itemId: item.id,
                                                        text: "",
                                                      });
                                                    } else if (isAwaitingComment) {
                                                      setTaskCommentPending(null);
                                                    }
                                                  }}
                                                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                                                />
                                                <span
                                                  className={cn(
                                                    "text-xs truncate",
                                                    task.status === "done" &&
                                                      "line-through text-muted-foreground",
                                                  )}
                                                >
                                                  {task.title}
                                                </span>
                                              </div>
                                              <span className="text-2xs text-muted-foreground truncate">
                                                {assigneeName}
                                              </span>
                                              <span className="text-2xs text-muted-foreground whitespace-nowrap">
                                                {task.due_date ? shortDate(task.due_date) : "—"}
                                              </span>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setTaskDialogState({
                                                    open: true,
                                                    checklistItemId: item.id,
                                                    checklistItemTitle: item.title,
                                                    task,
                                                  });
                                                }}
                                              >
                                                <Pencil className="h-2.5 w-2.5" />
                                              </Button>
                                            </div>
                                            {isAwaitingComment && (
                                              <div className="ml-5 mt-1 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1">
                                                <Input
                                                  autoFocus
                                                  placeholder="Add a completion note… (Enter to save, Esc to skip)"
                                                  value={taskCommentPending.text}
                                                  onChange={(e) =>
                                                    setTaskCommentPending((prev) =>
                                                      prev ? { ...prev, text: e.target.value } : prev,
                                                    )
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter" && !e.shiftKey) {
                                                      e.preventDefault();
                                                      const text = taskCommentPending.text.trim();
                                                      if (text)
                                                        addCommentMutation.mutate({
                                                          checklistItemId: taskCommentPending.itemId,
                                                          checklistTaskId: taskCommentPending.taskId,
                                                          comment: text,
                                                        });
                                                      setTaskCommentPending(null);
                                                    } else if (e.key === "Escape") {
                                                      setTaskCommentPending(null);
                                                    }
                                                  }}
                                                  className="h-6 flex-1 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                                                />
                                                <Button
                                                  size="sm"
                                                  className="h-5 px-2 text-2xs"
                                                  disabled={!taskCommentPending.text.trim() || addCommentMutation.isPending}
                                                  onClick={() => {
                                                    const text = taskCommentPending.text.trim();
                                                    if (text)
                                                      addCommentMutation.mutate({
                                                        checklistItemId: taskCommentPending.itemId,
                                                        checklistTaskId: taskCommentPending.taskId,
                                                        comment: text,
                                                      });
                                                    setTaskCommentPending(null);
                                                  }}
                                                >Save</Button>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-5 px-2 text-2xs text-muted-foreground"
                                                  onClick={() => setTaskCommentPending(null)}
                                                >Skip</Button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {itemTasks.length === 0 && (
                                        <p className="px-3 py-3 text-xs text-muted-foreground">No tasks yet.</p>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border/30 w-full"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Add task
                                    </button>
                                  </div>

                                  {/* Meetings box */}
                                  <div className="rounded-lg border border-border/50 bg-background flex flex-col overflow-hidden">
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                                      <Video className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-xs font-semibold text-foreground">Meetings</span>
                                      <span className="ml-auto text-2xs text-muted-foreground">
                                        {itemMeetings.length > 0
                                          ? `${itemMeetings.length} scheduled`
                                          : "None scheduled"}
                                      </span>
                                    </div>
                                    <div className="flex-1 overflow-y-auto max-h-[160px] divide-y divide-border/20">
                                      {itemMeetings.length > 0 ? (
                                        <ChecklistItemMeetings meetings={itemMeetings} />
                                      ) : (
                                        <p className="px-3 py-3 text-xs text-muted-foreground">No meetings yet.</p>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border/30 w-full"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMeetingDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Schedule meeting
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Discussion */}
                            <ChecklistCommentThread
                              checklistItemId={item.id}
                              checklistItemTitle={item.title}
                              projectId={project.id}
                              projectName={project.merchantName}
                              focusSignal={
                                commentPrompt?.itemId === item.id ? commentPrompt.at : undefined
                              }
                              taskTitleMap={taskTitleMap}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {/* §4.3 Bulk action bar */}
              {bulkSelectMode && selectedItemIds.size > 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-2 border-t border-primary/20 bg-primary/5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-primary">{selectedItemIds.size} selected</span>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1" onClick={bulkComplete}>
                        <CheckSquare className="h-3 w-3" /> Complete
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1">
                            Team <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {(["mint", "integration", "ms"] as const).map((t) => (
                            <DropdownMenuItem key={t} onSelect={() => bulkChangeTeam(t)}>
                              {teamLabels[t] || t}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={bulkDelete}>
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs ml-auto" onClick={() => { setSelectedItemIds(new Set()); setBulkSelectMode(false); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Inline add row */}
              <tr>
                <td colSpan={6} className="px-3 py-1.5">
                  {addItemState?.team === "table" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        placeholder="New item title… (Enter to save, Esc to cancel)"
                        value={addItemTitle}
                        onChange={(e) => setAddItemTitle(e.target.value)}
                        className="h-7 text-xs flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddItem(effectiveSelectedGroup || "mint", addItemTitle);
                          if (e.key === "Escape") { setAddItemState(null); setAddItemTitle(""); }
                        }}
                      />
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleAddItem(effectiveSelectedGroup || "mint", addItemTitle)} disabled={!addItemTitle.trim()}>Save</Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setAddItemState(null); setAddItemTitle(""); }}>Cancel</Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                      onClick={() => { setAddItemState({ team: "table" }); setAddItemTitle(""); }}
                    >
                      <Plus className="h-3 w-3" /> Add item
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
              </SortableContext>
            </DndContext>
          </table>
        </ScrollArea>
      </div>

      {/* ── Column C: Project details panel ───────────────────────── */}
      <div className="w-80 shrink-0 border-l border-border/60 flex flex-col overflow-hidden bg-white dark:bg-background">
        <Tabs
          value={detailsTab}
          onValueChange={(v) => setDetailsTab(v as typeof detailsTab)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList className="shrink-0 rounded-none border-b border-border/50 bg-transparent px-1 justify-start gap-0 h-auto">
            <TabsTrigger
              value="details"
              className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Details
            </TabsTrigger>
            <TabsTrigger
              value="people"
              className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              People
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Activity className="h-3 w-3 mr-1" />
              Activity
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            {/* Details tab */}
            <TabsContent value="details" className="m-0 p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">Project details</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setDetailsPickerOpen(true)}
                  title="Customize visible fields"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              <dl className="space-y-2">
                {visibleDetailsFields.includes("project_state") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Project state</dt>
                    <dd>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity", STATE_TONE[project.projectState] || "bg-muted text-muted-foreground")}>
                            {projectStateLabels[project.projectState as ProjectState] || project.projectState}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-40">
                          {(["not_started", "in_progress", "on_hold", "blocked", "live"] as ProjectState[]).map((s) => (
                            <DropdownMenuItem
                              key={s}
                              onSelect={() => updateProject({ ...project, projectState: s }, { onSuccess: () => toast.success(`State updated to ${projectStateLabels[s]}`) })}
                              className={cn("text-xs gap-2", project.projectState === s && "font-semibold")}
                            >
                              <span className={cn("h-2 w-2 rounded-full shrink-0", {
                                "bg-muted-foreground": s === "not_started",
                                "bg-blue-500": s === "in_progress",
                                "bg-yellow-500": s === "on_hold",
                                "bg-red-500": s === "blocked",
                                "bg-green-500": s === "live",
                              })} />
                              {projectStateLabels[s]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </dd>
                  </div>
                )}
                {visibleDetailsFields.includes("expected_golive") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-start">
                    <dt className="text-xs text-muted-foreground pt-0.5">Expected go-live</dt>
                    <dd className="text-xs font-semibold text-foreground">
                      {friendlyDate(project.dates.expectedGoLiveDate)}
                      {project.dates.expectedGoLiveDate && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({daysRelative(project.dates.expectedGoLiveDate)})
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {visibleDetailsFields.includes("next_action") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-start">
                    <dt className="text-xs text-muted-foreground pt-0.5">Next action</dt>
                    <dd className="text-xs font-semibold text-foreground">
                      {nextStep.label}
                      {nextStep.hint && (
                        <span className={cn("block text-2xs mt-0.5 font-normal", nextStep.hint === "Overdue" ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {nextStep.hint === "Overdue" ? "◆ Overdue" : nextStep.hint}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {visibleDetailsFields.includes("revenue") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Revenue</dt>
                    <dd className="text-xs font-semibold text-foreground">₹{formatArrCr(project.arr)}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("project_owner") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Project owner</dt>
                    <dd className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground shrink-0">
                        {(project.assignedOwnerName || "U").charAt(0).toUpperCase()}
                      </span>
                      {project.assignedOwnerName || "Unassigned"}
                    </dd>
                  </div>
                )}
                {visibleDetailsFields.includes("client") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Client</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.merchantName}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("description") && project.notes.projectNotes && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-start">
                    <dt className="text-xs text-muted-foreground pt-0.5">Description</dt>
                    <dd className="text-xs text-foreground whitespace-pre-line">{project.notes.projectNotes}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("mid") && project.mid && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">MID</dt>
                    <dd className="text-xs font-semibold text-foreground font-mono">{project.mid}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("platform") && project.platform && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Platform</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.platform}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("integration_type") && project.integrationType && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Integration type</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.integrationType}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("pg_onboarding") && project.pgOnboarding && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">PG Onboarding</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.pgOnboarding}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("txns_per_day") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Txns/Day</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.txnsPerDay ?? "—"}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("aov") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">AOV</dt>
                    <dd className="text-xs font-semibold text-foreground">₹{project.aov ?? "—"}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("category") && project.category && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Category</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.category}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("sales_spoc") && project.salesSpoc && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Sales SPOC</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.salesSpoc}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("brand_url") && project.links.brandUrl && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Brand URL</dt>
                    <dd className="text-xs font-semibold text-foreground truncate">
                      <a href={project.links.brandUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate block">
                        {project.links.brandUrl}
                      </a>
                    </dd>
                  </div>
                )}
                {visibleDetailsFields.includes("kick_off_date") && project.dates.kickOffDate && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Kick-off date</dt>
                    <dd className="text-xs font-semibold text-foreground">{friendlyDate(project.dates.kickOffDate)}</dd>
                  </div>
                )}
                {visibleDetailsFields.includes("go_live_date") && project.dates.goLiveDate && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Go-live date</dt>
                    <dd className="text-xs font-semibold text-foreground">{friendlyDate(project.dates.goLiveDate)}</dd>
                  </div>
                )}
              </dl>

              {/* Attachments section */}
              <div className="mt-4 border-t border-border/50 pt-3 space-y-3">
                {/* Internal documents */}
                <div>
                  <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60">Internal</span>
                  <div className="mt-1 space-y-0.5">
                    {project.links.brdLink && (
                      <a href={project.links.brdLink} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                        <FileStack className="h-4 w-4 text-destructive shrink-0" />
                        <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">BRD Document</p></div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </a>
                    )}
                    {project.links.sowLink && (
                      <a href={project.links.sowLink} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                        <FileText className="h-4 w-4 text-info shrink-0" />
                        <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">SOW Document</p></div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </a>
                    )}
                    {!project.links.brdLink && !project.links.sowLink && (
                      <p className="text-xs text-muted-foreground/60 px-1.5">None yet.</p>
                    )}
                  </div>
                </div>

                {/* Customer-uploaded documents */}
                <div>
                  <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60">Customer uploads</span>
                  <div className="mt-1 space-y-0.5">
                    {customerUploads.length > 0 ? customerUploads.map((u) => (
                      <a key={u.id} href={u.file_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                        <FileText className="h-4 w-4 text-primary/70 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{u.file_name}</p>
                          <p className="text-2xs text-muted-foreground/60">{new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </a>
                    )) : (
                      <p className="text-xs text-muted-foreground/60 px-1.5">No customer uploads yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* People tab */}
            <TabsContent value="people" className="m-0 p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">People</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setPeoplePickerOpen(true)}
                  title="Customize visible fields"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <dl className="space-y-2">
                {visiblePeopleFields.includes("project_owner") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Project owner</dt>
                    <dd className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground shrink-0">
                        {(project.assignedOwnerName || "U").charAt(0).toUpperCase()}
                      </span>
                      {project.assignedOwnerName || "Unassigned"}
                    </dd>
                  </div>
                )}
                {visiblePeopleFields.includes("sales_spoc") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Sales SPOC</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.salesSpoc || "—"}</dd>
                  </div>
                )}
                {visiblePeopleFields.includes("contact_email") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Contact email</dt>
                    <dd className="text-xs font-semibold text-foreground">{project.contactEmail || "—"}</dd>
                  </div>
                )}
                {visiblePeopleFields.includes("current_team") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Current team</dt>
                    <dd className="text-xs font-semibold text-foreground">{getTeamLabel(project.currentOwnerTeam)}</dd>
                  </div>
                )}
                {visiblePeopleFields.includes("current_stage") && (
                  <div className="grid grid-cols-[7rem_1fr] gap-x-3 items-center">
                    <dt className="text-xs text-muted-foreground">Current stage</dt>
                    <dd className="text-xs font-semibold text-foreground">{stageLabels[project.currentStage] || project.currentStage}</dd>
                  </div>
                )}
              </dl>
            </TabsContent>

            {/* §8.4 Activity tab */}
            <TabsContent value="activity" className="m-0 p-3">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Activity</span>
                <span className="text-xs text-muted-foreground">({activityEvents.length})</span>
              </div>
              {activityEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activityEvents.map((ev) => (
                    <div key={ev.id} className="flex gap-2">
                      <div
                        className={cn(
                          "mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center",
                          ev.type === "completion"
                            ? "bg-success/15 text-success-strong"
                            : "bg-info/10 text-info-strong",
                        )}
                      >
                        {ev.type === "completion" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <MessageSquare className="h-3 w-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {ev.type === "completion" ? "Completed" : "Comment"}{" "}
                          <span className="text-muted-foreground font-normal">on</span>{" "}
                          <span className="font-medium">{ev.itemTitle}</span>
                        </p>
                        {ev.text && (
                          <p className="text-2xs text-muted-foreground mt-0.5 line-clamp-2">
                            {ev.text}
                          </p>
                        )}
                        <p className="text-2xs text-muted-foreground mt-0.5">
                          {ev.who} · {shortDate(ev.when)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {subDialogs}

      <FieldPickerDialog
        open={detailsPickerOpen}
        onOpenChange={setDetailsPickerOpen}
        title="Customize Details fields"
        allFields={DETAILS_FIELDS}
        selected={visibleDetailsFields}
        onApply={applyDetailsFields}
      />
      <FieldPickerDialog
        open={peoplePickerOpen}
        onOpenChange={setPeoplePickerOpen}
        title="Customize People fields"
        allFields={PEOPLE_FIELDS}
        selected={visiblePeopleFields}
        onApply={applyPeopleFields}
      />

      {/* ── Celebration overlay ─────────────────────────────────────── */}
      {showCelebration && (
        <TransferUnlockedCelebration
          onClose={() => setShowCelebration(false)}
          onTransfer={onTransferProject}
        />
      )}
    </div>
  );
};

function TransferUnlockedCelebration({ onClose, onTransfer }: { onClose: () => void; onTransfer?: () => void }) {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("visible"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 4500);
    const t3 = setTimeout(onClose, 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onClose]);

  const confetti = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 1.2}s`,
    duration: `${1.8 + Math.random() * 1.4}s`,
    color: ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#f97316"][i % 7],
    size: `${6 + Math.random() * 8}px`,
    rotate: `${Math.random() * 720}deg`,
  }));

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: phase === "exit"
          ? "rgba(0,0,0,0)"
          : phase === "visible"
          ? "rgba(0,0,0,0.45)"
          : "rgba(0,0,0,0)",
        transition: "background 0.5s ease",
        backdropFilter: phase === "visible" ? "blur(2px)" : "none",
      }}
      onClick={onClose}
    >
      {/* Confetti */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {confetti.map((c) => (
          <div
            key={c.id}
            className="absolute top-0 rounded-sm"
            style={{
              left: c.left,
              width: c.size,
              height: c.size,
              background: c.color,
              opacity: phase === "visible" ? 1 : 0,
              animation: phase === "visible"
                ? `confettiFall ${c.duration} ${c.delay} ease-in forwards`
                : undefined,
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div
        className="relative bg-white dark:bg-card rounded-2xl shadow-2xl px-10 py-10 flex flex-col items-center gap-4 text-center max-w-sm w-full mx-4"
        style={{
          transform: phase === "visible" ? "scale(1) translateY(0)" : phase === "exit" ? "scale(0.9) translateY(20px)" : "scale(0.8) translateY(40px)",
          opacity: phase === "visible" ? 1 : 0,
          transition: "transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 56, lineHeight: 1 }}>🎉</div>
        <div>
          <p className="text-xl font-bold text-foreground leading-tight">All tasks complete!</p>
          <p className="text-base font-semibold text-primary mt-1">Transfer is now unlocked.</p>
        </div>
        <div className="flex items-center gap-2 bg-success/10 text-success-strong rounded-full px-4 py-2 text-sm font-medium">
          <span>✅</span>
          <span>You can now transfer this project to the next team.</span>
        </div>
        <p className="text-muted-foreground text-sm italic mt-1">Sit back and relax! 🛋️</p>
        {onTransfer && (
          <button
            onClick={() => { onClose(); onTransfer(); }}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            → Transfer project
          </button>
        )}
      </div>

      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          80%  { opacity: 0.8; }
          100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
