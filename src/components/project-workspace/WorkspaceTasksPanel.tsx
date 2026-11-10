import { useMemo, useState, useRef } from "react";
import { Project } from "@/data/projectsData";
import { useChecklistTasks, useUpdateChecklistTask, useDeleteChecklistTask, ChecklistTask } from "@/hooks/useChecklistTasks";
import { useAddChecklistComment } from "@/hooks/useChecklistComments";
import { useProfilesLookup } from "@/hooks/useLookups";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, ChevronDown, Clock, Globe, ListTodo, MessageSquare, Pencil, Plus, Search, Send, Trash2, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-muted text-muted-foreground",
  in_progress: "bg-info/10 text-info-strong",
  done: "bg-success/15 text-success-strong",
};

export const WorkspaceTasksPanel = ({ project }: { project: Project }) => {
  const { data: tasks = [], isLoading } = useChecklistTasks(project.id);
  const { profiles } = useProfilesLookup();
  const updateTask = useUpdateChecklistTask();
  const deleteTask = useDeleteChecklistTask();
  const addComment = useAddChecklistComment();

  const [showDone, setShowDone] = useState(true);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{
    checklistItemId: string;
    checklistItemTitle: string;
    task?: ChecklistTask;
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  // Track which task is awaiting a completion comment { taskId, itemId }
  const [completingTask, setCompletingTask] = useState<{ taskId: string; itemId: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const itemTitle = useMemo(() => {
    const map = new Map<string, string>();
    project.checklist.forEach((item) => map.set(item.id, item.title));
    return map;
  }, [project.checklist]);

  const visible = useMemo(() => {
    let result = showDone ? tasks : tasks.filter((t) => t.status !== "done");
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q));
    }
    return result;
  }, [tasks, showDone, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof tasks>();
    visible.forEach((task) => {
      const list = groups.get(task.checklist_item_id) || [];
      list.push(task);
      groups.set(task.checklist_item_id, list);
    });
    return [...groups.entries()];
  }, [visible]);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const openCount = tasks.length - doneCount;

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCheck = (task: ChecklistTask, checked: boolean) => {
    updateTask.mutate({ id: task.id, status: checked ? "done" : "open" });
    if (checked) {
      setCompletingTask({ taskId: task.id, itemId: task.checklist_item_id });
      setCommentText("");
      setTimeout(() => commentRef.current?.focus(), 50);
    } else {
      if (completingTask?.taskId === task.id) setCompletingTask(null);
    }
  };

  const submitComment = () => {
    if (!completingTask || !commentText.trim()) {
      setCompletingTask(null);
      return;
    }
    addComment.mutate(
      { checklistItemId: completingTask.itemId, checklistTaskId: completingTask.taskId, comment: commentText.trim() },
      { onSuccess: () => { setCompletingTask(null); setCommentText(""); } },
    );
  };

  const COLS = 10; // total column count

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-border/50 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{tasks.length} total</span>
              <span className="rounded-full bg-success/15 px-2 py-0.5 font-medium text-success-strong">{doneCount} done</span>
              {openCount > 0 && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning-strong">{openCount} open</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-48 pl-8 text-xs" />
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddTaskOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add task
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide done" : "Show done"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-muted-foreground">Loading tasks…</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <ListTodo className="mb-3 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No tasks yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Add tasks from checklist steps to break work into smaller pieces</p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-muted-foreground">All tasks completed</p>
            </div>
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-background">
                <tr className="border-b border-border/50">
                  <th className="w-10 px-4 py-2" />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Task</th>
                  <th className="w-36 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Task owner</th>
                  <th className="w-32 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Merchant contact</th>
                  <th className="w-26 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Start date</th>
                  <th className="w-26 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Due date</th>
                  <th className="w-20 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Est. hrs</th>
                  <th className="w-24 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="w-16 px-3 py-2 text-center text-xs font-medium text-muted-foreground"><span title="Customer visible"><Globe className="h-3.5 w-3.5 mx-auto text-muted-foreground" /></span></th>
                  <th className="w-16 px-3 py-2" />
                </tr>
              </thead>
              {grouped.map(([checklistItemId, list]) => {
                const isCollapsed = collapsedGroups.has(checklistItemId);
                const groupDone = list.filter((t) => t.status === "done").length;
                return (
                  <tbody key={checklistItemId}>
                    <tr className="border-b border-border/30 cursor-pointer hover:bg-muted/20" onClick={() => toggleGroup(checklistItemId)}>
                      <td colSpan={COLS} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                          <span className="text-sm font-semibold text-foreground">{itemTitle.get(checklistItemId) || "Other"}</span>
                          <span className="text-xs text-muted-foreground">{groupDone}/{list.length} done</span>
                          <Button
                            variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); setDialog({ checklistItemId, checklistItemTitle: itemTitle.get(checklistItemId) || "Checklist step" }); }}
                          >
                            <Plus className="h-3 w-3" /> Add
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && list.map((task) => {
                      const overdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                      const owner = profiles.find((p) => p.id === task.assigned_to);
                      const isCompleting = completingTask?.taskId === task.id;
                      return (
                        <>
                          <tr key={task.id} id={`task-${task.id}`} className="group border-b border-border/20 transition-colors hover:bg-muted/10">
                            {/* Checkbox */}
                            <td className="px-4 py-2.5 align-middle">
                              <Checkbox
                                checked={task.status === "done"}
                                onCheckedChange={(checked) => handleCheck(task, !!checked)}
                                className="h-4 w-4"
                              />
                            </td>
                            {/* Task title + description */}
                            <td className="px-3 py-2.5 align-middle">
                              <span className={cn("block truncate font-medium", task.status === "done" ? "text-muted-foreground line-through" : "text-foreground")} title={task.title}>
                                {task.title}
                              </span>
                              {task.description && (
                                <span className="block truncate text-2xs text-muted-foreground/70 mt-0.5" title={task.description}>{task.description}</span>
                              )}
                            </td>
                            {/* Task owner */}
                            <td className="px-3 py-2.5 align-middle">
                              {owner ? (
                                <div className="flex items-center gap-1.5">
                                  <UserAvatar name={owner.name} avatarUrl={owner.avatar_url} size="xs" />
                                  <span className="truncate text-xs">{owner.name}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/40">—</span>
                              )}
                            </td>
                            {/* Merchant contact */}
                            <td className="px-3 py-2.5 align-middle">
                              <span className="text-xs text-muted-foreground truncate block max-w-[7rem]" title={task.assigned_to_ext || ""}>
                                {task.assigned_to_ext || <span className="text-muted-foreground/40">—</span>}
                              </span>
                            </td>
                            {/* Start date */}
                            <td className="px-3 py-2.5 align-middle">
                              {task.start_date ? (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Calendar className="h-3 w-3 shrink-0" />{shortDate(task.start_date)}
                                </span>
                              ) : <span className="text-xs text-muted-foreground/40">—</span>}
                            </td>
                            {/* Due date */}
                            <td className="px-3 py-2.5 align-middle">
                              {task.due_date ? (
                                <span className={cn("flex items-center gap-1 text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                                  <Calendar className="h-3 w-3 shrink-0" />{shortDate(task.due_date)}
                                </span>
                              ) : <span className="text-xs text-muted-foreground/40">—</span>}
                            </td>
                            {/* Est. hours */}
                            <td className="px-3 py-2.5 align-middle">
                              {task.estimated_hours ? (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Timer className="h-3 w-3 shrink-0" />{task.estimated_hours}h
                                </span>
                              ) : <span className="text-xs text-muted-foreground/40">—</span>}
                            </td>
                            {/* Status */}
                            <td className="px-3 py-2.5 align-middle">
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[task.status] || STATUS_TONE.open)}>
                                {STATUS_LABEL[task.status] || task.status}
                              </span>
                            </td>
                            {/* Customer visible */}
                            <td className="px-3 py-2.5 align-middle text-center">
                              {task.is_client_visible
                                ? <span title="Visible to customer"><Globe className="h-3.5 w-3.5 text-primary mx-auto" /></span>
                                : <span className="text-xs text-muted-foreground/40">—</span>}
                            </td>
                            {/* Actions */}
                            <td className="px-3 py-2.5 align-middle">
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button" title="Add comment"
                                  onClick={() => { setCompletingTask({ taskId: task.id, itemId: task.checklist_item_id }); setCommentText(""); setTimeout(() => commentRef.current?.focus(), 50); }}
                                  className="text-muted-foreground/40 hover:text-primary transition-colors"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button" title="Edit task"
                                  onClick={() => setDialog({ checklistItemId: task.checklist_item_id, checklistItemTitle: itemTitle.get(task.checklist_item_id) || "Task", task })}
                                  className="text-muted-foreground/40 hover:text-primary transition-colors"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button" title="Delete task"
                                  onClick={() => deleteTask.mutate(task.id)}
                                  className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Inline comment row — appears when task is marked done or comment icon clicked */}
                          {isCompleting && (
                            <tr key={`comment-${task.id}`} className="border-b border-border/20 bg-muted/10">
                              <td />
                              <td colSpan={COLS - 1} className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/50 mt-2 shrink-0" />
                                  <Textarea
                                    ref={commentRef}
                                    placeholder="Add a completion comment… (optional)"
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment(); if (e.key === "Escape") setCompletingTask(null); }}
                                    className="min-h-[40px] text-xs flex-1 resize-none"
                                    rows={1}
                                  />
                                  <div className="flex gap-1 shrink-0">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCompletingTask(null)}>Skip</Button>
                                    <Button size="sm" className="h-7 px-2 text-xs gap-1" onClick={submitComment} disabled={!commentText.trim() || addComment.isPending}>
                                      <Send className="h-3 w-3" /> Send
                                    </Button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          )}
        </div>
      </ScrollArea>

      {dialog && (
        <TaskManagementDialog
          open={true}
          onOpenChange={(open) => !open && setDialog(null)}
          checklistItemId={dialog.checklistItemId}
          checklistItemTitle={dialog.checklistItemTitle}
          projectId={project.id}
          profiles={profiles}
          task={dialog.task}
        />
      )}

      <TaskManagementDialog
        open={addTaskOpen}
        onOpenChange={setAddTaskOpen}
        projectId={project.id}
        projectName={project.merchantName}
        profiles={profiles}
        checklistItems={project.checklist.filter((i) => !i.isTask).map((i) => ({ id: i.id, title: i.title }))}
      />
    </div>
  );
};
