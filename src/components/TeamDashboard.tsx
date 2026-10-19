import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleDashed,
  Eye,
  FolderKanban,
  GripVertical,
  List,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Rocket,
  Search,
  Settings,
  UserCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { type Project, type ProjectState, type FunnelStage, getProjectFunnelStage, projectStateLabels, funnelStageLabels } from "@/data/projectsData";
import { getActiveFunnelStages } from "@/data/funnelConfig";
import { formatGoLiveDate } from "./GoLiveDate";
import { arrToCrore } from "@/lib/arr";
import { cn, greeting } from "@/lib/utils";
import { parseDashboardPath, projectViewPath } from "@/lib/dashboard-routes";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { useDashletOrder } from "@/hooks/useDashletOrder";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openProjectInNewTab } from "@/lib/open-project";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RiskBadge } from "./RiskBadge";

import { NotificationCenter } from "./NotificationCenter";
import { BuddyAvatar } from "./buddy/BuddyAvatar";
import { ThemeToggle } from "./ThemeToggle";
import { KanbanBoard } from "./KanbanBoard";
import { MonthlyGoLiveTracker } from "./MonthlyGoLiveTracker";
import { AiChatBot } from "./AiChatBot";
import { ProjectListDialog } from "./ProjectListDialog";
import { RejectTransferDialog } from "./RejectTransferDialog";
import { DashletBuilder } from "./DashletBuilder";
import { CustomFieldDashlet } from "./CustomFieldDashlet";
import { TATDashlet } from "./TATDashlet";
import { AttentionRequiredDashlet } from "./AttentionRequiredDashlet";
import { EglRiskDashlet } from "./EglRiskDashlet";
import { DashletSlot } from "./DashletSlot";
import { KpiBar, type KpiBoxItem } from "./KpiBar";
import { GlobalSearch } from "@/components/GlobalSearch";

type UserTab = "dashboard" | "projects" | "hi-there";

export const TeamDashboard = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeState = useMemo(() => parseDashboardPath(pathname), [pathname]);
  const { currentUser, logout } = useAuth();
  const { projects, isLoading, acceptProject, rejectProject } = useProjects();
  const { labels, getLabel, teamLabels, stateLabels } = useLabels();
  const { verdicts } = useProjectRiskVerdicts();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectToolbarHost, setProjectToolbarHost] = useState<HTMLDivElement | null>(null);
  const [drillDown, setDrillDown] = useState<{ title: string; description?: string; projects: Project[] } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Project | null>(null);
  const {
    order: dashletOrder,
    visibleOrder,
    hidden,
    toggleHidden,
    custom: customDashlets,
    addCustom,
    removeCustom,
    dragging,
    onDragStart,
    onDragOver,
    onDragEnd,
  } = useDashletOrder(["kpi", "incoming", "tat", "attention", "egl", "stages", "health"], "user_dashboard_dashlet_order");

  // ── List view state ──────────────────────────────────────────────
  const LIST_VIEW_COLUMNS = [
    { key: "merchantName", label: getLabel("field_merchant_name") },
    { key: "mid", label: getLabel("field_mid") },
    { key: "platform", label: getLabel("field_platform") },
    { key: "category", label: getLabel("field_category") },
    { key: "status", label: "Status" },
    { key: "projectStage", label: getLabel("field_project_stage") },
    { key: "arr", label: getLabel("field_arr") },
    { key: "expectedGoLiveDate", label: getLabel("field_expected_go_live_date") },
    { key: "kickOffDate", label: getLabel("field_kick_off_date") },
    { key: "goLiveDate", label: getLabel("field_go_live_date") },
    { key: "integrationType", label: getLabel("field_integration_type") },
    { key: "goLivePercent", label: getLabel("field_go_live_percent") },
    { key: "mintNotes", label: getLabel("field_mint_notes") },
    { key: "projectNotes", label: getLabel("field_project_notes") },
  ];
  const SORTABLE_LIST_KEYS = new Set(["merchantName", "arr", "platform", "kickOffDate", "status", "expectedGoLiveDate"]);
  const [listViewColumns, setListViewColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("user_listview_columns");
      return saved ? (JSON.parse(saved) as string[]).filter((c) => c !== "needsAttention") : ["merchantName", "platform", "status", "projectStage", "expectedGoLiveDate", "arr"];
    } catch { return ["merchantName", "platform", "status", "projectStage", "expectedGoLiveDate", "arr"]; }
  });
  const [listSortField, setListSortField] = useState<string>("none");
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");
  const toggleListSort = (key: string) => {
    if (listSortField === key) setListSortDir(d => d === "asc" ? "desc" : "asc");
    else { setListSortField(key); setListSortDir("asc"); }
  };
  const [listViewPage, setListViewPage] = useState(1);
  const [listViewPageSize, setListViewPageSize] = useState(25);
  const [lvNeedsAttentionOnly, setLvNeedsAttentionOnly] = useState(false);
  const [lvStateFilter, setLvStateFilter] = useState<string[]>([]);
  const [lvFunnelStageFilter, setLvFunnelStageFilter] = useState<string[]>([]);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const handleColDragStart = (col: string) => setDraggedCol(col);
  const handleColDragOver = (targetCol: string) => {
    if (!draggedCol || draggedCol === targetCol) return;
    setListViewColumns((prev: string[]) => {
      const newCols = [...prev];
      const fromIdx = newCols.indexOf(draggedCol);
      if (fromIdx < 0) return prev;
      newCols.splice(fromIdx, 1);
      const toIdx = newCols.indexOf(targetCol);
      newCols.splice(toIdx, 0, draggedCol);
      return newCols;
    });
  };
  const handleColDragEnd = (cols: string[]) => {
    setDraggedCol(null);
    localStorage.setItem("user_listview_columns", JSON.stringify(cols));
  };
  const toggleFilterValue = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const userProjects = useMemo(
    () => projects.filter((project) => project.assignedOwner === currentUser?.id && !project.archived),
    [projects, currentUser?.id],
  );
  const matchesSearch = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (project: Project) =>
      !query ||
      project.merchantName.toLowerCase().includes(query) ||
      project.mid.toLowerCase().includes(query);
  }, [searchQuery]);

  /**
   * A handover is not yours until you accept it. Everything on this screen — the
   * KPIs, the dashlets, Projects — works from the accepted ones; the one place an
   * incoming project appears is the dashlet that asks you to decide.
   */
  const visibleProjects = useMemo(
    () => userProjects.filter((project) => !project.pendingAcceptance && matchesSearch(project)),
    [userProjects, matchesSearch],
  );
  const incomingProjects = useMemo(
    () => userProjects.filter((project) => project.pendingAcceptance && matchesSearch(project)),
    [userProjects, matchesSearch],
  );

  useEffect(() => {
    // Everyone starts in Buddy.
    if (pathname === "/") navigate({ to: "/hi-there", replace: true });
  }, [pathname, navigate]);

  if (!currentUser) return null;
  const totalProjects = visibleProjects.length;
  
  const deliveryProjects = visibleProjects.filter((project) => project.projectState === "in_progress");
  const liveProjects = visibleProjects.filter((project) => project.projectState === "live");
  const arrLabel = getLabel("field_arr");

  const resolvedTab: UserTab = routeState.tab === "projects" || routeState.tab === "hi-there"
    ? routeState.tab
    : "dashboard";
  const projectView = routeState.projectView === "golive" ? "golive" : routeState.projectView === "list" ? "list" : "kanban";
  const navItems: Array<{ key: UserTab; label: string; icon: React.ReactNode }> = [
    { key: "hi-there", label: "Buddy", icon: <BuddyAvatar size={16} /> },
    { key: "dashboard", label: "Workbench", icon: <BarChart3 className="h-4 w-4" /> },
    { key: "projects", label: "Projects", icon: <FolderKanban className="h-4 w-4" /> },
  ];

  const openTab = (tab: UserTab) => {
    if (tab === "projects") navigate({ to: projectViewPath(projectView) });
    else navigate({ to: tab === "dashboard" ? "/dashboard" : "/hi-there" });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading your workbench...</p>
        </div>
      </div>
    );
  }

  const stateBoxes: Array<{ key: string; state: ProjectState; icon: typeof AlertCircle; tone: string }> = [
    { key: "not_started", state: "not_started", icon: CircleDashed, tone: "bg-muted text-foreground/70" },
    { key: "in_progress", state: "in_progress", icon: Rocket, tone: "bg-pending-soft text-pending-strong" },
    { key: "on_hold", state: "on_hold", icon: PauseCircle, tone: "bg-warning-soft text-warning-strong" },
    { key: "blocked", state: "blocked", icon: AlertCircle, tone: "bg-destructive-soft text-destructive-strong" },
    { key: "live", state: "live", icon: CheckCircle2, tone: "bg-success-soft text-success-strong" },
  ];

  const kpiItems: KpiBoxItem[] = [
    {
      key: "all",
      label: "All projects",
      value: visibleProjects.length,
      sub: `${visibleProjects.reduce((sum, p) => sum + arrToCrore(p.arr), 0).toFixed(2)} Cr ${arrLabel}`,
      icon: FolderKanban,
      tone: "bg-muted text-foreground/70",
      onClick: () => setDrillDown({ title: "All projects", projects: visibleProjects }),
    },
    ...stateBoxes.map(({ key, state, icon, tone }) => {
      const list = visibleProjects.filter((project) => project.projectState === state);
      const label = stateLabels[state] || projectStateLabels[state];
      return {
        key,
        label: state === "in_progress" ? "In Progress" : label,
        value: list.length,
        sub: `${list.reduce((sum, p) => sum + arrToCrore(p.arr), 0).toFixed(2)} Cr ${arrLabel}`,
        icon,
        tone,
        onClick: () => setDrillDown({ title: label, description: "Project state", projects: list }),
        attentionCount: list.filter((p) => verdicts[p.id]?.level === "high").length,
        onAttentionClick: () => setDrillDown({ title: `${label} — needs attention`, projects: list.filter((p) => verdicts[p.id]?.level === "high") }),
      } satisfies KpiBoxItem;
    }),
  ];

  const deliveryStageGroups = visibleProjects.reduce<Record<string, Project[]>>((groups, project) => {
    const teamItems = project.checklist.filter((item) => item.ownerTeam === project.currentOwnerTeam);
    const next = teamItems.find((item) => !item.completed) || project.checklist.find((item) => !item.completed);
    const label = next?.title || "All Complete";
    groups[label] = [...(groups[label] || []), project];
    return groups;
  }, {});

  const dashlets: Record<string, React.ReactNode> = {
    kpi: <KpiBar items={kpiItems} storageKey="user_dashboard_kpi_order" />,
    incoming: (
      <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">Incoming projects</p>
          </div>
          <span className="flex items-center gap-2 text-primary"><span className="text-sm font-semibold">{incomingProjects.length}</span><UserCheck className="h-4 w-4" /></span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {incomingProjects.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center text-center">
              <CheckCircle2 className="mb-2 h-6 w-6 text-success-strong" />
              <p className="text-sm font-medium text-foreground">You’re all caught up</p>
              <p className="mt-1 text-2xs text-muted-foreground">No incoming projects need acceptance.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {incomingProjects.map((project) => {
                const stageId = getProjectFunnelStage(project);
                const stageLabel = getActiveFunnelStages().find((s) => s.id === stageId)?.label || "—";
                return (
                  <div key={project.id} className="flex items-center justify-between gap-3 px-1 py-2">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
                        onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                      >
                        {project.merchantName}
                      </button>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                        <span>{arrLabel}: {arrToCrore(project.arr).toFixed(2)} Cr</span>
                        <span>· {getLabel("field_project_state")}: {stateLabels[project.projectState] || projectStateLabels[project.projectState]}</span>
                        <span>· {getLabel("field_project_stage")}: {stageLabel}</span>
                        <span>· {getLabel("field_expected_go_live_date")}: {formatGoLiveDate(project)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setRejectTarget(project); }}
                      >
                        <X className="h-3 w-3" />Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs bg-success text-white hover:bg-success/90"
                        onClick={(e) => { e.stopPropagation(); acceptProject(project.id); }}
                      >
                        <Check className="h-3 w-3" />Accept
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    ),
    tat: <TATDashlet projects={visibleProjects} />,
    attention: <AttentionRequiredDashlet projects={visibleProjects} />,
    egl: <EglRiskDashlet projects={visibleProjects} />,
    stages: (
      <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div><p className="text-sm font-semibold text-foreground">Delivery stages</p></div>
          <BarChart3 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex h-full items-end gap-3">
            {Object.entries(deliveryStageGroups).sort((a, b) => b[1].length - a[1].length).map(([label, list]) => {
              const percentage = totalProjects ? Math.round((list.length / totalProjects) * 100) : 0;
              const barHeight = Math.max(percentage, 4);
              return (
                <button type="button" key={label} onClick={() => setDrillDown({ title: label, description: "Next pending checklist item", projects: list })} className="flex flex-1 min-w-0 flex-col items-center gap-1.5 rounded-md p-1 hover:bg-muted/50">
                  <span className="text-2xs font-semibold tabular-nums text-foreground">{list.length}</span>
                  <div className="w-full flex justify-center" style={{ height: "120px" }}>
                    <div className="w-full max-w-10 rounded-t-sm bg-primary self-end transition-all" style={{ height: `${barHeight}%` }} />
                  </div>
                  <span className="text-2xs font-medium text-muted-foreground text-center truncate w-full" title={label}>{label}</span>
                  <span className="text-2xs text-muted-foreground tabular-nums">{percentage}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    ),
    health: (
      <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div><p className="text-sm font-semibold text-foreground">Delivery health</p></div>
          <Settings className="h-4 w-4 text-primary" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex h-full items-end gap-3">
            {(Object.keys(projectStateLabels) as ProjectState[]).map((state) => {
              const list = visibleProjects.filter((project) => project.projectState === state);
              const percentage = totalProjects ? Math.round((list.length / totalProjects) * 100) : 0;
              const barHeight = Math.max(percentage, 4);
              return (
                <button type="button" key={state} onClick={() => setDrillDown({ title: stateLabels[state] || projectStateLabels[state], description: "Project state", projects: list })} className="flex flex-1 min-w-0 flex-col items-center gap-1.5 rounded-md p-1 hover:bg-muted/50">
                  <span className="text-2xs font-semibold tabular-nums text-foreground">{list.length}</span>
                  <div className="w-full flex justify-center" style={{ height: "120px" }}>
                    <div className="w-full max-w-10 rounded-t-sm bg-primary self-end transition-all" style={{ height: `${barHeight}%` }} />
                  </div>
                  <span className="text-2xs font-medium text-muted-foreground text-center truncate w-full">{stateLabels[state] || projectStateLabels[state]}</span>
                  <span className="text-2xs text-muted-foreground tabular-nums">{percentage}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    ),
  };

  customDashlets.forEach((config) => {
    dashlets[config.id] = (
      <CustomFieldDashlet
        title={config.title}
        field={config.field}
        projects={visibleProjects}
        onDrillDown={(title, list) => setDrillDown({ title, projects: list })}
      />
    );
  });

  const dashletLabels: Record<string, string> = {
    kpi: "KPI bar",
    incoming: "Incoming projects",
    tat: "TAT",
    attention: "Attention required",
    egl: "Projects at risk of missing Go-Live",
    stages: "Delivery stages",
    health: "Delivery health",
    ...Object.fromEntries(customDashlets.map((c) => [c.id, c.title])),
  };
  const builderItems = dashletOrder.filter((id) => dashletLabels[id]).map((id) => ({ id, label: dashletLabels[id]! }));

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[hsl(var(--surface-2))] text-foreground">
      <aside className={cn("relative flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-all duration-300", sidebarCollapsed ? "w-16" : "w-[212px]")}>
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            {labels.org_logo_url ? <img src={labels.org_logo_url} alt="Logo" className={cn("rounded-xl object-contain shadow-lg ring-2 ring-primary/20", sidebarCollapsed ? "h-8 w-8" : "h-12 w-12")} /> : <span className={cn("flex items-center justify-center rounded-xl gradient-primary shadow-[var(--shadow-soft)]", sidebarCollapsed ? "h-8 w-8" : "h-11 w-11")}><BarChart3 className="h-5 w-5 text-primary-foreground" /></span>}
            {!sidebarCollapsed && <><h1 className="min-w-0 flex-1 truncate text-base font-semibold">{labels.app_title}</h1><div className="flex shrink-0 items-center gap-0.5 [&_button]:text-sidebar-foreground/70 [&_button:hover]:text-sidebar-foreground"><Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-sidebar-accent/60" onClick={() => setSearchOpen(true)} title="Search (⌘K)"><Search className="h-4 w-4" /></Button><NotificationCenter /><Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-sidebar-accent/60" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar"><PanelLeftClose className="h-4 w-4" /></Button></div></>}
          </div>
          {sidebarCollapsed && <div className="mt-3 flex flex-col items-center gap-1 [&_button]:text-sidebar-foreground/70"><Button variant="ghost" size="icon" onClick={() => { setSidebarCollapsed(false); setSearchOpen(true); }} title="Search projects"><Search className="h-4 w-4" /></Button><NotificationCenter /><Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar"><PanelLeftOpen className="h-4 w-4" /></Button></div>}
        </div>
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} projects={userProjects} onFilterList={setSearchQuery} />
        <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-8">
          <div className="space-y-0.5">{navItems.map((item) => <Button key={item.key} variant="ghost" onClick={() => openTab(item.key)} title={item.label} className={cn("w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground", sidebarCollapsed && "justify-center px-0", resolvedTab === item.key && "gradient-primary text-primary-foreground hover:text-primary-foreground")}><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", resolvedTab === item.key ? "bg-primary-foreground/20" : "bg-sidebar-accent")}>{item.icon}</span>{!sidebarCollapsed && <span className="flex-1 text-left text-sm font-medium">{item.label}</span>}</Button>)}</div>
        </nav>
        {/* Account — identity, then the two things you do from here, as icons. */}
        <div className="p-2">
          <div className={cn("flex items-center gap-1 rounded-lg p-1", sidebarCollapsed && "flex-col gap-1.5")}>
            <span
              title={`${currentUser.name} — ${teamLabels[currentUser.team] || currentUser.team}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
            >
              {currentUser.name.charAt(0)}
            </span>
            {!sidebarCollapsed && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs font-medium text-sidebar-foreground">{currentUser.name}</span>
                <span className="block truncate text-2xs text-sidebar-foreground/60">{teamLabels[currentUser.team] || currentUser.team}</span>
              </span>
            )}
            <ThemeToggle className="h-7 w-7 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent/60" />
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              title="Logout"
              aria-label="Logout"
              className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className={cn("min-h-0 flex-1 app-shell-surface", (resolvedTab === "projects" || resolvedTab === "hi-there") ? "flex flex-col overflow-hidden" : "overflow-auto")}>
          <div className={cn("p-4 sm:p-6", (resolvedTab === "projects" || resolvedTab === "hi-there") && "flex min-h-0 flex-1 flex-col")}>
            {resolvedTab === "projects" && <div className="mb-3 flex shrink-0 flex-wrap items-center justify-center gap-2"><div className="flex items-center gap-1" role="tablist" aria-label="Project views">{[{ value: "kanban", label: "Kanban", icon: GripVertical }, { value: "list", label: "List", icon: List }, { value: "golive", label: "Go-Live Tracker", icon: CalendarDays }].map(({ value, label, icon: Icon }) => <Button key={value} variant="ghost" size="sm" role="tab" aria-selected={projectView === value} onClick={() => navigate({ to: projectViewPath(value as "kanban" | "list" | "golive") })} className={cn("h-8 gap-1.5 text-xs", projectView === value && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}><Icon className="h-3.5 w-3.5" />{label}</Button>)}</div><div ref={setProjectToolbarHost} className="flex flex-wrap items-center gap-2" /></div>}
            {resolvedTab === "dashboard" && <div className="mx-auto max-w-[1500px]">
              <div className="mb-4 flex items-end justify-between gap-4"><div><h1 className="heading-page text-foreground">{greeting()}, {currentUser.name} — here are your actions for today</h1></div><DashletBuilder items={builderItems} hidden={hidden} onToggle={toggleHidden} custom={customDashlets} onAddCustom={addCustom} onRemoveCustom={removeCustom} /></div>
              <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">{visibleOrder.map((id) => dashlets[id] ? <DashletSlot key={id} className={id === "kpi" ? "row-span-1 lg:col-span-2" : "lg:col-span-1"} isDragging={dragging === id} onDragStart={() => onDragStart(id)} onDragOver={() => onDragOver(id)} onDragEnd={onDragEnd}>{dashlets[id]}</DashletSlot> : null)}</div>
              <ProjectListDialog title={drillDown?.title || ""} description={drillDown?.description} projects={drillDown?.projects || []} open={!!drillDown} onOpenChange={(open) => { if (!open) setDrillDown(null); }} />
              {rejectTarget && <RejectTransferDialog project={rejectTarget} open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }} onReject={(reason) => { rejectProject(rejectTarget.id, reason); setRejectTarget(null); }} />}
            </div>}
            {resolvedTab === "projects" && projectView === "kanban" && <div className="flex min-h-0 flex-1 flex-col"><KanbanBoard projectsOverride={visibleProjects} toolbarContainer={projectToolbarHost} searchQuery={searchQuery} /></div>}
            {resolvedTab === "projects" && projectView === "golive" && <div className="flex min-h-0 flex-1 flex-col"><MonthlyGoLiveTracker projectsOverride={visibleProjects} toolbarContainer={projectToolbarHost} searchQuery={searchQuery} /></div>}
            {resolvedTab === "projects" && projectView === "list" && (() => {
              const lvFilteredProjects = visibleProjects.filter((p) => {
                const matchesState = lvStateFilter.length === 0 || lvStateFilter.includes(p.projectState);
                const matchesStage = lvFunnelStageFilter.length === 0 || lvFunnelStageFilter.includes(getProjectFunnelStage(p));
                const matchesAttention = !lvNeedsAttentionOnly || verdicts[p.id]?.level === "high";
                return matchesState && matchesStage && matchesAttention;
              });
              const lvHasActiveFilters = lvStateFilter.length > 0 || lvFunnelStageFilter.length > 0 || lvNeedsAttentionOnly;
              const clearLvFilters = () => { setLvStateFilter([]); setLvFunnelStageFilter([]); setLvNeedsAttentionOnly(false); };
              const getColValue = (project: Project, key: string): string => {
                switch (key) {
                  case "merchantName": return project.merchantName;
                  case "mid": return project.mid;
                  case "platform": return project.platform || "—";
                  case "category": return project.category || "—";
                  case "status": return stateLabels[project.projectState] || projectStateLabels[project.projectState];
                  case "projectStage": return funnelStageLabels[getProjectFunnelStage(project)] || "—";
                  case "arr": return `${project.arr}`;
                  case "expectedGoLiveDate": return formatGoLiveDate(project);
                  case "kickOffDate": return project.dates.kickOffDate;
                  case "goLiveDate": return project.dates.goLiveDate || project.dates.expectedGoLiveDate || "—";
                  case "integrationType": return project.integrationType || "—";
                  case "goLivePercent": return `${project.goLivePercent || 0}%`;
                  case "mintNotes": return project.notes?.mintNotes || "—";
                  case "projectNotes": return project.notes?.projectNotes || "—";
                  default: return "—";
                }
              };
              const statusColor = (s: string) =>
                s === "in_progress" ? "text-warning-strong" : s === "live" ? "text-success-strong" : s === "blocked" ? "text-destructive" : "text-muted-foreground";
              return (
              <div className="flex min-h-0 flex-1 flex-col">
                <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm border-border">
                  {/* Toolbar via portal */}
                  {projectToolbarHost ? createPortal(<div className="flex flex-wrap items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><ListChecks className="h-3.5 w-3.5" />Columns</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="end" side="bottom">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 tracking-normal">Visible Columns</p>
                        <div className="space-y-1 max-h-[300px] overflow-auto">
                          {LIST_VIEW_COLUMNS.map(col => {
                            const active = listViewColumns.includes(col.key);
                            return (
                              <label key={col.key} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer text-sm hover:bg-muted/50 rounded">
                                <Checkbox checked={active} onCheckedChange={() => {
                                  const newCols = active ? listViewColumns.filter(c => c !== col.key) : [...listViewColumns, col.key];
                                  setListViewColumns(newCols);
                                  localStorage.setItem("user_listview_columns", JSON.stringify(newCols));
                                }} className="h-4 w-4" />
                                {col.label}
                              </label>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Select value={String(listViewPageSize)} onValueChange={(v) => { setListViewPageSize(Number(v)); setListViewPage(1); }}>
                      <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 / Page</SelectItem>
                        <SelectItem value="25">25 / Page</SelectItem>
                        <SelectItem value="50">50 / Page</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>, projectToolbarHost) : null}
                  <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                    {/* Filter bar */}
                    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b bg-muted/30">
                      <button
                        type="button"
                        onClick={() => setLvNeedsAttentionOnly(v => !v)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium transition-colors border",
                          lvNeedsAttentionOnly
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        )}
                      >
                        <Eye className="h-3 w-3" />At Risk
                        {lvNeedsAttentionOnly && <X className="h-2.5 w-2.5 ml-0.5 opacity-70" onClick={(e) => { e.stopPropagation(); setLvNeedsAttentionOnly(false); }} />}
                      </button>
                      {[
                        { label: "State", values: lvStateFilter, setter: setLvStateFilter, options: (Object.keys(projectStateLabels) as ProjectState[]).map(s => ({ value: s, label: stateLabels[s] || projectStateLabels[s] })) },
                        { label: "Stage", values: lvFunnelStageFilter, setter: setLvFunnelStageFilter, options: (["sales","pre_integration","under_integration","live","none"] as FunnelStage[]).map(s => ({ value: s, label: funnelStageLabels[s] })) },
                      ].map(({ label, values, setter, options }) => (
                        <Popover key={label}>
                          <PopoverTrigger asChild>
                            <button type="button" className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium transition-colors border", values.length > 0 ? "bg-primary/10 text-primary border-primary/30" : "bg-background text-muted-foreground border-border hover:bg-muted")}>
                              {values.length > 0 ? `${label}: ${values.length}` : label}
                              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-52 p-2">
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {options.map(opt => (
                                <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs">
                                  <Checkbox checked={values.includes(opt.value)} onCheckedChange={() => toggleFilterValue(setter, opt.value)} />
                                  <span className="truncate">{opt.label}</span>
                                </label>
                              ))}
                            </div>
                            {values.length > 0 && <Button variant="ghost" size="sm" className="w-full mt-1 h-7 text-xs" onClick={() => setter([])}>Clear</Button>}
                          </PopoverContent>
                        </Popover>
                      ))}
                      {lvHasActiveFilters && (
                        <button type="button" onClick={clearLvFilters} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                          <X className="h-2.5 w-2.5" />Clear all
                        </button>
                      )}
                    </div>
                    <div className="h-px w-full shrink-0 bg-border" />
                    <div className="min-h-0 flex-1 overflow-auto">
                      <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
                        <TableHeader className="sticky top-0 z-10 bg-card table-header-tint">
                          <TableRow className="hover:bg-muted/40 border-b">
                            {listViewColumns.map(colKey => {
                              const col = LIST_VIEW_COLUMNS.find(c => c.key === colKey);
                              if (!col) return null;
                              const isSortable = SORTABLE_LIST_KEYS.has(colKey);
                              const isActive = listSortField === colKey;
                              return (
                                <TableHead
                                  key={colKey}
                                  draggable
                                  onDragStart={() => handleColDragStart(colKey)}
                                  onDragOver={(e) => { e.preventDefault(); handleColDragOver(colKey); }}
                                  onDragEnd={() => handleColDragEnd(listViewColumns)}
                                  className={cn("whitespace-nowrap text-xs tracking-normal select-none text-foreground p-0", draggedCol === colKey && "opacity-40")}
                                >
                                  {isSortable ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); toggleListSort(colKey); }}
                                      className={cn("group flex h-full w-full items-center gap-1 px-3 py-2 cursor-grab font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", isActive ? "text-foreground" : "text-muted-foreground")}
                                    >
                                      {col.label}
                                      {isActive
                                        ? (listSortDir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)
                                        : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
                                      }
                                    </button>
                                  ) : (
                                    <span className="flex h-full w-full items-center px-3 py-2 cursor-grab font-semibold">{col.label}</span>
                                  )}
                                </TableHead>
                              );
                            })}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            let sorted = [...lvFilteredProjects];
                            if (listSortField !== "none") {
                              sorted.sort((a, b) => {
                                let va = "", vb = "";
                                switch (listSortField) {
                                  case "merchantName": va = a.merchantName; vb = b.merchantName; break;
                                  case "arr": return listSortDir === "asc" ? a.arr - b.arr : b.arr - a.arr;
                                  case "platform": va = a.platform || ""; vb = b.platform || ""; break;
                                  case "kickOffDate": va = a.dates.kickOffDate; vb = b.dates.kickOffDate; break;
                                  case "expectedGoLiveDate": va = a.dates.expectedGoLiveDate || ""; vb = b.dates.expectedGoLiveDate || ""; break;
                                  case "status": va = a.projectState; vb = b.projectState; break;
                                }
                                return listSortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
                              });
                            }
                            const paged = sorted.slice((listViewPage - 1) * listViewPageSize, listViewPage * listViewPageSize);
                            return paged.length === 0 ? (
                              <TableRow><TableCell colSpan={listViewColumns.length} className="text-center py-8 text-muted-foreground text-sm">No projects to display.</TableCell></TableRow>
                            ) : paged.map(project => (
                              <TableRow key={project.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => openProjectInNewTab(project.id)}>
                                {listViewColumns.map(colKey => (
                                  <TableCell key={colKey} className={cn("text-xs", colKey === "status" && statusColor(project.projectState), colKey === "merchantName" && "font-medium")}>
                                    {colKey === "merchantName" ? (
                                      <span className="inline-flex items-center gap-1.5">
                                        {getColValue(project, colKey)}
                                        <RiskBadge projectId={project.id} verdict={verdicts[project.id]} />
                                      </span>
                                    ) : colKey === "arr" ? (
                                      `${arrToCrore(project.arr).toFixed(2)} Cr`
                                    ) : ["mintNotes", "projectNotes"].includes(colKey) ? (
                                      <span className="truncate block max-w-[200px]" title={getColValue(project, colKey)}>{getColValue(project, colKey)}</span>
                                    ) : (
                                      getColValue(project, colKey)
                                    )}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ));
                          })()}
                        </TableBody>
                      </Table>
                    </div>
                    {lvFilteredProjects.length > listViewPageSize && (
                      <div className="flex items-center justify-between px-4 py-3 border-t">
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={listViewPage <= 1} onClick={() => setListViewPage(p => p - 1)} className="h-8 w-8 p-0">
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          {Array.from({ length: Math.ceil(lvFilteredProjects.length / listViewPageSize) }, (_, i) => i + 1).slice(0, 5).map(page => (
                            <Button key={page} variant={listViewPage === page ? "default" : "outline"} size="sm" onClick={() => setListViewPage(page)} className="h-8 w-8 p-0 text-xs">
                              {page}
                            </Button>
                          ))}
                          <Button variant="outline" size="sm" disabled={listViewPage >= Math.ceil(lvFilteredProjects.length / listViewPageSize)} onClick={() => setListViewPage(p => p + 1)} className="h-8 w-8 p-0">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>);
            })()}
            {resolvedTab === "hi-there" && <div className="flex min-h-0 flex-1 flex-col"><AiChatBot /></div>}
          </div>
        </div>
      </main>
    </div>
  );
};
