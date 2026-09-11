import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  FolderKanban,
  GripVertical,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Rocket,
  Search,
  Settings,
  UserCheck,
  XCircle,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { type Project, type ProjectState, getProjectFunnelStage, projectStateLabels } from "@/data/projectsData";
import { getActiveFunnelStages } from "@/data/funnelConfig";
import { formatGoLiveDate } from "./GoLiveDate";
import { arrToCrore } from "@/lib/arr";
import { cn, greeting } from "@/lib/utils";
import { parseDashboardPath, projectViewPath } from "@/lib/dashboard-routes";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { useDashletOrder } from "@/hooks/useDashletOrder";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { NotificationCenter } from "./NotificationCenter";
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

  const userProjects = useMemo(
    () => projects.filter((project) => project.assignedOwner === currentUser?.id && !project.archived),
    [projects, currentUser?.id],
  );
  const visibleProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return userProjects;
    return userProjects.filter((project) =>
      project.merchantName.toLowerCase().includes(query) || project.mid.toLowerCase().includes(query),
    );
  }, [userProjects, searchQuery]);

  useEffect(() => {
    if (pathname === "/") navigate({ to: "/dashboard", replace: true });
    if (pathname === "/projects/list") navigate({ to: "/projects/kanban", replace: true });
  }, [pathname, navigate]);

  if (!currentUser) return null;
  const incomingProjects = visibleProjects.filter((project) => project.pendingAcceptance);
  const totalProjects = visibleProjects.length;
  
  const deliveryProjects = visibleProjects.filter((project) => project.projectState === "in_progress");
  const liveProjects = visibleProjects.filter((project) => project.projectState === "live");
  const arrLabel = getLabel("field_arr");

  const resolvedTab: UserTab = routeState.tab === "projects" || routeState.tab === "hi-there"
    ? routeState.tab
    : "dashboard";
  const projectView = routeState.projectView === "golive" ? "golive" : "kanban";
  const navItems: Array<{ key: UserTab; label: string; icon: React.ReactNode }> = [
    { key: "dashboard", label: "Workbench", icon: <BarChart3 className="h-4 w-4" /> },
    { key: "projects", label: "Projects", icon: <FolderKanban className="h-4 w-4" /> },
    { key: "hi-there", label: "Buddy", icon: <span className="animate-wave text-base leading-none">👋</span> },
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
    { key: "in_progress", state: "in_progress", icon: Rocket, tone: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
    { key: "on_hold", state: "on_hold", icon: PauseCircle, tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    { key: "blocked", state: "blocked", icon: AlertCircle, tone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    { key: "live", state: "live", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
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
            <p className="mt-0.5 text-[11px] text-muted-foreground">Projects waiting for your acceptance</p>
          </div>
          <span className="flex items-center gap-2 text-primary"><span className="text-sm font-semibold">{incomingProjects.length}</span><UserCheck className="h-4 w-4" /></span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {incomingProjects.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center text-center">
              <CheckCircle2 className="mb-2 h-6 w-6 text-emerald-500" />
              <p className="text-sm font-medium text-foreground">You’re all caught up</p>
              <p className="mt-1 text-[11px] text-muted-foreground">No incoming projects need acceptance.</p>
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
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{arrLabel}: {arrToCrore(project.arr).toFixed(2)} Cr</span>
                        <span>· {getLabel("field_project_state")}: {stateLabels[project.projectState] || projectStateLabels[project.projectState]}</span>
                        <span>· {getLabel("field_project_stage")}: {stageLabel}</span>
                        <span>· {getLabel("field_expected_go_live_date")}: {formatGoLiveDate(project)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" className="h-7 gap-1 bg-emerald-500 px-2.5 text-xs text-white hover:bg-emerald-600" onClick={() => acceptProject(project.id)}><CheckCircle2 className="h-3 w-3" />Accept</Button>
                      <Button size="sm" variant="destructive" className="h-7 gap-1 px-2.5 text-xs" onClick={() => setRejectTarget(project)}><XCircle className="h-3 w-3" />Reject</Button>
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
          <div><p className="text-sm font-semibold text-foreground">Delivery stages</p><p className="mt-0.5 text-[11px] text-muted-foreground">Where your active project work is concentrated</p></div>
          <BarChart3 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
          {Object.entries(deliveryStageGroups).sort((a, b) => b[1].length - a[1].length).map(([label, list]) => {
            const percentage = totalProjects ? Math.round((list.length / totalProjects) * 100) : 0;
            return <button type="button" key={label} onClick={() => setDrillDown({ title: label, description: "Next pending checklist item", projects: list })} className="block w-full space-y-1 rounded-md p-1 text-left hover:bg-muted/50"><span className="flex justify-between text-xs"><span className="max-w-[70%] truncate font-medium text-foreground/80">{label}</span><span className="text-[11px] font-semibold">{list.length} · {percentage}%</span></span><Progress value={percentage} className="h-1.5" /></button>;
          })}
        </div>
      </section>
    ),
    health: (
      <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div><p className="text-sm font-semibold text-foreground">Delivery health</p><p className="mt-0.5 text-[11px] text-muted-foreground">Project state distribution across your work</p></div>
          <Settings className="h-4 w-4 text-primary" />
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
          {(Object.keys(projectStateLabels) as ProjectState[]).map((state) => {
            const list = visibleProjects.filter((project) => project.projectState === state);
            const percentage = totalProjects ? Math.round((list.length / totalProjects) * 100) : 0;
            return <button type="button" key={state} onClick={() => setDrillDown({ title: stateLabels[state] || projectStateLabels[state], description: "Project state", projects: list })} className="block w-full space-y-1 rounded-md p-1 text-left hover:bg-muted/50"><span className="flex justify-between text-xs"><span className="font-medium text-foreground/80">{stateLabels[state] || projectStateLabels[state]}</span><span className="text-[11px] font-semibold">{list.length} · {percentage}%</span></span><Progress value={percentage} className="h-1.5" /></button>;
          })}
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
    egl: "Projects at risk of missing EGL",
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
            {!sidebarCollapsed && <><h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{labels.app_title}</h1><div className="flex shrink-0 items-center gap-0.5 [&_button]:text-sidebar-foreground/70 [&_button:hover]:text-sidebar-foreground"><Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-sidebar-accent/60" onClick={() => setSearchOpen((open) => !open)} title="Search projects"><Search className="h-4 w-4" /></Button><NotificationCenter /><Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-sidebar-accent/60" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar"><PanelLeftClose className="h-4 w-4" /></Button></div></>}
          </div>
          {sidebarCollapsed && <div className="mt-3 flex flex-col items-center gap-1 [&_button]:text-sidebar-foreground/70"><Button variant="ghost" size="icon" onClick={() => { setSidebarCollapsed(false); setSearchOpen(true); }} title="Search projects"><Search className="h-4 w-4" /></Button><NotificationCenter /><Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar"><PanelLeftOpen className="h-4 w-4" /></Button></div>}
        </div>
        {!sidebarCollapsed && searchOpen && <div className="px-3 pb-3"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50" /><Input autoFocus placeholder="Search projects..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-8 border-sidebar-border bg-sidebar-accent/40 pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/50" />{searchQuery && <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-8 w-8" onClick={() => setSearchQuery("")} title="Clear search"><X className="h-3.5 w-3.5" /></Button>}</div></div>}
        <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-8">
          <div className="space-y-0.5">{navItems.map((item) => <Button key={item.key} variant="ghost" onClick={() => openTab(item.key)} title={item.label} className={cn("w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground", sidebarCollapsed && "justify-center px-0", resolvedTab === item.key && "gradient-primary text-primary-foreground hover:text-primary-foreground")}><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", resolvedTab === item.key ? "bg-primary-foreground/20" : "bg-sidebar-accent")}>{item.icon}</span>{!sidebarCollapsed && <span className="flex-1 text-left text-sm font-medium">{item.label}</span>}</Button>)}</div>
        </nav>
        <div className="p-2">
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" className={cn("h-auto w-full justify-start gap-2 p-1 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground", sidebarCollapsed && "justify-center")}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{currentUser.name.charAt(0)}</span>{!sidebarCollapsed && <span className="min-w-0 flex-1 text-left"><span className="block truncate text-xs font-medium">{currentUser.name}</span><span className="block text-[10px] text-sidebar-foreground/60">{teamLabels[currentUser.team] || currentUser.team}</span></span>}</Button></PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-56 p-1.5"><div className="px-2 py-1.5"><p className="truncate text-sm font-medium">{currentUser.name}</p><p className="truncate text-xs text-muted-foreground">{teamLabels[currentUser.team] || currentUser.team}</p></div><div className="my-1 h-px bg-border" /><div className="flex items-center justify-between rounded-md px-2 py-1 text-sm"><span>Theme</span><ThemeToggle /></div><Button variant="ghost" onClick={logout} className="mt-0.5 w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"><LogOut className="h-4 w-4" />Logout</Button></PopoverContent>
          </Popover>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className={cn("min-h-0 flex-1 app-shell-surface", (resolvedTab === "projects" || resolvedTab === "hi-there") ? "flex flex-col overflow-hidden" : "overflow-auto")}>
          <div className={cn("p-4 sm:p-6", (resolvedTab === "projects" || resolvedTab === "hi-there") && "flex min-h-0 flex-1 flex-col")}>
            {resolvedTab === "projects" && <div className="mb-3 flex shrink-0 flex-wrap items-center justify-center gap-2"><div className="flex items-center gap-1" role="tablist" aria-label="Project views">{[{ value: "kanban", label: "Kanban", icon: GripVertical }, { value: "golive", label: "Go-Live Tracker", icon: CalendarDays }].map(({ value, label, icon: Icon }) => <Button key={value} variant="ghost" size="sm" role="tab" aria-selected={projectView === value} onClick={() => navigate({ to: projectViewPath(value as "kanban" | "golive") })} className={cn("h-8 gap-1.5 text-xs", projectView === value && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}><Icon className="h-3.5 w-3.5" />{label}</Button>)}</div><div ref={setProjectToolbarHost} className="flex flex-wrap items-center gap-2" /></div>}
            {resolvedTab === "dashboard" && <div className="mx-auto max-w-[1500px]">
              <div className="mb-4 flex items-end justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight text-foreground">{greeting()}, {currentUser.name} — here are your actions for today</h1></div><DashletBuilder items={builderItems} hidden={hidden} onToggle={toggleHidden} custom={customDashlets} onAddCustom={addCustom} onRemoveCustom={removeCustom} /></div>
              <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">{visibleOrder.map((id) => dashlets[id] ? <DashletSlot key={id} className={id === "kpi" ? "row-span-1 lg:col-span-2" : "lg:col-span-1"} isDragging={dragging === id} onDragStart={() => onDragStart(id)} onDragOver={() => onDragOver(id)} onDragEnd={onDragEnd}>{dashlets[id]}</DashletSlot> : null)}</div>
              <ProjectListDialog title={drillDown?.title || ""} description={drillDown?.description} projects={drillDown?.projects || []} open={!!drillDown} onOpenChange={(open) => { if (!open) setDrillDown(null); }} />
              {rejectTarget && <RejectTransferDialog project={rejectTarget} open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }} onReject={(reason) => { rejectProject(rejectTarget.id, reason); setRejectTarget(null); }} />}
            </div>}
            {resolvedTab === "projects" && projectView === "kanban" && <div className="flex min-h-0 flex-1 flex-col"><KanbanBoard projectsOverride={visibleProjects} toolbarContainer={projectToolbarHost} searchQuery={searchQuery} /></div>}
            {resolvedTab === "projects" && projectView === "golive" && <div className="flex min-h-0 flex-1 flex-col"><MonthlyGoLiveTracker projectsOverride={visibleProjects} toolbarContainer={projectToolbarHost} searchQuery={searchQuery} /></div>}
            {resolvedTab === "hi-there" && <div className="flex min-h-0 flex-1 flex-col"><AiChatBot /></div>}
          </div>
        </div>
      </main>
    </div>
  );
};
