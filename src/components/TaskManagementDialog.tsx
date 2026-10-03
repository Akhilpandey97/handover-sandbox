import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAddChecklistTask } from "@/hooks/useChecklistTasks";
import { ListTodo } from "lucide-react";

interface TaskManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistItemId: string;
  checklistItemTitle: string;
  projectId: string;
  projectName?: string;
  profiles?: { id: string; name: string }[];
}

/**
 * Adding a task, and nothing else.
 *
 * The tasks themselves are listed against their checklist item, so repeating them here
 * only asked which of the two lists was the real one.
 */
export const TaskManagementDialog = ({
  open,
  onOpenChange,
  checklistItemId,
  checklistItemTitle,
  projectId,
  projectName,
  profiles = [],
}: TaskManagementDialogProps) => {
  const addTask = useAddChecklistTask();

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssignedTo, setNewAssignedTo] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  // A reopened dialog starts empty, not on the last thing typed.
  useEffect(() => {
    if (open) {
      setNewTitle("");
      setNewDescription("");
      setNewAssignedTo("");
      setNewDueDate("");
    }
  }, [open]);

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
        assigned_to: newAssignedTo || undefined,
        due_date: newDueDate || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            Add task
          </DialogTitle>
          <p className="truncate text-xs text-muted-foreground">{checklistItemTitle}</p>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Task title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleAdd();
            }}
            className="h-9"
            autoFocus
          />
          <Textarea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="min-h-[60px] resize-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            {profiles.length > 0 && (
              <Select value={newAssignedTo} onValueChange={setNewAssignedTo}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="Assign to..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
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
              <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={handleAdd}
                disabled={!newTitle.trim() || addTask.isPending}
              >
                {addTask.isPending ? "Adding..." : "Add Task"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
