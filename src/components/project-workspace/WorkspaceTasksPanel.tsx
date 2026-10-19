import { useMemo, useState } from "react";
import { Project } from "@/data/projectsData";
import { useChecklistTasks, useUpdateChecklistTask } from "@/hooks/useChecklistTasks";
import { useProfilesLookup } from "@/hooks/useLookups";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, ChevronDown, ListTodo, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

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
  const [showDone, setShowDone] = useState(true);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ checklistItemId: string; checklistItemTitle: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
              <Input
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? "Hide done" : "Show done"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <ListTodo className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No tasks yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Add tasks from checklist steps to break work into smaller pieces
            </p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">All tasks completed</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-background">
              <tr className="border-b border-border/50">
                <th className="w-10 px-4 py-2 text-left text-xs font-medium text-muted-foreground" />
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Task</th>
                <th className="w-36 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Assignee</th>
                <th className="w-28 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Due date</th>
                <th className="w-24 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            {grouped.map(([checklistItemId, list]) => {
              const isCollapsed = collapsedGroups.has(checklistItemId);
              const groupDone = list.filter((t) => t.status === "done").length;
              return (
                <tbody key={checklistItemId}>
                  <tr
                    className="border-b border-border/30 cursor-pointer hover:bg-muted/20"
                    onClick={() => toggleGroup(checklistItemId)}
                  >
                    <td colSpan={5} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                        <span className="text-sm font-semibold text-foreground">
                          {itemTitle.get(checklistItemId) || "Other"}
                        </span>
                        <span className="text-xs text-muted-foreground">{groupDone}/{list.length} done</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 gap-1 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDialog({ checklistItemId, checklistItemTitle: itemTitle.get(checklistItemId) || "Checklist step" });
                          }}
                        >
                          <Plus className="h-3 w-3" />Add
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed && list.map((task) => {
                    const overdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                    return (
                      <tr
                        key={task.id}
                        id={`task-${task.id}`}
                        className="border-b border-border/20 transition-colors hover:bg-muted/10"
                      >
                        <td className="px-4 py-2.5 align-middle">
                          <Checkbox
                            checked={task.status === "done"}
                            onCheckedChange={(checked) =>
                              updateTask.mutate({ id: task.id, status: checked ? "done" : "open" })
                            }
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span
                            className={cn(
                              "block truncate",
                              task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                            )}
                            title={task.title}
                          >
                            {task.title}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {task.assigned_to ? (
                            <div className="flex items-center gap-1.5">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                                {initials(profiles.find((p) => p.id === task.assigned_to)?.name || "?")}
                              </span>
                              <span className="truncate text-xs">{profiles.find((p) => p.id === task.assigned_to)?.name || "Assigned"}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {task.due_date ? (
                            <span className={cn("flex items-center gap-1 text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                              <Calendar className="h-3 w-3 shrink-0" />
                              {shortDate(task.due_date)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[task.status] || STATUS_TONE.open)}>
                            {STATUS_LABEL[task.status] || task.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        )}
      </ScrollArea>

      {dialog && (
        <TaskManagementDialog
          open={true}
          onOpenChange={(open) => !open && setDialog(null)}
          checklistItemId={dialog.checklistItemId}
          checklistItemTitle={dialog.checklistItemTitle}
          projectId={project.id}
        />
      )}
    </div>
  );
};
