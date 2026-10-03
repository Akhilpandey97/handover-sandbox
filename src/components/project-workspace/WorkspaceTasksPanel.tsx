import { useMemo, useState } from "react";
import { Project } from "@/data/projectsData";
import { useChecklistTasks, useUpdateChecklistTask } from "@/hooks/useChecklistTasks";
import { useProfilesLookup } from "@/hooks/useLookups";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Calendar, ListTodo, Plus } from "lucide-react";
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
  in_progress: "bg-info-soft text-info-strong",
  done: "bg-success-soft text-success-strong",
};

/**
 * Every task on the project in one place, grouped by the checklist step it belongs to.
 *
 * The same rows as the checklist tab shows inline, so a task reads the same in both;
 * what this adds is the whole picture, and a filter for the only question people ask of
 * it — what is still open.
 */
export const WorkspaceTasksPanel = ({ project }: { project: Project }) => {
  const { data: tasks = [], isLoading } = useChecklistTasks(project.id);
  const { profiles } = useProfilesLookup();
  const updateTask = useUpdateChecklistTask();
  const [showDone, setShowDone] = useState(true);
  const [dialog, setDialog] = useState<{ checklistItemId: string; checklistItemTitle: string } | null>(null);

  const itemTitle = useMemo(() => {
    const map = new Map<string, string>();
    project.checklist.forEach((item) => map.set(item.id, item.title));
    return map;
  }, [project.checklist]);

  const visible = showDone ? tasks : tasks.filter((t) => t.status !== "done");
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading tasks…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
        <span className="text-xs text-muted-foreground">
          {doneCount} of {tasks.length} done
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? "Hide completed" : "Show completed"}
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-6 text-center">
          <ListTodo className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No tasks yet. Add one from a checklist step to break it into smaller pieces.
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every task is done.</p>
      ) : (
        /* One table, so every task lines up under the same columns; the checklist
           step stays as a band across it rather than a table of its own. */
        <div className="overflow-hidden rounded-lg border border-border/60">
          {/* Fixed layout: the columns keep their share of the width instead of the
              title absorbing every spare pixel and stranding the rest at the edge. */}
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5" aria-label="Done" />
                <th scope="col" className="w-[40%] px-3 py-2.5 text-left font-medium">Task</th>
                <th scope="col" className="w-[22%] px-3 py-2.5 text-left font-medium">Assignee</th>
                <th scope="col" className="w-[20%] px-3 py-2.5 text-left font-medium">Due</th>
                <th scope="col" className="w-[18%] px-3 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            {grouped.map(([checklistItemId, list]) => (
              <tbody key={checklistItemId} className="border-b border-border last:border-b-0">
                <tr className="bg-muted/20">
                  <td colSpan={5} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {itemTitle.get(checklistItemId) || "Other"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {list.length} task{list.length === 1 ? "" : "s"}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        <span className="font-medium text-success-strong">
                          {list.filter((t) => t.status === "done").length} done
                        </span>
                        {` · ${list.filter((t) => t.status !== "done").length} open`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs"
                        onClick={() =>
                          setDialog({
                            checklistItemId,
                            checklistItemTitle: itemTitle.get(checklistItemId) || "Checklist step",
                          })
                        }
                      >
                        <Plus className="h-3 w-3" />
                        Add task
                      </Button>
                    </div>
                  </td>
                </tr>
                {list.map((task) => {
                  const overdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                  return (
                    <tr
                      key={task.id}
                      id={`task-${task.id}`}
                      className="border-t border-border/40 align-middle transition-colors hover:bg-muted/30"
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <Checkbox
                          checked={task.status === "done"}
                          onCheckedChange={(checked) =>
                            updateTask.mutate({ id: task.id, status: checked ? "done" : "open" })
                          }
                          aria-label={`Mark "${task.title}" as ${task.status === "done" ? "not done" : "done"}`}
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
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                              {initials(profiles.find((p) => p.id === task.assigned_to)?.name || "?")}
                            </span>
                            <span className="truncate text-sm">
                              {profiles.find((p) => p.id === task.assigned_to)?.name || "Assigned"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-xs">
                        {task.due_date ? (
                          <span
                            className={cn(
                              "flex items-center gap-1",
                              overdue ? "font-medium text-destructive" : "text-muted-foreground",
                            )}
                          >
                            <Calendar className="h-3 w-3 shrink-0" />
                            {shortDate(task.due_date)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium",
                            STATUS_TONE[task.status] || STATUS_TONE.open,
                          )}
                        >
                          {STATUS_LABEL[task.status] || task.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

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
