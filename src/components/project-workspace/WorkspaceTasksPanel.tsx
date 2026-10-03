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
        grouped.map(([checklistItemId, list]) => (
          <section key={checklistItemId} className="rounded-lg border border-border/60 bg-muted/20 p-2">
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {itemTitle.get(checklistItemId) || "Other"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 gap-1 px-2 text-xs"
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

            <div className="space-y-1">
              {list.map((task) => {
                const overdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/30"
                  >
                    <Checkbox
                      checked={task.status === "done"}
                      onCheckedChange={(checked) =>
                        updateTask.mutate({ id: task.id, status: checked ? "done" : "open" })
                      }
                      aria-label={`Mark "${task.title}" as ${task.status === "done" ? "not done" : "done"}`}
                      className="h-4 w-4 shrink-0"
                    />
                    <span
                      className={cn(
                        "flex-1 truncate text-sm",
                        task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                      )}
                    >
                      {task.title}
                    </span>
                    {task.assigned_to && (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {profiles.find((p) => p.id === task.assigned_to)?.name || "Assigned"}
                      </span>
                    )}
                    {task.due_date && (
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-0.5 text-2xs",
                          overdue ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        <Calendar className="h-2.5 w-2.5" />
                        {shortDate(task.due_date)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
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
