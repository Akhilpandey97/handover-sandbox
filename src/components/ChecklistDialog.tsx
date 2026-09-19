import { useMemo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Project, calculateTimeByParty, formatDuration, ResponsibilityParty } from "@/data/projectsData";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectDeepLink } from "@/hooks/useProjectDeepLink";
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
import { Progress } from "@/components/ui/progress";

/** One date format across the checklist: "9 Sep 2026", not the browser's locale guess. */
const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChecklistCommentThread } from "@/components/ChecklistCommentThread";
import { ChecklistFormDialog } from "@/components/ChecklistFormDialog";
import { TaskManagementDialog } from "@/components/TaskManagementDialog";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { useChecklistTasks, useAddChecklistTask, useUpdateChecklistTask, useDeleteChecklistTask } from "@/hooks/useChecklistTasks";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { CheckCircle2, ClipboardList, Building2, Users, Minus, FileText, ListTodo, Plus, ChevronDown, ChevronRight, Trash2, Calendar, Flag, Video } from "lucide-react";

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5">
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

  // A ?task= link opens that item's task dialog once the checklist has loaded.
  const deepLink = useProjectDeepLink();
  const openedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLink.task || !deepLink.item || !project) return;
    if (openedTaskRef.current === deepLink.task) return;
    const item = project.checklist.find((i) => i.id === deepLink.item);
    if (!item) return;
    openedTaskRef.current = deepLink.task;
    setTaskDialogState({ open: true, checklistItemId: item.id, checklistItemTitle: item.title });
  }, [deepLink.task, deepLink.item, project]);

  // Inline sub-task add form state: which checklist item has the form open
  const [inlineAddFormId, setInlineAddFormId] = useState<string | null>(null);
  const [openResponsibilityFor, setOpenResponsibilityFor] = useState<string | null>(null);
  const [newSubTaskTitle, setNewSubTaskTitle] = useState("");
  const [newSubTaskPriority, setNewSubTaskPriority] = useState("medium");
  const [newSubTaskAssignee, setNewSubTaskAssignee] = useState("");
  const [newSubTaskDueDate, setNewSubTaskDueDate] = useState("");
  // Track which checklist items have expanded sub-tasks
  const [expandedSubTasks, setExpandedSubTasks] = useState<Set<string>>(new Set());

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
  const completedCount = checklist.filter((c) => c.completed).length;
  const totalCount = checklist.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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

  const toggleExpandSubTasks = (itemId: string) => {
    setExpandedSubTasks(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleAddSubTask = (checklistItemId: string) => {
    if (!newSubTaskTitle.trim() || !project) return;
    const checklistItem = project.checklist.find((item) => item.id === checklistItemId);
    addTaskMutation.mutate({
      checklist_item_id: checklistItemId,
      project_id: project.id,
      project_name: project.merchantName,
      checklist_item_title: checklistItem?.title,
      title: newSubTaskTitle.trim(),
      priority: newSubTaskPriority,
      assigned_to: newSubTaskAssignee || undefined,
      due_date: newSubTaskDueDate || undefined,
    }, {
      onSuccess: () => {
        setNewSubTaskTitle("");
        setNewSubTaskPriority("medium");
        setNewSubTaskAssignee("");
        setNewSubTaskDueDate("");
        setInlineAddFormId(null);
        // Auto-expand
        setExpandedSubTasks(prev => new Set(prev).add(checklistItemId));
      }
    });
  };

  const priorityColors: Record<string, string> = {
    low: "text-success-strong bg-success/10",
    medium: "text-warning-strong bg-warning/10",
    high: "text-destructive-strong bg-destructive/10",
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


        {/* Progress, once: the sections below carry their own counts. */}
        <div className="space-y-2 py-1">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{completedCount} of {totalCount}</span> done
            </p>
            {completedCount < totalCount && (
              <p className="text-xs text-muted-foreground">{totalCount - completedCount} left</p>
            )}
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-8">
            {orderedTeams.map((team) => {
              const items = groupedByTeam[team];
              const isUserTeam = team === userTeam || userTeam === "manager";
              const teamCount = teamCounts[team];
              const teamProgress = teamCount ? Math.round((teamCount.completed / teamCount.total) * 100) : 0;
              
              // All checklist items (no more is_task separation)
              const checklistItems = items.filter(i => !i.isTask);
              
              return (
                <div key={team} className={!isUserTeam ? "opacity-60" : ""}>
                  {/* Team Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div 
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: getTeamColor(team) }}
                      >
                        {getTeamLabel(team).charAt(0)}
                      </div>
                      <div>
                        <h3 className="heading-card">{getTeamLabel(team)}</h3>
                        <p className="text-xs text-muted-foreground">{teamCount?.completed}/{teamCount?.total} items</p>
                      </div>
                    </div>
                    {isUserTeam && <span className="text-xs text-muted-foreground">Your team</span>}
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
                           className={`scroll-mt-24 border-b border-border/70 px-1 py-3 transition-colors last:border-b-0 hover:bg-muted/30 ${item.completed ? "bg-success/[0.04]" : ""}`}
                        >
                          <div className="flex items-start gap-4">
                            {/* The checkbox is the control; completion is not spelled out three more ways. */}
                            <div className="flex flex-col items-center gap-1 pt-0.5">
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
                                 <span className={`font-medium ${item.completed ? "text-muted-foreground" : ""}`}>
                                  {item.title}
                                </span>
                                {item.completed && (
                                  <CheckCircle2 className="h-4 w-4 text-success-strong shrink-0" />
                                )}
                                {/* Form button */}
                                {(() => {
                                  const templateId = checklistTemplatesByTitle[item.title];
                                  const formInfo = templateId ? formsByChecklistTemplateId.get(templateId) : undefined;
                                  if (!formInfo) return null;
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 px-2 text-xs gap-1"
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
                                      className="h-6 px-2 text-xs gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <ListTodo className="h-3 w-3" />
                                      Tasks{taskCount > 0 && ` (${openTaskCount}/${taskCount})`}
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
                                      className="h-6 px-2 text-xs gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMeetingDialogState({
                                          open: true,
                                          checklistItemId: item.id,
                                          checklistItemTitle: item.title,
                                        });
                                      }}
                                    >
                                      <Video className="h-3 w-3" />
                                      Meetings
                                      {itemMeetings.length > 0 && ` (${upcoming}/${itemMeetings.length})`}
                                    </Button>
                                  );
                                })()}
                              </div>

                                                            {/* One meta line: due, who finished it, and the time split only when there is some. */}
                              {(() => {
                                const overdue = item.dueDate && !item.completed && new Date(item.dueDate) < new Date();
                                const parts: React.ReactNode[] = [];
                                if (item.dueDate) {
                                  parts.push(
                                    <span key="due" className={overdue ? "font-medium text-destructive" : undefined}>
                                      Due {shortDate(item.dueDate)}{overdue ? " · overdue" : ""}
                                    </span>,
                                  );
                                }
                                if (item.completedBy) {
                                  parts.push(
                                    <span key="by">Done{item.completedAt ? ` ${shortDate(item.completedAt)}` : ""} by {item.completedBy}</span>,
                                  );
                                }
                                if (timeStats.gokwik > 0 || timeStats.merchant > 0) {
                                  parts.push(
                                    <span key="time">
                                      {responsibilityLabels.gokwik} {formatDuration(timeStats.gokwik)} · {responsibilityLabels.merchant} {formatDuration(timeStats.merchant)}
                                    </span>,
                                  );
                                }
                                return (
                                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    {parts.map((part, i) => (
                                      <span key={i} className="flex items-center gap-2">
                                        {i > 0 && <span aria-hidden="true">·</span>}
                                        {part}
                                      </span>
                                    ))}
                                    {canEdit && !item.completed && (
                                      <Input
                                        type="date"
                                        defaultValue={item.dueDate || ""}
                                        aria-label="Due date"
                                        className="h-6 w-32 px-1 text-xs"
                                        onChange={async (e) => {
                                          const newDate = e.target.value || null;
                                          await supabase.from("checklist_items").update({ due_date: newDate }).eq("id", item.id);
                                          queryClient.invalidateQueries({ queryKey: ["projects"] });
                                        }}
                                      />
                                    )}
                                  </div>
                                );
                              })()}

{/* Comment Thread */}
                              <ChecklistCommentThread
                                checklistItemId={item.id}
                                checklistItemTitle={item.title}
                                projectId={project.id}
                                projectName={project.merchantName}
                              />
                            </div>

                            {/* Who it is waiting on: the value, until you click it. Completed rows show nothing. */}
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {item.completed ? null : openResponsibilityFor === item.id ? (
                                <ToggleGroup
                                  type="single"
                                  value={item.currentResponsibility}
                                  onValueChange={(value) => {
                                    handleResponsibilityChange(item.id, value);
                                    setOpenResponsibilityFor(null);
                                  }}
                                  className="gap-0 overflow-hidden rounded-lg border"
                                >
                                  <ToggleGroupItem
                                    value="gokwik"
                                    aria-label={responsibilityLabels.gokwik}
                                    className="h-7 rounded-none px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-white"
                                  >
                                    {responsibilityLabels.gokwik}
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="neutral"
                                    aria-label={responsibilityLabels.neutral}
                                    className="h-7 rounded-none border-x px-2.5 text-xs data-[state=on]:bg-muted"
                                  >
                                    <Minus className="h-3 w-3" />
                                  </ToggleGroupItem>
                                  <ToggleGroupItem
                                    value="merchant"
                                    aria-label={responsibilityLabels.merchant}
                                    className="h-7 rounded-none px-2.5 text-xs data-[state=on]:bg-warning data-[state=on]:text-warning-foreground"
                                  >
                                    {responsibilityLabels.merchant}
                                  </ToggleGroupItem>
                                </ToggleGroup>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => setOpenResponsibilityFor(item.id)}
                                  title="Change who this is waiting on"
                                  className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none"
                                >
                                  {item.currentResponsibility === "neutral"
                                    ? "Waiting on no one"
                                    : `Waiting on ${responsibilityLabels[item.currentResponsibility] || item.currentResponsibility}`}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Inline Sub-tasks Section */}
                          {(() => {
                            const itemTasks = allTasks.filter(t => t.checklist_item_id === item.id);
                            const hasSubTasks = itemTasks.length > 0;
                            const isExpanded = expandedSubTasks.has(item.id) || hasSubTasks;
                            const isAddFormOpen = inlineAddFormId === item.id;

                            return (
                              <div className="mt-3 border-t border-border/50 pt-3">
                                <Collapsible open={isExpanded} onOpenChange={() => toggleExpandSubTasks(item.id)}>
                                  <div className="flex items-center justify-between mb-2">
                                    <CollapsibleTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground">
                                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                        Sub-tasks {hasSubTasks && `(${itemTasks.filter(t => t.status === "done").length}/${itemTasks.length})`}
                                      </Button>
                                    </CollapsibleTrigger>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs gap-1 text-primary hover:text-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setInlineAddFormId(isAddFormOpen ? null : item.id);
                                        setNewSubTaskTitle("");
                                        setNewSubTaskPriority("medium");
                                        setNewSubTaskAssignee("");
                                        setNewSubTaskDueDate("");
                                        if (!isExpanded) setExpandedSubTasks(prev => new Set(prev).add(item.id));
                                      }}
                                    >
                                      <Plus className="h-3 w-3" />
                                      Sub-task
                                    </Button>
                                  </div>

                                  <CollapsibleContent>
                                    <div className="space-y-1.5 ml-2">
                                      {itemTasks.map(task => (
                                        <div key={task.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/30 hover:bg-muted/50 group transition-colors">
                                          <Checkbox
                                            checked={task.status === "done"}
                                            onCheckedChange={(checked) => {
                                              updateTaskMutation.mutate({
                                                id: task.id,
                                                status: checked ? "done" : "open",
                                              });
                                            }}
                                            className="h-4 w-4"
                                          />
                                          <span className={`flex-1 text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                                            {task.title}
                                          </span>
                                          <Badge variant="outline" className={`text-2xs px-1.5 py-0 ${priorityColors[task.priority] || ""}`}>
                                            <Flag className="h-2.5 w-2.5 mr-0.5" />
                                            {task.priority}
                                          </Badge>
                                          {task.assigned_to && (
                                            <span className="text-2xs text-muted-foreground">
                                              {profiles.find(p => p.id === task.assigned_to)?.name || task.assigned_to}
                                            </span>
                                          )}
                                          {task.due_date && (
                                            <span className="text-2xs text-muted-foreground flex items-center gap-0.5">
                                              <Calendar className="h-2.5 w-2.5" />
                                              {shortDate(task.due_date)}
                                            </span>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                                            onClick={() => deleteTaskMutation.mutate(task.id)}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ))}

                                      {/* Inline Add Form */}
                                      {isAddFormOpen && (
                                        <div className="flex flex-wrap items-center gap-2 py-2 px-2 rounded-md border border-dashed border-primary/30 bg-primary/5">
                                          <Input
                                            placeholder="Sub-task title..."
                                            value={newSubTaskTitle}
                                            onChange={(e) => setNewSubTaskTitle(e.target.value)}
                                            className="h-7 text-sm flex-1 min-w-[150px]"
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") handleAddSubTask(item.id);
                                              if (e.key === "Escape") setInlineAddFormId(null);
                                            }}
                                            autoFocus
                                          />
                                          <Select value={newSubTaskPriority} onValueChange={setNewSubTaskPriority}>
                                            <SelectTrigger className="h-7 w-24 text-xs">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="low">Low</SelectItem>
                                              <SelectItem value="medium">Medium</SelectItem>
                                              <SelectItem value="high">High</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          <Select value={newSubTaskAssignee} onValueChange={setNewSubTaskAssignee}>
                                            <SelectTrigger className="h-7 w-28 text-xs">
                                              <SelectValue placeholder="Assign..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {profiles.map(p => (
                                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                          <Input
                                            type="date"
                                            value={newSubTaskDueDate}
                                            onChange={(e) => setNewSubTaskDueDate(e.target.value)}
                                            className="h-7 w-32 text-xs"
                                          />
                                          <Button
                                            size="sm"
                                            className="h-7 px-3 text-xs"
                                            onClick={() => handleAddSubTask(item.id)}
                                            disabled={!newSubTaskTitle.trim() || addTaskMutation.isPending}
                                          >
                                            Save
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                            onClick={() => setInlineAddFormId(null)}
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              </div>
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
