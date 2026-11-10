import { useState, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Project, ProjectChecklist, calculateTimeByParty, formatDuration, ResponsibilityParty } from "@/data/projectsData";
import { useUpdateChecklistItem } from "@/hooks/useUpdateChecklistItem";
import { useProjects } from "@/contexts/ProjectContext";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { useProfilesLookup } from "@/hooks/useLookups";
import { UserAvatar } from "@/components/UserAvatar";
import { useLabels } from "@/contexts/LabelsContext";
import { supabase } from "@/integrations/supabase/client";
import {
  useChecklistTasks,
  useAddChecklistTask,
  useUpdateChecklistTask,
  useDeleteChecklistTask,
  ChecklistTask,
} from "@/hooks/useChecklistTasks";
import {
  useChecklistMeetings,
  useAddChecklistMeeting,
  useAnalyseMeeting,
  ChecklistMeeting,
  MEETING_PROVIDERS,
} from "@/hooks/useChecklistMeetings";
import {
  useChecklistComments,
  useAddChecklistComment,
  useDeleteChecklistComment,
  ChecklistComment,
} from "@/hooks/useChecklistComments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Circle,
  CalendarDays,
  X,
  Plus,
  Video,
  Clock,
  ExternalLink,
  Trash2,
  Users,
  Timer,
  Sparkles,
  MessageSquare,
  Send,
  ChevronDown,
  ChevronRight,
  Building2,
  Minus,
  Calendar,
  ListTodo,
} from "lucide-react";
import { format, parseISO, isValid, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  project: Project;
}

type KanbanStage = "mint" | "integration" | "ms" | "completed";

const COLUMN_ACCENT: Record<string, { border: string; badge: string; badgeText: string; headerBg: string }> = {
  mint:        { border: "border-emerald-200 dark:border-emerald-900", badge: "bg-emerald-500", badgeText: "text-white", headerBg: "bg-emerald-50 dark:bg-emerald-950/40" },
  integration: { border: "border-blue-200 dark:border-blue-900",       badge: "bg-blue-500",    badgeText: "text-white", headerBg: "bg-blue-50 dark:bg-blue-950/40" },
  ms:          { border: "border-amber-200 dark:border-amber-900",      badge: "bg-amber-500",   badgeText: "text-white", headerBg: "bg-amber-50 dark:bg-amber-950/40" },
  completed:   { border: "border-slate-200 dark:border-slate-700",      badge: "bg-slate-400",   badgeText: "text-white", headerBg: "bg-slate-50 dark:bg-slate-800/40" },
};

const TASK_STATUS_ICON: Record<string, ReactNode> = {
  done:        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />,
  in_progress: <Clock        className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />,
  open:        <Circle       className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />,
};

const RESPONSIBILITY_LABELS: Record<string, string> = {
  gokwik: "GoKwik",
  merchant: "Merchant",
  neutral: "Neutral",
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  try { const p = parseISO(d); return isValid(p) ? format(p, "MMM d") : null; } catch { return null; }
}

function fmtDateTime(d?: string | null) {
  if (!d) return null;
  try { const p = parseISO(d); return isValid(p) ? format(p, "MMM d · h:mm a") : null; } catch { return null; }
}

// ─── Add Task Dialog ──────────────────────────────────────────────────────────

function AddTaskDialog({
  open,
  onOpenChange,
  itemId,
  itemTitle,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  itemTitle: string;
  projectId: string;
}) {
  const addTask = useAddChecklistTask();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  const reset = () => { setTitle(""); setDescription(""); setDueDate(""); };

  const submit = () => {
    if (!title.trim()) { toast.error("Task title is required"); return; }
    addTask.mutate(
      {
        checklist_item_id: itemId,
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate || undefined,
      },
      {
        onSuccess: () => { onOpenChange(false); reset(); },
        onError: () => toast.error("Failed to add task"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Add task</DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{itemTitle}</p>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Title <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Task title"
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              className="text-sm min-h-[72px] resize-none"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={addTask.isPending}>
              {addTask.isPending ? "Adding…" : "Add task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Meeting Dialog ──────────────────────────────────────────────────

function ScheduleMeetingDialog({
  open,
  onOpenChange,
  itemId,
  itemTitle,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  itemTitle: string;
  projectId: string;
  projectName: string;
}) {
  const addMeeting = useAddChecklistMeeting();
  const { currentUser } = useAuth();
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<"google_meet" | "zoom" | "teams">("google_meet");
  const [joinUrl, setJoinUrl] = useState("");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");

  const reset = () => { setTitle(""); setJoinUrl(""); setDate(format(new Date(), "yyyy-MM-dd")); setTime("10:00"); setDuration("60"); };

  const submit = () => {
    if (!title.trim()) { toast.error("Meeting title required"); return; }
    if (!joinUrl.trim()) { toast.error("Join URL required"); return; }
    addMeeting.mutate(
      {
        checklist_item_id: itemId,
        project_id: projectId,
        title: title.trim(),
        provider,
        join_url: joinUrl.trim(),
        scheduled_at: new Date(`${date}T${time}:00`).toISOString(),
        duration_minutes: parseInt(duration) || 60,
        attendees: currentUser?.email ? [currentUser.email] : [],
        send_invite: false,
        project_name: projectName,
        checklist_item_title: itemTitle,
      },
      {
        onSuccess: () => { onOpenChange(false); reset(); },
        onError: () => toast.error("Failed to schedule meeting"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Schedule meeting</DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{itemTitle}</p>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Title <span className="text-destructive">*</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className="h-8 text-sm" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEETING_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Duration (min)</Label>
              <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Join URL <span className="text-destructive">*</span></Label>
            <Input value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} placeholder={MEETING_PROVIDERS.find(p => p.value === provider)?.hint} className="h-8 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={addMeeting.isPending}>
              {addMeeting.isPending ? "Scheduling…" : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item detail dialog ───────────────────────────────────────────────────────

const TASK_STATUS_CYCLE: Record<string, ChecklistTask["status"]> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
};

const PROVIDER_ICONS: Record<string, string> = {
  google_meet: "🟢",
  zoom: "🔵",
  teams: "🟣",
};

// ─── Task row (expandable, with comments) ─────────────────────────────────────

function TaskRow({
  task,
  itemId,
  onCycle,
  onDelete,
}: {
  task: ChecklistTask;
  itemId: string;
  onCycle: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const { currentUser } = useAuth();
  const { profiles } = useProfilesLookup();
  const addComment = useAddChecklistComment();
  const deleteComment = useDeleteChecklistComment();
  const { data: taskComments = [] } = useChecklistComments(expanded ? itemId : null);
  const comments = taskComments.filter((c) => c.checklist_task_id === task.id);

  const submitComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(
      { checklistItemId: itemId, checklistTaskId: task.id, comment: commentText.trim() },
      { onSuccess: () => setCommentText("") },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-3">
          <button type="button" title={`${TASK_STATUS_LABEL[task.status]} — click to advance`} onClick={onCycle} className="mt-0.5 flex-shrink-0">
            {task.status === "done"
              ? <CheckCircle2 className="h-4 w-4 text-green-500" />
              : task.status === "in_progress"
              ? <Clock        className="h-4 w-4 text-blue-500" />
              : <Circle       className="h-4 w-4 text-muted-foreground/30" />
            }
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium leading-snug ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
            {task.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.description}</p>}
            <div className="flex items-center gap-3 mt-1.5">
              <Badge variant="outline" className="text-2xs px-1.5 py-0 font-normal">{TASK_STATUS_LABEL[task.status]}</Badge>
              {task.due_date && <span className="flex items-center gap-1 text-2xs text-muted-foreground"><CalendarDays className="h-3 w-3" />{fmtDate(task.due_date)}</span>}
              {task.estimated_hours && <span className="flex items-center gap-1 text-2xs text-muted-foreground"><Timer className="h-3 w-3" />{task.estimated_hours}h</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-0.5 text-2xs text-muted-foreground/50 hover:text-primary transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {comments.length > 0 && <span>{comments.length}</span>}
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            <button type="button" onClick={onDelete} className="text-muted-foreground/30 hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Comment section */}
      {expanded && (
        <div className="border-t border-border/60 px-3.5 py-3 bg-background/60 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <UserAvatar name={c.user_name || "?"} avatarUrl={profiles.find((p) => p.id === c.user_id)?.avatar_url} size="xs" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xs font-semibold">{c.user_name}</span>
                  <span className="text-2xs text-muted-foreground/50">{formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}</span>
                </div>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">{c.comment}</p>
              </div>
              {c.user_id === currentUser?.id && (
                <button type="button" onClick={() => deleteComment.mutate({ commentId: c.id, checklistItemId: itemId })} className="text-muted-foreground/30 hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              placeholder="Leave a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={submitComment} disabled={!commentText.trim() || addComment.isPending}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Item detail dialog — matches ChecklistDialog expanded row exactly ────────

const shortDate = (v: string) =>
  new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function ItemDetailDialog({
  item,
  project,
  teamLabel,
  open,
  onOpenChange,
}: {
  item: ProjectChecklist;
  project: Project;
  teamLabel: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toggleChecklistResponsibility } = useProjects();
  const { responsibilityLabels } = useLabels();
  const { currentUser } = useAuth();
  const { profiles } = useProfilesLookup();

  const updateTask = useUpdateChecklistTask();
  const deleteTask = useDeleteChecklistTask();
  const analyseMeeting = useAnalyseMeeting();
  const addComment = useAddChecklistComment();
  const deleteComment = useDeleteChecklistComment();

  const { data: tasks = [] } = useChecklistTasks(open ? project.id : undefined);
  const { data: meetings = [] } = useChecklistMeetings(open ? project.id : undefined);
  const { data: allComments = [] } = useChecklistComments(open ? item.id : null);

  const itemTasks = tasks.filter((t) => t.checklist_item_id === item.id);
  const itemMeetings = meetings.filter((m) => m.checklist_item_id === item.id);
  const itemComments = allComments.filter((c) => !c.checklist_task_id);

  const doneTasks = itemTasks.filter((t) => t.status === "done").length;
  const pct = itemTasks.length ? Math.round((doneTasks / itemTasks.length) * 100) : 0;
  const ts = calculateTimeByParty(item.responsibilityLog ?? []);

  const [commentText, setCommentText] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [meetingDialogOpen, setMeetingDialogOpen] = useState(false);

  const submitComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(
      { checklistItemId: item.id, comment: commentText.trim() },
      { onSuccess: () => setCommentText("") },
    );
  };

  const handleResponsibility = (v: string) => {
    if (v === "gokwik" || v === "merchant" || v === "neutral") {
      toggleChecklistResponsibility(project.id, item.id, v as ResponsibilityParty);
    }
  };

  const updateDate = async (field: "start_date" | "due_date", value: string | null) => {
    const patch = field === "start_date"
      ? { start_date: value || null }
      : { due_date: value || null };
    await supabase.from("checklist_items").update(patch).eq("id", item.id);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-6xl max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex-shrink-0">
              {item.completed ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <Circle className="h-5 w-5 text-muted-foreground/30" />}
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className={`text-base font-semibold leading-snug ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                {item.title}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <Badge variant="secondary" className="text-xs">{teamLabel}</Badge>
                {item.completed && <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Completed</Badge>}
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 space-y-4">

            {/* ── Metadata bar: matches ChecklistDialog expanded row exactly ── */}
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
                  onValueChange={handleResponsibility}
                  disabled={item.completed}
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
                {!item.completed ? (
                  <Input
                    type="date"
                    defaultValue={item.startDate || ""}
                    className="h-6 w-30 text-xs px-1.5 border-border/50"
                    onChange={(e) => updateDate("start_date", e.target.value)}
                  />
                ) : (
                  <span className="text-xs font-medium">{item.startDate ? shortDate(item.startDate) : "—"}</span>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">→ Due</span>
                {!item.completed ? (
                  <Input
                    type="date"
                    defaultValue={item.dueDate || ""}
                    className="h-6 w-30 text-xs px-1.5 border-border/50"
                    onChange={(e) => updateDate("due_date", e.target.value)}
                  />
                ) : (
                  <span className="text-xs font-medium">{item.dueDate ? shortDate(item.dueDate) : "—"}</span>
                )}
              </div>

              {/* Time tracking */}
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
            </div>

            {/* ── Tasks + Meetings side-by-side ── */}
            <div className="grid grid-cols-2 gap-3">
              {/* Tasks box */}
              <div className="rounded-lg border border-border/50 bg-background flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                  <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">Tasks</span>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {doneTasks}/{itemTasks.length} done ({pct}%)
                  </span>
                </div>
                <div className="h-0.5 bg-border/30">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-[1fr_6rem_6rem] gap-x-2 px-3 py-1.5 text-2xs font-medium text-muted-foreground border-b border-border/30 bg-muted/20">
                  <span>Task</span>
                  <span>Due date</span>
                  <span />
                </div>
                <div className="flex-1 overflow-y-auto max-h-[160px] divide-y divide-border/20">
                  {itemTasks.map((task) => (
                    <div
                      key={task.id}
                      className="group grid grid-cols-[1fr_6rem_6rem] gap-x-2 items-center px-3 py-2 hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => updateTask.mutate({ id: task.id, status: task.status === "done" ? "open" : "done" })}
                          className="flex-shrink-0"
                        >
                          {task.status === "done"
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            : <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />
                          }
                        </button>
                        <span className={`text-xs truncate ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                          {task.title}
                        </span>
                      </div>
                      <span className="text-2xs text-muted-foreground whitespace-nowrap">
                        {task.due_date ? shortDate(task.due_date) : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteTask.mutate(task.id, { onError: () => toast.error("Failed to delete") })}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {itemTasks.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground">No tasks yet.</p>
                  )}
                </div>

                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border/30 w-full"
                  onClick={() => setTaskDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> Add task
                </button>
              </div>

              {/* Meetings box */}
              <div className="rounded-lg border border-border/50 bg-background flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                  <Video className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">Meetings</span>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {itemMeetings.length > 0 ? `${itemMeetings.length} scheduled` : "None scheduled"}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[200px] divide-y divide-border/20">
                  {itemMeetings.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">No meetings yet.</p>
                  ) : (
                    itemMeetings.map((m) => (
                      <div key={m.id} className="px-3 py-2.5 flex items-start gap-2 hover:bg-muted/30">
                        <span className="text-sm flex-shrink-0 mt-0.5">{PROVIDER_ICONS[m.provider] || "📹"}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-snug ${m.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{m.title}</p>
                          {m.scheduled_at && <p className="text-2xs text-muted-foreground/60 mt-0.5">{fmtDateTime(m.scheduled_at)}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {m.join_url && (
                            <a href={m.join_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-2xs text-primary hover:underline">
                              Join <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => analyseMeeting.mutate({ meetingId: m.id })}
                            disabled={analyseMeeting.isPending || m.analysis_status === "processing"}
                            className="flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-purple-600 transition-colors disabled:opacity-40"
                          >
                            <Sparkles className="h-3 w-3" />
                            {m.analysis_status === "done" ? "Re-analyse" : "Analyse"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-t border-border/30 w-full"
                  onClick={() => setMeetingDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> Schedule meeting
                </button>
              </div>
            </div>

            {/* ── Discussion ── */}
            <div className="rounded-lg border border-border/50 bg-background overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">Discussion</span>
                {itemComments.length > 0 && (
                  <span className="ml-auto text-2xs text-muted-foreground">{itemComments.length} comment{itemComments.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="px-3 py-3 space-y-3">
                {itemComments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <UserAvatar name={c.user_name || "?"} avatarUrl={profiles.find((p) => p.id === c.user_id)?.avatar_url} size="sm" className="mt-0.5" />
                    <div className="flex-1 min-w-0 rounded-lg bg-muted/30 px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold">{c.user_name}</span>
                        <span className="text-2xs text-muted-foreground/50">{formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}</span>
                        {c.user_id === currentUser?.id && (
                          <button type="button" onClick={() => deleteComment.mutate({ commentId: c.id, checklistItemId: item.id })} className="ml-auto text-muted-foreground/30 hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-foreground mt-0.5 leading-relaxed">{c.comment}</p>
                    </div>
                  </div>
                ))}
                {itemComments.length === 0 && (
                  <p className="text-xs text-muted-foreground">No comments yet.</p>
                )}
                {/* Comment input */}
                <div className="flex gap-2 items-start pt-1">
                  <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-2xs font-bold text-primary flex-shrink-0 mt-1">
                    {currentUser?.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 relative">
                    <Textarea
                      placeholder="Add a comment… Use @ to tag a teammate (Ctrl+Enter to send)"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitComment(); } }}
                      className="text-sm min-h-[72px] resize-none pr-10"
                      rows={2}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute right-2 bottom-2 h-6 w-6 p-0"
                      onClick={submitComment}
                      disabled={!commentText.trim() || addComment.isPending}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <TaskManagementDialog
      open={taskDialogOpen}
      onOpenChange={setTaskDialogOpen}
      checklistItemId={item.id}
      checklistItemTitle={item.title}
      projectId={project.id}
      projectName={project.merchantName}
      profiles={profiles}
    />

    <MeetingSchedulerDialog
      open={meetingDialogOpen}
      onOpenChange={setMeetingDialogOpen}
      checklistItemId={item.id}
      checklistItemTitle={item.title}
      projectId={project.id}
      projectName={project.merchantName}
    />
    </>
  );
}

function AddMeetingInline({
  itemId, itemTitle, projectId, projectName, currentUserEmail,
}: { itemId: string; itemTitle: string; projectId: string; projectName: string; currentUserEmail?: string }) {
  const addMeeting = useAddChecklistMeeting();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<"google_meet" | "zoom" | "teams">("google_meet");
  const [joinUrl, setJoinUrl] = useState("");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");

  const reset = () => { setTitle(""); setJoinUrl(""); setDate(format(new Date(), "yyyy-MM-dd")); setTime("10:00"); setDuration("60"); setOpen(false); };

  const submit = () => {
    if (!title.trim() || !joinUrl.trim()) { toast.error("Title and join URL required"); return; }
    addMeeting.mutate(
      {
        checklist_item_id: itemId, project_id: projectId, title: title.trim(), provider,
        join_url: joinUrl.trim(), scheduled_at: new Date(`${date}T${time}:00`).toISOString(),
        duration_minutes: parseInt(duration) || 60, attendees: currentUserEmail ? [currentUserEmail] : [],
        send_invite: false, project_name: projectName, checklist_item_title: itemTitle,
      },
      { onSuccess: reset, onError: () => toast.error("Failed to schedule meeting") },
    );
  };

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-primary transition-colors py-1">
      <Plus className="h-3.5 w-3.5" /> Schedule meeting
    </button>
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-muted/20 px-3.5 py-3 space-y-2">
      <Input autoFocus placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 text-xs" />
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-7 text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{MEETING_PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Min" className="h-7 text-xs" />
      </div>
      <Input placeholder="Join URL" value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} className="h-8 text-sm" />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={submit} disabled={addMeeting.isPending}>
          {addMeeting.isPending ? "Saving…" : "Schedule"}
        </Button>
      </div>
    </div>
  );
}

// ─── Kanban task card (expandable, inline comment thread) ─────────────────────

function KanbanTaskCard({
  task,
  itemId,
  onCycle,
}: {
  task: ChecklistTask;
  itemId: string;
  onCycle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const { currentUser } = useAuth();
  const { profiles } = useProfilesLookup();
  const addComment = useAddChecklistComment();
  const deleteComment = useDeleteChecklistComment();
  const { data: allItemComments = [] } = useChecklistComments(expanded ? itemId : null);
  const comments = allItemComments.filter((c) => c.checklist_task_id === task.id);

  const submitComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(
      { checklistItemId: itemId, checklistTaskId: task.id, comment: commentText.trim() },
      { onSuccess: () => setCommentText("") },
    );
  };

  return (
    <div className="rounded-xl border border-border bg-white dark:bg-card shadow-sm overflow-hidden">
      {/* Card header row */}
      <div
        role="button"
        tabIndex={0}
        className="px-3.5 py-2.5 flex items-start gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      >
        {/* Status icon stops propagation so it only cycles, doesn't expand */}
        <button
          type="button"
          title={`${TASK_STATUS_LABEL[task.status]} — click to advance`}
          onClick={(e) => { e.stopPropagation(); onCycle(); }}
          className="flex-shrink-0 mt-0.5"
        >
          {task.status === "done"
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            : task.status === "in_progress"
            ? <Clock        className="h-3.5 w-3.5 text-blue-500" />
            : <Circle       className="h-3.5 w-3.5 text-muted-foreground/30" />
          }
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium leading-snug ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </p>
          {task.description && <p className="text-2xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>}
          {task.due_date && <span className="text-2xs text-muted-foreground/60 mt-0.5 block">{fmtDate(task.due_date)}</span>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {comments.length > 0 && !expanded && (
            <span className="text-2xs text-muted-foreground/50 flex items-center gap-0.5">
              <MessageSquare className="h-3 w-3" />{comments.length}
            </span>
          )}
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
        </div>
      </div>

      {/* Inline comment thread */}
      {expanded && (
        <div className="border-t border-border/50 px-3.5 py-2.5 bg-muted/20 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <UserAvatar name={c.user_name || "?"} avatarUrl={profiles.find((p) => p.id === c.user_id)?.avatar_url} size="xs" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xs font-semibold">{c.user_name}</span>
                  <span className="text-2xs text-muted-foreground/50">{formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}</span>
                </div>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">{c.comment}</p>
              </div>
              {c.user_id === currentUser?.id && (
                <button type="button" onClick={() => deleteComment.mutate({ commentId: c.id, checklistItemId: itemId })} className="text-muted-foreground/30 hover:text-destructive flex-shrink-0">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input
              autoFocus
              placeholder="Comment… (Enter to send)"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" variant="ghost" className="h-7 px-2 flex-shrink-0" onClick={submitComment} disabled={!commentText.trim() || addComment.isPending}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Item card (no drag-drop) ─────────────────────────────────────────────────

function ItemCard({
  item,
  tasks,
  meetings,
  project,
  teamLabel,
  onCycleTask,
}: {
  item: ProjectChecklist;
  tasks: ChecklistTask[];
  meetings: ChecklistMeeting[];
  project: Project;
  teamLabel: string;
  onCycleTask: (taskId: string, next: ChecklistTask["status"]) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const doneTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <>
      <div className="flex flex-col gap-2 w-[240px] flex-shrink-0">
        {/* ── Item header card — click to open detail ── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setDetailOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDetailOpen(true); }}
          className="rounded-xl border border-border bg-white dark:bg-card shadow-sm px-3.5 pt-3.5 pb-3 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex-shrink-0">
              {item.completed
                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                : <Circle       className="h-4 w-4 text-muted-foreground/30" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold leading-snug ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {item.title}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {(item.startDate || item.dueDate) && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3 flex-shrink-0" />
                    {fmtDate(item.startDate || item.dueDate)}
                  </span>
                )}
                {tasks.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {doneTasks}/{tasks.length} tasks
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tasks label ── */}
        <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/50 px-1">
          Tasks{tasks.length > 0 ? ` · ${doneTasks}/${tasks.length}` : ""}
        </p>

        {/* ── One card per task — click body to expand comments ── */}
        {tasks.map((t) => (
          <KanbanTaskCard
            key={t.id}
            task={t}
            itemId={item.id}
            onCycle={() => onCycleTask(t.id, TASK_STATUS_CYCLE[t.status] || "open")}
          />
        ))}

        {/* ── Add task triggers detail dialog ── */}
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-primary transition-colors px-1"
        >
          <Plus className="h-3.5 w-3.5" /> Add task
        </button>

        {/* ── Meetings label ── */}
        <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/50 px-1 mt-1">
          Meetings{meetings.length > 0 ? ` · ${meetings.length}` : ""}
        </p>

        {/* ── One card per meeting with join button ── */}
        {meetings.map((m) => (
          <div key={m.id} className="rounded-xl border border-border bg-white dark:bg-card shadow-sm px-3.5 py-2.5">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 text-sm mt-0.5">{PROVIDER_ICONS[m.provider] || "📹"}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-snug ${m.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{m.title}</p>
                {m.scheduled_at && (
                  <p className="text-2xs text-muted-foreground/60 mt-0.5">{fmtDateTime(m.scheduled_at)}</p>
                )}
              </div>
              {m.join_url && (
                <a
                  href={m.join_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-shrink-0 text-2xs text-primary hover:underline flex items-center gap-0.5 mt-0.5"
                >
                  Join <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-primary transition-colors px-1"
        >
          <Plus className="h-3.5 w-3.5" /> Schedule meeting
        </button>
      </div>

      {/* ── Item panel dialog — shows only the expanded row panel for this item ── */}
      {detailOpen && (
        <ItemDetailDialog
          item={item}
          project={project}
          teamLabel={teamLabel}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )}
    </>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ChecklistKanbanView({ project }: Props) {
  const updateTask = useUpdateChecklistTask();
  const { stageLabels, teamLabels, responsibilityLabels } = useLabels();

  const { data: allTasks = [] } = useChecklistTasks(project.id);
  const { data: allMeetings = [] } = useChecklistMeetings(project.id);

  const tasksByItem = useMemo(() =>
    allTasks.reduce<Record<string, ChecklistTask[]>>((acc, t) => {
      (acc[t.checklist_item_id] ||= []).push(t);
      return acc;
    }, {}), [allTasks]);

  const meetingsByItem = useMemo(() =>
    allMeetings.reduce<Record<string, ChecklistMeeting[]>>((acc, m) => {
      (acc[m.checklist_item_id] ||= []).push(m);
      return acc;
    }, {}), [allMeetings]);

  // Groups are by ownerTeam; completed is a special row for done items regardless of team
  const TEAM_ROWS = (["mint", "integration", "ms"] as const).map((key) => ({
    key,
    label: teamLabels[key] || stageLabels[key] || key,
    accent: COLUMN_ACCENT[key] ?? COLUMN_ACCENT.completed,
  }));

  const allTeams = [...new Set(project.checklist.filter(i => !i.isTask).map(i => i.ownerTeam))];
  const [filterTeams, setFilterTeams] = useState<string[]>([]);
  const [filterResponsibility, setFilterResponsibility] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);

  const hasFilters = filterTeams.length > 0 || filterResponsibility !== null || !showCompleted;

  const baseItems = project.checklist.filter((i) => !i.isTask);

  const filteredItems = baseItems.filter(item => {
    if (filterTeams.length > 0 && !filterTeams.includes(item.ownerTeam)) return false;
    if (filterResponsibility && item.currentResponsibility !== filterResponsibility) return false;
    if (!showCompleted && item.completed) return false;
    return true;
  });

  // Team columns: mint | integration | ms  (horizontal, no completed)
  const teamColumns = TEAM_ROWS.map((row) => ({
    ...row,
    items: filteredItems.filter((i) => i.ownerTeam === row.key),
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background/95 flex-shrink-0">
        <span className="text-xs text-muted-foreground font-medium">Filter:</span>

        {allTeams.map(team => (
          <button
            key={team}
            type="button"
            onClick={() => setFilterTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team])}
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
            {responsibilityLabels[resp] || RESPONSIBILITY_LABELS[resp]}
          </button>
        ))}

        <span className="h-3.5 w-px bg-border/60" />

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
            variant="ghost" size="sm"
            className="h-6 px-1.5 text-2xs text-muted-foreground gap-0.5 ml-1"
            onClick={() => { setFilterTeams([]); setFilterResponsibility(null); setShowCompleted(true); }}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
        {hasFilters && (
          <span className="ml-auto text-2xs text-muted-foreground">
            {filteredItems.length} of {baseItems.length} items
          </span>
        )}
      </div>

      {/* Board — 3 horizontal columns, page scrolls (no per-column overflow) */}
      <div className="flex-1 overflow-x-auto overflow-y-auto bg-muted/10">
        <div className="flex gap-0 divide-x divide-border min-h-full w-max min-w-full">
          {teamColumns.map((col) => {
            const colTasks = allTasks.filter(t => col.items.some(i => i.id === t.checklist_item_id));
            const colDone = colTasks.filter(t => t.status === "done").length;
            const accent = col.accent;

            return (
              <div key={col.key} className="flex flex-col flex-shrink-0" style={{ width: Math.max(320, col.items.length * 256 + 24) }}>
                {/* Column header */}
                <div className={`flex items-center gap-2 px-4 py-3 border-b ${accent.border} ${accent.headerBg} sticky top-0 z-10`}>
                  <span className={`flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-2xs font-bold ${accent.badge} ${accent.badgeText}`}>
                    {col.items.length}
                  </span>
                  <span className="text-sm font-bold text-foreground">{col.label}</span>
                  {colTasks.length > 0 && (
                    <span className="ml-auto text-2xs text-muted-foreground">{colDone}/{colTasks.length} tasks</span>
                  )}
                </div>

                {/* Items laid out horizontally, no overflow — column expands to fit */}
                <div className="flex flex-row gap-3 p-3 items-start flex-1">
                  {col.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      tasks={tasksByItem[item.id] || []}
                      meetings={meetingsByItem[item.id] || []}
                      project={project}
                      teamLabel={teamLabels[item.ownerTeam] || item.ownerTeam}
                      onCycleTask={(taskId, next) => updateTask.mutate({ id: taskId, status: next })}
                    />
                  ))}
                  {col.items.length === 0 && (
                    <div className="flex items-center justify-center w-full py-12 text-xs text-muted-foreground/40 italic">
                      No items
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
