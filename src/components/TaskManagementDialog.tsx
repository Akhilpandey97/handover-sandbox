import { useState } from "react";
import { useProjectDeepLink, useScrollToAnchor } from "@/hooks/useProjectDeepLink";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useChecklistTasksByItem,
  useAddChecklistTask,
  useUpdateChecklistTask,
  useDeleteChecklistTask,
  ChecklistTask,
} from "@/hooks/useChecklistTasks";
import { ListTodo, Plus, Trash2, CalendarDays, Flag, User } from "lucide-react";

interface TaskManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistItemId: string;
  checklistItemTitle: string;
  projectId: string;
  projectName?: string;
  profiles?: { id: string; name: string }[];
}

const priorityConfig = {
  low: { label: "Low", color: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  high: { label: "High", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const statusConfig = {
  open: { label: "Open", color: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  done: { label: "Done", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export const TaskManagementDialog = ({
  open,
  onOpenChange,
  checklistItemId,
  checklistItemTitle,
  projectId,
  projectName,
  profiles = [],
}: TaskManagementDialogProps) => {
  const { data: tasks = [], isLoading } = useChecklistTasksByItem(checklistItemId);

  // Highlight the task a ?task= link points at, once the dialog has its rows.
  const deepLink = useProjectDeepLink();
  useScrollToAnchor(deepLink.task ? `task-${deepLink.task}` : null, open && !isLoading);

  const addTask = useAddChecklistTask();
  const updateTask = useUpdateChecklistTask();
  const deleteTask = useDeleteChecklistTask();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newAssignedTo, setNewAssignedTo] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addTask.mutate(
      {
        checklist_item_id: checklistItemId,
        project_id: projectId,
        project_name: projectName,
        checklist_item_title: checklistItemTitle,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        priority: newPriority,
        assigned_to: newAssignedTo || undefined,
        due_date: newDueDate || undefined,
      },
      {
        onSuccess: () => {
          setNewTitle("");
          setNewDescription("");
          setNewPriority("medium");
          setNewAssignedTo("");
          setNewDueDate("");
          setShowAddForm(false);
        },
      }
    );
  };

  const handleStatusToggle = (task: ChecklistTask) => {
    const nextStatus = task.status === "done" ? "open" : task.status === "open" ? "in_progress" : "done";
    updateTask.mutate({ id: task.id, status: nextStatus });
  };

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lift">
              <ListTodo className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg">Tasks</span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5 max-w-md truncate">
                {checklistItemTitle}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {openCount > 0 && (
                <Badge variant="outline" className="text-xs">{openCount} open</Badge>
              )}
              {doneCount > 0 && (
                <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700">
                  {doneCount} done
                </Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-2">
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading tasks...</p>}
            {!isLoading && tasks.length === 0 && !showAddForm && (
              <div className="text-center py-12 text-muted-foreground">
                <ListTodo className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No tasks yet</p>
                <p className="text-xs mt-1">Add tasks to track work for this checklist item</p>
              </div>
            )}

            {tasks.map((task) => {
              const sc = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.open;
              const pc = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.medium;
              const assignedProfile = profiles.find((p) => p.id === task.assigned_to);

              return (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  className={`p-3 rounded-lg border transition-all ${
                    task.status === "done"
                      ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-800 opacity-70"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={task.status === "done"}
                      onCheckedChange={() => handleStatusToggle(task)}
                      className="mt-0.5 h-5 w-5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                          {task.title}
                        </span>
                        <Badge className={`text-micro px-1.5 py-0 ${pc.color} border-0`}>
                          <Flag className="h-2.5 w-2.5 mr-0.5" />
                          {pc.label}
                        </Badge>
                        <Badge className={`text-micro px-1.5 py-0 ${sc.color} border-0`}>{sc.label}</Badge>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {assignedProfile && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {assignedProfile.name}
                          </span>
                        )}
                        {task.due_date && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {new Date(task.due_date).toLocaleDateString()}
                          </span>
                        )}
                        {task.created_by && <span>by {task.created_by}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Select
                        value={task.status}
                        onValueChange={(v) => updateTask.mutate({ id: task.id, status: v as any })}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteTask.mutate(task.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Add Task Form */}
        {showAddForm ? (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <Input
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-9"
              autoFocus
            />
            <Textarea
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="min-h-[60px] resize-none"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              {profiles.length > 0 && (
                <Select value={newAssignedTo} onValueChange={setNewAssignedTo}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="Assign to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-8" onClick={handleAdd} disabled={!newTitle.trim() || addTask.isPending}>
                  {addTask.isPending ? "Adding..." : "Add Task"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setShowAddForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};
