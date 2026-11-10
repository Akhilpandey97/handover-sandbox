import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAddChecklistTask, useUpdateChecklistTask } from "@/hooks/useChecklistTasks";
import { Globe, ListTodo } from "lucide-react";

interface ExistingTask {
  id: string;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  assigned_to_ext?: string | null;
  due_date?: string | null;
  is_client_visible?: boolean | null;
}

interface TaskManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected checklist item. Leave empty when showing the item picker. */
  checklistItemId?: string;
  checklistItemTitle?: string;
  projectId: string;
  projectName?: string;
  profiles?: { id: string; name: string }[];
  /** When provided and checklistItemId is not set, shows an item picker. */
  checklistItems?: { id: string; title: string }[];
  /** Pass an existing task to open in edit mode instead of add mode. */
  task?: ExistingTask;
}

export const TaskManagementDialog = ({
  open,
  onOpenChange,
  checklistItemId: checklistItemIdProp = "",
  checklistItemTitle: checklistItemTitleProp = "",
  projectId,
  projectName,
  profiles = [],
  checklistItems,
  task,
}: TaskManagementDialogProps) => {
  const addTask = useAddChecklistTask();
  const updateTask = useUpdateChecklistTask();

  const isEditMode = Boolean(task);
  const showItemPicker = !checklistItemIdProp && !isEditMode && !!checklistItems?.length;

  const [selectedItemId, setSelectedItemId] = useState("");
  const checklistItemId = checklistItemIdProp || selectedItemId;
  const checklistItemTitle =
    checklistItemTitleProp ||
    checklistItems?.find((i) => i.id === selectedItemId)?.title ||
    "";

  const [newTitle, setNewTitle] = useState(task?.title ?? "");
  const [newDescription, setNewDescription] = useState(task?.description ?? "");
  const [newAssignedTo, setNewAssignedTo] = useState(task?.assigned_to ?? "");
  const [newAssignedToExt, setNewAssignedToExt] = useState(task?.assigned_to_ext ?? "");
  const [newDueDate, setNewDueDate] = useState(task?.due_date ?? "");
  const [isClientVisible, setIsClientVisible] = useState(task?.is_client_visible ?? false);

  useEffect(() => {
    if (open) {
      setNewTitle(task?.title ?? "");
      setNewDescription(task?.description ?? "");
      setNewAssignedTo(task?.assigned_to ?? "");
      setNewAssignedToExt(task?.assigned_to_ext ?? "");
      setNewDueDate(task?.due_date ?? "");
      setIsClientVisible(task?.is_client_visible ?? false);
      setSelectedItemId("");
    }
  }, [open, task]);

  const handleSave = () => {
    if (!newTitle.trim()) return;
    if (!checklistItemId) return;
    if (isEditMode && task) {
      updateTask.mutate(
        {
          id: task.id,
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          assigned_to: newAssignedTo || undefined,
          assigned_to_ext: newAssignedToExt.trim() || undefined,
          due_date: newDueDate || undefined,
          is_client_visible: isClientVisible,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      addTask.mutate(
        {
          checklist_item_id: checklistItemId,
          project_id: projectId,
          project_name: projectName,
          checklist_item_title: checklistItemTitle,
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          assigned_to: newAssignedTo || undefined,
          assigned_to_ext: newAssignedToExt.trim() || undefined,
          due_date: newDueDate || undefined,
          is_client_visible: isClientVisible,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            {isEditMode ? "Edit task" : "Add task"}
          </DialogTitle>
          {checklistItemTitle && (
            <p className="truncate text-xs text-muted-foreground">{checklistItemTitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-3">
          {showItemPicker && (
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select checklist item…" />
              </SelectTrigger>
              <SelectContent>
                {checklistItems!.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="text-xs">
                    {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            placeholder="Task title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleSave();
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

          {/* Assignees row */}
          <div className="flex flex-wrap items-center gap-2">
            {profiles.length > 0 && (
              <Select value={newAssignedTo} onValueChange={setNewAssignedTo}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="Internal assignee..." />
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
            {/* §12.2 Merchant contact (assigned_to_ext) */}
            <Input
              placeholder="Merchant contact (optional)"
              value={newAssignedToExt}
              onChange={(e) => setNewAssignedToExt(e.target.value)}
              className="h-8 flex-1 min-w-[140px] text-xs"
            />
          </div>

          {/* Due date + client-visible row */}
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            {/* §12.5 Client-visible flag */}
            <div className="flex items-center gap-1.5 ml-auto">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <Label htmlFor="client-visible" className="text-xs text-muted-foreground cursor-pointer">
                Customer visible
              </Label>
              <Switch
                id="client-visible"
                checked={isClientVisible}
                onCheckedChange={setIsClientVisible}
                className="scale-75"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={handleSave}
              disabled={!newTitle.trim() || !checklistItemId || addTask.isPending || updateTask.isPending}
            >
              {isEditMode
                ? (updateTask.isPending ? "Saving..." : "Save")
                : (addTask.isPending ? "Adding..." : "Add Task")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
