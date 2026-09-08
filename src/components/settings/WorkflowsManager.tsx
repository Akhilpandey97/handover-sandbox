import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAiWorkflows, useToggleWorkflow, useDeleteWorkflow, useUpdateWorkflow, AiWorkflow } from "@/hooks/useAiWorkflows";
import { Zap, Trash2, Clock, GitBranch, Activity, MousePointerClick, Pencil, Loader2 } from "lucide-react";
import { format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  time_based: Clock,
  field_change: GitBranch,
  event: Activity,
  manual: MousePointerClick,
};

const TRIGGER_LABELS: Record<string, string> = {
  time_based: "Time-Based",
  field_change: "Field Change",
  event: "Event",
  manual: "Manual",
};

const ACTION_LABELS: Record<string, string> = {
  assign_owner: "Assign Owner",
  update_field: "Update Field",
  send_notification: "Send Notification",
  transfer_project: "Transfer Project",
};

export const WorkflowsManager = () => {
  const { data: workflows = [], isLoading } = useAiWorkflows();
  const toggleMutation = useToggleWorkflow();
  const deleteMutation = useDeleteWorkflow();
  const updateMutation = useUpdateWorkflow();
  const [editingWorkflow, setEditingWorkflow] = useState<AiWorkflow | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />AI Workflows & Rules
          </CardTitle>
          <CardDescription>
            Automated workflows created by AI. Use the chatbot to create new workflows by saying things like
            "Create a workflow to assign owner when project is blocked for 24 hours".
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium mb-1">No workflows yet</p>
              <p className="text-sm">
                Ask the AI chatbot to create workflows. Try: "Create a rule to auto-assign owners based on project category"
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => (
                <WorkflowRow
                  key={wf.id}
                  workflow={wf}
                  onToggle={(active) => toggleMutation.mutate({ id: wf.id, is_active: active })}
                  onDelete={() => deleteMutation.mutate(wf.id)}
                  onEdit={() => setEditingWorkflow(wf)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingWorkflow && (
        <EditWorkflowDialog
          workflow={editingWorkflow}
          open={!!editingWorkflow}
          onOpenChange={(open) => { if (!open) setEditingWorkflow(null); }}
          onSave={(updates) => {
            updateMutation.mutate({ id: editingWorkflow.id, updates }, {
              onSuccess: () => setEditingWorkflow(null),
            });
          }}
          isSaving={updateMutation.isPending}
        />
      )}
    </>
  );
};

const WorkflowRow = ({
  workflow, onToggle, onDelete, onEdit,
}: {
  workflow: AiWorkflow;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
  onEdit: () => void;
}) => {
  const TriggerIcon = TRIGGER_ICONS[workflow.trigger_type] || Activity;

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <TriggerIcon className="h-4 w-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm truncate">{workflow.name}</span>
          <Badge variant={workflow.is_active ? "default" : "secondary"} className="text-micro">
            {workflow.is_active ? "Active" : "Paused"}
          </Badge>
        </div>
        {workflow.description && (
          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{workflow.description}</p>
        )}
        <div className="flex flex-wrap gap-2 text-micro text-muted-foreground">
          <span className="flex items-center gap-1">
            <TriggerIcon className="h-3 w-3" />
            {TRIGGER_LABELS[workflow.trigger_type] || workflow.trigger_type}
          </span>
          <span>→</span>
          <span>{ACTION_LABELS[workflow.action_type] || workflow.action_type}</span>
          {workflow.trigger_count > 0 && (
            <span className="ml-2">• Triggered {workflow.trigger_count}×</span>
          )}
          {workflow.created_by_name && (
            <span className="ml-2">• By {workflow.created_by_name}</span>
          )}
          <span className="ml-2">• {format(new Date(workflow.created_at), "dd MMM yyyy")}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Switch checked={workflow.is_active} onCheckedChange={onToggle} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{workflow.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

const EditWorkflowDialog = ({
  workflow, open, onOpenChange, onSave, isSaving,
}: {
  workflow: AiWorkflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: Partial<AiWorkflow>) => void;
  isSaving: boolean;
}) => {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description || "");
  const [triggerType, setTriggerType] = useState(workflow.trigger_type);
  const [actionType, setActionType] = useState(workflow.action_type);
  const [isActive, setIsActive] = useState(workflow.is_active);
  const [triggerConfigStr, setTriggerConfigStr] = useState(JSON.stringify(workflow.trigger_config, null, 2));
  const [actionConfigStr, setActionConfigStr] = useState(JSON.stringify(workflow.action_config, null, 2));
  const [configError, setConfigError] = useState("");

  const handleSave = () => {
    setConfigError("");
    let trigger_config: any, action_config: any;
    try {
      trigger_config = JSON.parse(triggerConfigStr);
    } catch {
      setConfigError("Trigger config is not valid JSON");
      return;
    }
    try {
      action_config = JSON.parse(actionConfigStr);
    } catch {
      setConfigError("Action config is not valid JSON");
      return;
    }
    onSave({ name, description: description || null, trigger_type: triggerType, action_type: actionType, is_active: isActive, trigger_config, action_config });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Workflow</DialogTitle>
          <DialogDescription>Modify the workflow settings below.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Trigger Type</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="time_based">Time-Based</SelectItem>
                  <SelectItem value="field_change">Field Change</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Action Type</Label>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="assign_owner">Assign Owner</SelectItem>
                  <SelectItem value="update_field">Update Field</SelectItem>
                  <SelectItem value="send_notification">Send Notification</SelectItem>
                  <SelectItem value="transfer_project">Transfer Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Trigger Config (JSON)</Label>
            <Textarea value={triggerConfigStr} onChange={(e) => setTriggerConfigStr(e.target.value)} rows={4} className="font-mono text-xs" />
          </div>

          <div className="space-y-1.5">
            <Label>Action Config (JSON)</Label>
            <Textarea value={actionConfigStr} onChange={(e) => setActionConfigStr(e.target.value)} rows={4} className="font-mono text-xs" />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>{isActive ? "Active" : "Paused"}</Label>
          </div>

          {configError && <p className="text-sm text-destructive">{configError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
