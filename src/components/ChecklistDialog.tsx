import { useMemo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Project, calculateTimeByParty, formatDuration, ResponsibilityParty } from "@/data/projectsData";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectDeepLink, useScrollToAnchor } from "@/hooks/useProjectDeepLink";
import { useLabels } from "@/contexts/LabelsContext";
import { useFormAssignments, useFormTemplates } from "@/hooks/useChecklistForms";
import { useTeams } from "@/hooks/useTeams";
import { useProfilesLookup, useChecklistTemplateTitles } from "@/hooks/useLookups";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One date format across the checklist: "9 Sep 2026", not the browser's locale guess. */
const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChecklistCommentThread } from "@/components/ChecklistCommentThread";
import { ChecklistFormDialog } from "@/components/ChecklistFormDialog";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { ChecklistItemMeetings } from "@/components/ChecklistItemMeetings";
import { useChecklistTasks, useAddChecklistTask, useUpdateChecklistTask, useDeleteChecklistTask } from "@/hooks/useChecklistTasks";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { CheckCircle2, ClipboardList, Minus, FileText, ListTodo, Trash2, Calendar, Video, Building2, Users, Plus } from "lucide-react";

interface ChecklistDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "dialog" | "inline";
}

/**
 * Must stay at module scope. Declared inside the component it would be a new
 * component type on every render, so React would unmount and remount the whole
 * checklist — losing scroll position each time an item is ticked.
 */
const Shell = ({
  variant,
  open,
  onOpenChange,
  children,
}: {
  variant: "dialog" | "inline";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) =>
  variant === "inline" ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card p-4">
      {children}
    </div>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] h-[95vh] max-h-[95vh] flex flex-col overflow-hidden">
        {children}
      </DialogContent>
    </Dialog>
  );

export const ChecklistDialog = ({
  project,
  open,
  onOpenChange,
  variant = "dialog",
}: ChecklistDialogProps) => {
  const { updateChecklist, toggleChecklistResponsibility } = useProjects();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { teamLabels, responsibilityLabels } = useLabels();
  const { assignments } = useFormAssignments();
  const { templates: formTemplates } = useFormTemplates();
  const { allTeams, teamLabelMap, teamColorMap, checklistTeamSlugs } = useTeams();
  const { data: allTasks = [] } = useChecklistTasks(project?.id);
  const { data: allMeetings = [] } = useChecklistMeetings(project?.id);
  const addTaskMutation = useAddChecklistTask();
  const updateTaskMutation = useUpdateChecklistTask();
  const deleteTaskMutation = useDeleteChecklistTask();

  // Task dialog state
  const [taskDialogState, setTaskDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
  } | null>(null);

  // Meeting dialog state
  const [meetingDialogState, setMeetingDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
  } | null>(null);

  // A ?task= link goes to the task where it lives — on its checklist step — and
  // rings it. It used to open the add-task dialog, which answered a question
  // nobody had asked and hid the step the task belongs to.
  const deepLink = useProjectDeepLink();
  useScrollToAnchor(deepLink.task ? `task-${deepLink.task}` : null, !!project);

  // After a task is ticked, the toast can open that step's comment box.
  const [commentPrompt, setCommentPrompt] = useState<{ itemId: string; at: number } | null>(null);

  // Profiles for task assignment (cached lookup)
  const { profiles } = useProfilesLookup();


  // Form dialog state
  const [formDialogState, setFormDialogState] = useState<{
    open: boolean;
    checklistItemId: string;
    checklistItemTitle: string;
    formTemplateId: string;
    formTemplateName: string;
  } | null>(null);

  // Build lookup: checklist_template_id -> form info
  const formsByChecklistTemplateId = useMemo(() => {
    const map = new Map<string, { formTemplateId: string; formTemplateName: string }>();
    assignments.forEach(a => {
      const ft = formTemplates.find(t => t.id === a.form_template_id);
      if (ft) map.set(a.checklist_template_id, { formTemplateId: ft.id, formTemplateName: ft.name });
    });
    return map;
  }, [assignments, formTemplates]);

  // Get team label - use LabelsContext for system teams, teamLabelMap for custom
  const getTeamLabel = (slug: string) => {
    if (teamLabels[slug as keyof typeof teamLabels]) return teamLabels[slug as keyof typeof teamLabels];
    return teamLabelMap[slug] || slug;
  };

  const getTeamColor = (slug: string) => {
    return teamColorMap[slug] || "#6b7280";
  };

  // Cached checklist template title -> id map for form assignment matching
  const { titlesToId: checklistTemplatesByTitle } = useChecklistTemplateTitles();


  const checklist = project?.checklist || [];

  // Check if all current team's checklist items are completed for transfer unlock notification
  const currentTeamChecklist = project ? checklist.filter(c => c.ownerTeam === project.currentOwnerTeam) : [];
  const allCurrentTeamDone = currentTeamChecklist.length > 0 && currentTeamChecklist.every(c => c.completed);
  const prevAllDoneRef = useRef(allCurrentTeamDone);

  useEffect(() => {
    if (allCurrentTeamDone && !prevAllDoneRef.current && open) {
      toast.success("🎉 All tasks complete! Transfer is now unlocked.", {
        duration: 5000,
        description: "You can now transfer this project to the next team.",
      });
    }
    prevAllDoneRef.current = allCurrentTeamDone;
  }, [allCurrentTeamDone, open]);

  if (!project || !currentUser) return null;

  // Group checklist by owner team
  const groupedByTeam = project.checklist.reduce((acc, item) => {
    const team = (item.ownerTeam || "").toLowerCase();
    if (!acc[team]) acc[team] = [];
    acc[team].push(item);
    return acc;
  }, {} as Record<string, typeof project.checklist>);

  // Normalize current user's team for comparison
  const userTeam = (currentUser.team || "").toLowerCase();
  // Managers, tenant admins and super admins can work across every team
  const hasFullChecklistAccess = ["manager", "admin", "super_admin", "superadmin"].includes(userTeam);

  // Build ordered teams: user's team first, then system teams, then custom teams
  const systemSlugs = ["mint", "integration", "ms"];
  const allSlugsInChecklist = Object.keys(groupedByTeam);
  
  // User's team first
  const orderedTeams: string[] = [];
  if (userTeam && allSlugsInChecklist.includes(userTeam) && !hasFullChecklistAccess) {
    orderedTeams.push(userTeam);
  }

  // System teams
  systemSlugs.forEach(s => {
    if (allSlugsInChecklist.includes(s) && !orderedTeams.includes(s)) {
      orderedTeams.push(s);
    }
  });
  // Custom teams
  allSlugsInChecklist.forEach(s => {
    if (!orderedTeams.includes(s) && !systemSlugs.includes(s)) {
      orderedTeams.push(s);
    }
  });
  // Managers/admins see all teams
  if (hasFullChecklistAccess && orderedTeams.length === 0) {

    systemSlugs.forEach(s => {
      if (allSlugsInChecklist.includes(s)) orderedTeams.push(s);
    });
    allSlugsInChecklist.forEach(s => {
      if (!orderedTeams.includes(s)) orderedTeams.push(s);
    });
  }

  // Calculate counts per team
  const teamCounts = Object.entries(groupedByTeam).reduce((acc, [team, items]) => {
    acc[team] = {
      completed: items.filter(i => i.completed).length,
      total: items.length,
    };
    return acc;
  }, {} as Record<string, { completed: number; total: number }>);

  const canEditChecklistItem = (ownerTeam: string) => {
    if (hasFullChecklistAccess) return true;
    return userTeam === (ownerTeam || "").toLowerCase();
  };



  const handleResponsibilityChange = (checklistId: string, newParty: string) => {
    if (newParty && (newParty === "gokwik" || newParty === "merchant" || newParty === "neutral")) {
      toggleChecklistResponsibility(project.id, checklistId, newParty as ResponsibilityParty);
    }
  };

  return (
    <Shell variant={variant} open={open} onOpenChange={onOpenChange}>

        {variant === "dialog" && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
                <ClipboardList className="h-6 w-6 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <span className="text-xl">Project Checklist</span>
                <p className="text-sm font-normal text-muted-foreground mt-0.5">
                  {project.merchantName}
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>
        )}


        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-6">
            {orderedTeams.map((team) => {
              const items = groupedByTeam[team];
              // Dimming has to follow the same rule as editing, or a section an
              // admin can fully edit reads as locked. "Your team" stays literal.
              const isOwnTeam = team === userTeam;
              const canEditSection = hasFullChecklistAccess || isOwnTeam;
              const teamCount = teamCounts[team];
              
              // All checklist items (no more is_task separation)
              const checklistItems = items.filter(i => !i.isTask);
              
              return (
                <div key={team} className={canEditSection ? "" : "opacity-60"}>
                  {/* Team Header */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getTeamColor(team) }} aria-hidden="true" />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{getTeamLabel(team)}</h3>
                        <p className="text-xs text-muted-foreground">{teamCount?.completed} of {teamCount?.total} done</p>
                      </div>
                    </div>
                    {isOwnTeam && <span className="text-xs text-muted-foreground">Your team</span>}
                  </div>

                  {/* Checklist Items */}
                  <div className="space-y-3 pl-2 ml-4">
                    {checklistItems.map((item, index) => {
                      const timeStats = calculateTimeByParty(item.responsibilityLog);
                      const itemTeam = (item.ownerTeam || "").toLowerCase();
                      const canEdit = canEditChecklistItem(itemTeam);
                      
                      return (
                        <div
                          key={item.id}
                          id={`checklist-item-${item.id}`}
                          className={`p-4 rounded-xl border transition-all scroll-mt-24 ${
                            item.completed
                              ? "bg-success/5 border-success/30"
                              : "bg-card border-border hover:border-primary/30 hover:shadow-md"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            {/* Step number, then the checkbox that actually completes the step. */}
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant="outline" className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-mono p-0">
                                {index + 1}
                              </Badge>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div>
                                      <Checkbox
                                        checked={item.completed}
                                        onCheckedChange={(checked) => {
                                          if (canEdit) {
                                            updateChecklist(project.id, item.id, checked as boolean);
                                          }
                                        }}
                                        disabled={!canEdit}
                                        className="h-5 w-5"
                                      />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {!canEdit 
                                      ? "Only team members can complete this" 
                                      : item.completed 
                                        ? "Click to mark as incomplete" 
                                        : "Click to mark as complete"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                                  {item.title}
                                </span>
                                {item.completed && (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />
                                )}
                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                {/* Form button */}
                                {(() => {
                                  const templateId = checklistTemplatesByTitle[item.title];
                                  const formInfo = templateId ? formsByChecklistTemplateId.get(templateId) : undefined;
                                  if (!formInfo) return null;
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFormDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                          formTemplateId: formInfo.formTemplateId,
                                          formTemplateName: formInfo.formTemplateName,
                                        });
                                      }}
                                    >
                                      <FileText className="h-3 w-3" />
                                      {formInfo.formTemplateName}
                                    </Button>
                                  );
                                })()}
                                {/* Tasks button */}
                                {(() => {
                                  const taskCount = allTasks.filter(t => t.checklist_item_id === item.id).length;
                                  const openTaskCount = allTasks.filter(t => t.checklist_item_id === item.id && t.status !== "done").length;
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Task{taskCount > 0 ? ` (${openTaskCount}/${taskCount})` : ""}
                                    </Button>
                                  );
                                })()}
                                {/* Meetings button */}
                                {(() => {
                                  const itemMeetings = allMeetings.filter(m => m.checklist_item_id === item.id);
                                  const upcoming = itemMeetings.filter(
                                    m => m.status === "scheduled" && new Date(m.scheduled_at) >= new Date(),
                                  ).length;
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMeetingDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Meeting{itemMeetings.length > 0 ? ` (${upcoming}/${itemMeetings.length})` : ""}
                                    </Button>
                                  );
                                })()}
                                </div>
                              </div>

                              {/* Due date */}
                              {(item.dueDate || (canEdit && !item.completed)) && (
                                <div className="flex items-center gap-2 mb-2">
                                  <Calendar className="h-3 w-3 text-muted-foreground" />
                                  {item.dueDate ? (
                                    <span className={`text-xs ${!item.completed && new Date(item.dueDate) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                      Due: {shortDate(item.dueDate)}
                                      {!item.completed && new Date(item.dueDate) < new Date() && " (Overdue)"}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">No due date</span>
                                  )}
                                  {canEdit && !item.completed && (
                                    <Input
                                      type="date"
                                      defaultValue={item.dueDate || ""}
                                      aria-label="Due date"
                                      className="h-6 w-32 text-xs px-1"
                                      onChange={async (e) => {
                                        const newDate = e.target.value || null;
                                        await supabase.from("checklist_items").update({ due_date: newDate }).eq("id", item.id);
                                        queryClient.invalidateQueries({ queryKey: ["projects"] });
                                      }}
                                    />
                                  )}
                                </div>
                              )}

                              {item.completedBy && (
                                <p className="text-xs text-muted-foreground mb-2">
                                  ✓ Completed by {item.completedBy}
                                  {item.completedAt && ` on ${shortDate(item.completedAt)}`}
                                </p>
                              )}

                              {/* Time Stats */}
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3 text-primary" />
                                  <span>{responsibilityLabels.gokwik}: {formatDuration(timeStats.gokwik)}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Users className="h-3 w-3 text-warning-strong" />
                                  <span>{responsibilityLabels.merchant}: {formatDuration(timeStats.merchant)}</span>
                                </div>
                              </div>

                              {/* Comment Thread */}
                              <ChecklistCommentThread
                                checklistItemId={item.id}
                                checklistItemTitle={item.title}
                                projectId={project.id}
                                projectName={project.merchantName}
                                focusSignal={commentPrompt?.itemId === item.id ? commentPrompt.at : undefined}
                              />
                            </div>

                            {/* Who it is waiting on — the control says it, so no label above it. */}
                            <div className="flex shrink-0 items-center gap-2">
                              <ToggleGroup
                                type="single"
                                value={item.currentResponsibility}
                                onValueChange={(value) => handleResponsibilityChange(item.id, value)}
                                disabled={item.completed || !canEdit}
                                className="gap-0 border rounded-lg overflow-hidden"
                              >
                                <ToggleGroupItem
                                  value="gokwik"
                                  aria-label={responsibilityLabels.gokwik}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-primary data-[state=on]:text-white"
                                >
                                  <Building2 className="h-3 w-3 mr-1" />
                                  {responsibilityLabels.gokwik}
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="neutral"
                                  aria-label={responsibilityLabels.neutral}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none border-x data-[state=on]:bg-muted"
                                >
                                  <Minus className="h-3 w-3" />
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="merchant"
                                  aria-label={responsibilityLabels.merchant}
                                  className="text-xs px-3 py-1.5 h-8 rounded-none data-[state=on]:bg-warning data-[state=on]:text-warning-foreground"
                                >
                                  <Users className="h-3 w-3 mr-1" />
                                  {responsibilityLabels.merchant}
                                </ToggleGroupItem>
                              </ToggleGroup>
                            </div>
                          </div>

                          {/* Inline sub-tasks and meetings, side by side */}
                          {(() => {
                            const itemTasks = allTasks.filter(t => t.checklist_item_id === item.id);
                            const itemMeetings = allMeetings.filter(m => m.checklist_item_id === item.id);
                            const hasSubTasks = itemTasks.length > 0 || itemMeetings.length > 0;

                            return (
                              // The box shows only when the step has something under it.
                              // Everything else is reachable from the row above.
                              !hasSubTasks ? null : (
                                <div className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 md:grid-cols-2">
                                  <div className="min-w-0">
                                  {/* Sub-tasks belong to the step above; say so, and say how many are left. */}
                                  <div className="mb-1.5 flex items-center gap-2 px-1">
                                    <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Tasks
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {itemTasks.filter(t => t.status === "done").length} of {itemTasks.length} done
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="ml-auto h-6 gap-1 px-2 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Add task
                                    </Button>
                                  </div>

                                  <div className="space-y-1">
                                    {itemTasks.map(task => {
                                      const overdue =
                                        task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();
                                      return (
                                        <div
                                          key={task.id}
                                          id={`task-${task.id}`}
                                          className="group flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/30"
                                        >
                                          <Checkbox
                                            checked={task.status === "done"}
                                            onCheckedChange={(checked) => {
                                              updateTaskMutation.mutate({
                                                id: task.id,
                                                status: checked ? "done" : "open",
                                              });
                                              // Finishing something is when people have something to say about it.
                                              if (checked) {
                                                toast.success(`Completed "${task.title}"`, {
                                                  action: {
                                                    label: "Add comment",
                                                    onClick: () => setCommentPrompt({ itemId: item.id, at: Date.now() }),
                                                  },
                                                });
                                              }
                                            }}
                                            aria-label={`Mark "${task.title}" as ${task.status === "done" ? "not done" : "done"}`}
                                            className="h-4 w-4 shrink-0"
                                          />
                                          <span className={`flex-1 truncate text-sm ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                            {task.title}
                                          </span>
                                          {task.assigned_to && (
                                            <span className="shrink-0 text-2xs text-muted-foreground">
                                              {profiles.find(p => p.id === task.assigned_to)?.name || task.assigned_to}
                                            </span>
                                          )}
                                          {task.due_date && (
                                            <span className={`flex shrink-0 items-center gap-0.5 text-2xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                                              <Calendar className="h-2.5 w-2.5" />
                                              {shortDate(task.due_date)}
                                            </span>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Delete task "${task.title}"`}
                                            className="h-5 w-5 shrink-0 p-0 text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                            onClick={() => deleteTaskMutation.mutate(task.id)}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  </div>

                                  {/* Meetings for the same step, with the minutes they produced. */}
                                  <div className="min-w-0 md:border-l md:border-border/60 md:pl-2">
                                    <div className="mb-1.5 flex items-center gap-2 px-1">
                                      <Video className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Meetings
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {itemMeetings.length}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="ml-auto h-6 gap-1 px-2 text-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMeetingDialogState({
                                            open: true,
                                            checklistItemId: item.id,
                                            checklistItemTitle: item.title,
                                          });
                                        }}
                                      >
                                        <Plus className="h-3 w-3" />
                                        Schedule
                                      </Button>
                                    </div>
                                    {itemMeetings.length === 0 ? (
                                      <p className="px-1 py-2 text-xs text-muted-foreground">
                                        No meetings for this step yet.
                                      </p>
                                    ) : (
                                      <ChecklistItemMeetings meetings={itemMeetings} />
                                    )}
                                  </div>
                                </div>
                              )
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Checklist Form Dialog */}
        {formDialogState && project && (
          <ChecklistFormDialog
            open={formDialogState.open}
            onOpenChange={(open) => {
              if (!open) setFormDialogState(null);
            }}
            projectId={project.id}
            projectName={project.merchantName}
            checklistItemId={formDialogState.checklistItemId}
            checklistItemTitle={formDialogState.checklistItemTitle}
            formTemplateId={formDialogState.formTemplateId}
            formTemplateName={formDialogState.formTemplateName}
          />
        )}

        {/* Task Management Dialog */}
        {taskDialogState && project && (
          <TaskManagementDialog
            open={taskDialogState.open}
            onOpenChange={(open) => {
              if (!open) setTaskDialogState(null);
            }}
            checklistItemId={taskDialogState.checklistItemId}
            checklistItemTitle={taskDialogState.checklistItemTitle}
            projectId={project.id}
            profiles={profiles}
          />
        )}

        {/* Meeting Scheduler Dialog */}
        {meetingDialogState && project && (
          <MeetingSchedulerDialog
            open={meetingDialogState.open}
            onOpenChange={(open) => {
              if (!open) setMeetingDialogState(null);
            }}
            checklistItemId={meetingDialogState.checklistItemId}
            checklistItemTitle={meetingDialogState.checklistItemTitle}
            projectId={project.id}
            projectName={project.merchantName}
          />
        )}
    </Shell>
  );
};
