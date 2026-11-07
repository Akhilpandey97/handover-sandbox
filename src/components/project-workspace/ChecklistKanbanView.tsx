import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { Project, ProjectChecklist } from "@/data/projectsData";
import { useUpdateChecklistItem } from "@/hooks/useUpdateChecklistItem";
import { useLabels } from "@/contexts/LabelsContext";
import {
  useChecklistTasks,
  useAddChecklistTask,
  useUpdateChecklistTask,
  ChecklistTask,
} from "@/hooks/useChecklistTasks";
import {
  useChecklistMeetings,
  useAddChecklistMeeting,
  ChecklistMeeting,
  MEETING_PROVIDERS,
} from "@/hooks/useChecklistMeetings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  CheckCircle2,
  Circle,
  CalendarDays,
  X,
  Plus,
  Video,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  project: Project;
}

type KanbanStage = "mint" | "integration" | "ms" | "completed";

const COLUMN_ACCENT: Record<KanbanStage, { header: string; ring: string; badge: string }> = {
  mint:        { header: "border-t-emerald-500", ring: "ring-emerald-400/40",  badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  integration: { header: "border-t-blue-500",    ring: "ring-blue-400/40",     badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  ms:          { header: "border-t-amber-500",   ring: "ring-amber-400/40",    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  completed:   { header: "border-t-slate-400",   ring: "ring-slate-400/40",    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

const TASK_STATUS_ICON: Record<string, ReactNode> = {
  done:        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />,
  in_progress: <Clock        className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />,
  open:        <Circle       className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />,
};

const RESPONSIBILITY_LABELS: Record<string, string> = {
  gokwik: "GoKwik",
  merchant: "Merchant",
  neutral: "Neutral",
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  try {
    const p = parseISO(d);
    return isValid(p) ? format(p, "MMM d") : null;
  } catch { return null; }
}

function fmtDateTime(d?: string | null) {
  if (!d) return null;
  try {
    const p = parseISO(d);
    return isValid(p) ? format(p, "MMM d · h:mm a") : null;
  } catch { return null; }
}

// ─── Inline task add ──────────────────────────────────────────────────────────

function TaskQuickAdd({
  itemId,
  projectId,
  onDone,
}: {
  itemId: string;
  projectId: string;
  onDone: () => void;
}) {
  const addTask = useAddChecklistTask();
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const t = title.trim();
    if (!t) { onDone(); return; }
    addTask.mutate(
      { checklist_item_id: itemId, project_id: projectId, title: t },
      { onSuccess: onDone, onError: () => toast.error("Failed to add task") },
    );
    setTitle("");
  };

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onDone(); }}
        onBlur={submit}
        placeholder="Task title…"
        className="h-6 text-xs border-0 border-b rounded-none px-0 shadow-none focus-visible:ring-0 bg-transparent"
      />
    </div>
  );
}

// ─── Schedule meeting mini dialog ─────────────────────────────────────────────

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

  const submit = async () => {
    if (!title.trim()) { toast.error("Meeting title required"); return; }
    if (!joinUrl.trim()) { toast.error("Join URL required"); return; }
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    addMeeting.mutate(
      {
        checklist_item_id: itemId,
        project_id: projectId,
        title: title.trim(),
        provider,
        join_url: joinUrl.trim(),
        scheduled_at: scheduledAt,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Schedule meeting</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{itemTitle}</p>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className="h-8 text-sm" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Time</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Platform</label>
              <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEETING_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Duration (min)</label>
              <Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Join URL</label>
            <Input value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} placeholder={MEETING_PROVIDERS.find(p => p.value === provider)?.hint} className="h-8 text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={addMeeting.isPending}>
              {addMeeting.isPending ? "Scheduling…" : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Kanban card ──────────────────────────────────────────────────────────────

function KanbanCard({
  item,
  teamLabel,
  tasks,
  meetings,
  projectId,
  projectName,
  onDragStart,
  onToggleTask,
}: {
  item: ProjectChecklist;
  teamLabel: string;
  tasks: ChecklistTask[];
  meetings: ChecklistMeeting[];
  projectId: string;
  projectName: string;
  onDragStart: (id: string) => void;
  onToggleTask: (taskId: string, done: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [addingTask, setAddingTask] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);

  const doneTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <>
      <div
        draggable
        onDragStart={() => onDragStart(item.id)}
        className="rounded-xl border border-border bg-card shadow-sm cursor-grab hover:shadow-md transition-shadow overflow-hidden"
      >
        {/* Card header */}
        <div className="p-3.5 pb-2.5">
          <div className="flex items-start gap-2.5">
            {item.completed
              ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              : <Circle       className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
            }
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold leading-snug ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                {item.title}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {teamLabel}
                </span>
                {(item.startDate || item.dueDate) && (
                  <span className="flex items-center gap-0.5 text-2xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {fmtDate(item.startDate) && <span>{fmtDate(item.startDate)}</span>}
                    {item.startDate && item.dueDate && <span>→</span>}
                    {fmtDate(item.dueDate) && <span>{fmtDate(item.dueDate)}</span>}
                  </span>
                )}
                {tasks.length > 0 && (
                  <span className="text-2xs text-muted-foreground">
                    {doneTasks}/{tasks.length} tasks
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 mt-0.5"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Expanded sub-items */}
        {expanded && (
          <div className="border-t border-border/50 px-3.5 pb-3 pt-2.5 space-y-3">
            {/* Tasks section */}
            <div>
              <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Tasks {tasks.length > 0 ? `· ${doneTasks}/${tasks.length}` : ""}
              </p>
              <div className="space-y-1">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={() => onToggleTask(t.id, t.status !== "done")}
                      className="flex-shrink-0"
                    >
                      {TASK_STATUS_ICON[t.status] || TASK_STATUS_ICON.open}
                    </button>
                    <span className={`text-xs flex-1 min-w-0 truncate ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {t.title}
                    </span>
                    {t.due_date && (
                      <span className="text-2xs text-muted-foreground/70 flex-shrink-0">{fmtDate(t.due_date)}</span>
                    )}
                  </div>
                ))}
                {addingTask ? (
                  <TaskQuickAdd
                    itemId={item.id}
                    projectId={projectId}
                    onDone={() => setAddingTask(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTask(true)}
                    className="flex items-center gap-1 text-2xs text-muted-foreground/60 hover:text-primary transition-colors mt-0.5"
                  >
                    <Plus className="h-3 w-3" /> Add task
                  </button>
                )}
              </div>
            </div>

            {/* Meetings section */}
            <div>
              <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Meetings {meetings.length > 0 ? `· ${meetings.length}` : ""}
              </p>
              <div className="space-y-1">
                {meetings.map((m) => (
                  <div key={m.id} className="flex items-start gap-2">
                    <Video className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs truncate ${m.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                        {m.title}
                      </p>
                      {m.scheduled_at && (
                        <p className="text-2xs text-muted-foreground/70">{fmtDateTime(m.scheduled_at)}</p>
                      )}
                    </div>
                    {m.status === "completed" && (
                      <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0 mt-0.5" />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setMeetingOpen(true)}
                  className="flex items-center gap-1 text-2xs text-muted-foreground/60 hover:text-primary transition-colors"
                >
                  <Plus className="h-3 w-3" /> Schedule meeting
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ScheduleMeetingDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        itemId={item.id}
        itemTitle={item.title}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ChecklistKanbanView({ project }: Props) {
  const updateItem = useUpdateChecklistItem(project.id);
  const updateTask = useUpdateChecklistTask();
  const { stageLabels, teamLabels, responsibilityLabels } = useLabels();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStage | null>(null);

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

  const COLUMNS = (["mint", "integration", "ms", "completed"] as KanbanStage[]).map((key) => ({
    key,
    label: stageLabels[key] || key,
    accent: COLUMN_ACCENT[key],
  }));

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

  function handleToggleTask(taskId: string, done: boolean) {
    updateTask.mutate({ id: taskId, status: done ? "done" : "open" });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background/95 flex-shrink-0">
        <span className="text-xs text-muted-foreground font-medium">Filter:</span>

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
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs text-muted-foreground gap-0.5 ml-1" onClick={clearFilters}>
            <X className="h-3 w-3" /> Clear
          </Button>
        )}

        {hasFilters && (
          <span className="ml-auto text-2xs text-muted-foreground">
            {filteredItems.length} of {baseItems.length} items
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 flex-1 overflow-x-auto p-3 pb-2 items-start">
        {COLUMNS.map((col) => {
          const colItems = filteredItems.filter((i) => (i.stage as string) === col.key);
          const isOver = dragOverCol === col.key;
          const totalTasks = colItems.reduce((sum, i) => sum + (tasksByItem[i.id]?.length || 0), 0);

          return (
            <div
              key={col.key}
              className={`flex flex-col rounded-xl border-t-2 border border-border bg-muted/30 min-w-[290px] max-w-[340px] flex-1 transition-colors ${col.accent.header} ${isOver ? `ring-2 ${col.accent.ring}` : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => handleDrop(col.key)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3.5 py-3 border-b border-border/50 bg-background/60 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-full ${col.accent.badge}`}>
                    {colItems.length}
                  </span>
                </div>
                {totalTasks > 0 && (
                  <span className="text-2xs text-muted-foreground/70">
                    {allTasks.filter(t => colItems.some(i => i.id === t.checklist_item_id) && t.status === "done").length}/{totalTasks} tasks
                  </span>
                )}
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2.5 p-2.5 flex-1 overflow-y-auto">
                {colItems.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    teamLabel={teamLabels[item.ownerTeam] || item.ownerTeam}
                    tasks={tasksByItem[item.id] || []}
                    meetings={meetingsByItem[item.id] || []}
                    projectId={project.id}
                    projectName={project.merchantName}
                    onDragStart={setDraggingId}
                    onToggleTask={handleToggleTask}
                  />
                ))}
                {colItems.length === 0 && (
                  <div className="flex items-center justify-center text-xs text-muted-foreground/40 italic py-8">
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
