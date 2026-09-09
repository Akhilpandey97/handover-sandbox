import { apiAuthHeaders } from "@/lib/api-invoke";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { teamColorClass } from "@/data/teams";
import { useLabels } from "@/contexts/LabelsContext";
import {
  Project,
  projectStateLabels,
  getProjectFunnelStage,
  funnelStageLabels,
} from "@/data/projectsData";
import { ProjectCardNew } from "./ProjectCardNew";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectDetailsDialog } from "./ProjectDetailsDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Clock,
  FolderKanban,
  LogOut,
  Rocket,
  Search,
  AlertCircle,
  Layers,
  Brain,
  Loader2,
  AlertTriangle,
  Zap,
  Filter,
  X,
  LayoutGrid,
  List,
  Columns3,
  ArrowUpDown,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "./NotificationCenter";
import { RiskBadge } from "./RiskBadge";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";

type TabType = "pending" | "active" | "all";
type ViewType = "cards" | "kanban" | "list";
type SortKey =
  | "merchantName"
  | "arr"
  | "goLivePercent"
  | "expectedGoLive"
  | "kickOff"
  | "updatedAt";

interface AiAlert {
  project: string;
  action: string;
  priority: "high" | "medium" | "low";
  alert: string;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "merchantName", label: "Merchant Name" },
  { key: "arr", label: "ARR" },
  { key: "goLivePercent", label: "Go-Live %" },
  { key: "expectedGoLive", label: "Expected Go-Live" },
  { key: "kickOff", label: "Kick Off Date" },
  { key: "updatedAt", label: "Last Updated" },
];

export const TeamDashboard = () => {
  const navigate = useNavigate();
  const [kanbanToolbar, setKanbanToolbar] = useState<HTMLDivElement | null>(null);
  const { currentUser, logout } = useAuth();
  const { getPendingProjects, getActiveProjects, projects, isLoading } = useProjects();
  const { teamLabels, labels, responsibilityLabels, phaseLabels, stateLabels } = useLabels();
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [view, setView] = useState<ViewType>("cards");
  const [sortKey, setSortKey] = useState<SortKey>("merchantName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [funnelFilter, setFunnelFilter] = useState<string[]>([]);
  const [respFilter, setRespFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [detailsProject, setDetailsProject] = useState<Project | null>(null);
  const [aiAlerts, setAiAlerts] = useState<AiAlert[]>([]);
  const [aiAlertsLoading, setAiAlertsLoading] = useState(false);
  const [aiAlertsLoaded, setAiAlertsLoaded] = useState(false);

  const userProjects = useMemo(
    () => projects.filter((p) => p.assignedOwner === currentUser?.id),
    [projects, currentUser?.id]
  );

  const filterOptions = useMemo(() => {
    const states = new Set<string>();
    const phases = new Set<string>();
    const funnels = new Set<string>();
    const resps = new Set<string>();
    const platforms = new Set<string>();
    userProjects.forEach((p) => {
      states.add(p.projectState);
      phases.add(p.currentPhase);
      funnels.add(getProjectFunnelStage(p));
      resps.add(p.currentResponsibility);
      if (p.platform) platforms.add(p.platform);
    });
    return {
      states: [...states].sort(),
      phases: [...phases].sort(),
      funnels: [...funnels].sort(),
      resps: [...resps].sort(),
      platforms: [...platforms].sort(),
    };
  }, [userProjects]);

  const activeFilterCount =
    stateFilter.length + phaseFilter.length + funnelFilter.length + respFilter.length + platformFilter.length;

  if (!currentUser) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading your projects...</p>
        </div>
      </div>
    );
  }

  const pendingForUser = getPendingProjects(currentUser.team).filter((p) => p.assignedOwner === currentUser.id);
  const activeForUser = getActiveProjects(currentUser.team).filter((p) => p.assignedOwner === currentUser.id);

  const baseProjects =
    activeTab === "pending" ? pendingForUser : activeTab === "active" ? activeForUser : userProjects;

  const applyFilters = (list: Project[]) =>
    list.filter((p) => {
      const q = searchQuery.toLowerCase();
      if (
        q &&
        !p.merchantName.toLowerCase().includes(q) &&
        !p.mid.toLowerCase().includes(q)
      )
        return false;
      if (stateFilter.length && !stateFilter.includes(p.projectState)) return false;
      if (phaseFilter.length && !phaseFilter.includes(p.currentPhase)) return false;
      if (funnelFilter.length && !funnelFilter.includes(getProjectFunnelStage(p))) return false;
      if (respFilter.length && !respFilter.includes(p.currentResponsibility)) return false;
      if (platformFilter.length && !platformFilter.includes(p.platform || "")) return false;
      return true;
    });

  const sortProjects = (list: Project[]) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (p: Project): string | number => {
      switch (sortKey) {
        case "arr": return p.arr || 0;
        case "goLivePercent": return p.goLivePercent || 0;
        case "expectedGoLive": return p.dates?.expectedGoLiveDate || "";
        case "kickOff": return p.dates?.kickOffDate || "";
        case "updatedAt": return p.updatedAt || "";
        default: return p.merchantName?.toLowerCase() || "";
      }
    };
    return [...list].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  };

  const displayProjects = sortProjects(applyFilters(baseProjects));

  const clearFilters = () => {
    setStateFilter([]);
    setPhaseFilter([]);
    setFunnelFilter([]);
    setRespFilter([]);
    setPlatformFilter([]);
  };

  const toggle = (arr: string[], setArr: (v: string[]) => void, value: string) =>
    setArr(arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);

  const handleGenerateAiAlerts = async () => {
    if (userProjects.length === 0) {
      toast.info("No projects to analyze");
      return;
    }
    setAiAlertsLoading(true);
    try {
      const response = await fetch(
        `/api/public/ai-project-insights`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await apiAuthHeaders()),
          },
          body: JSON.stringify({ projects: userProjects, type: "next_actions" }),
        }
      );
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const data = await response.json();
      setAiAlerts(data.result || []);
      setAiAlertsLoaded(true);
    } catch (err: any) {
      console.error("AI alerts error:", err);
      toast.error("Failed to generate AI alerts");
    } finally {
      setAiAlertsLoading(false);
    }
  };

  const sidebarItems: { key: TabType; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    { key: "pending", label: "Pending", icon: <AlertCircle className="h-4 w-4" />, count: pendingForUser.length, color: "text-amber-500" },
    { key: "active", label: "Active", icon: <Rocket className="h-4 w-4" />, count: activeForUser.length, color: "text-emerald-500" },
    { key: "all", label: "All Projects", icon: <Layers className="h-4 w-4" />, count: userProjects.length, color: "text-primary" },
  ];

  const filterGroup = (
    title: string,
    options: string[],
    selected: string[],
    setSelected: (v: string[]) => void,
    labelFn: (v: string) => string
  ) =>
    options.length > 0 && (
      <div className="space-y-1.5">
        <p className="portal-label">{title}</p>
        <div className="space-y-1">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(selected, setSelected, opt)}
              />
              <span className="truncate">{labelFn(opt)}</span>
            </label>
          ))}
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            {labels.org_logo_url ? (
              <img src={labels.org_logo_url} alt="Logo" className="h-9 w-9 rounded-lg object-contain" />
            ) : (
              <div className={`h-9 w-9 rounded-lg ${teamColorClass(currentUser.team)} flex items-center justify-center`}>
                <FolderKanban className="h-5 w-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate text-sidebar-foreground">{teamLabels[currentUser.team]}</h1>
              <p className="text-xs text-sidebar-foreground/60">Team Dashboard</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3">
          <p className="portal-label mb-2 px-2 text-sidebar-foreground/70">Projects</p>
          <div className="space-y-1">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm",
                  activeTab === item.key
                    ? "bg-primary/20 text-sidebar-foreground font-semibold"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={activeTab === item.key ? "text-primary" : item.color}>{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </div>
                <Badge
                  variant={activeTab === item.key ? "secondary" : "outline"}
                  className={cn(
                    "text-xs font-semibold min-w-[24px] justify-center",
                    activeTab === item.key
                      ? "bg-primary/25 text-sidebar-foreground border-0"
                      : "bg-transparent text-sidebar-foreground/70 border-sidebar-border"
                  )}
                >
                  {item.count}
                </Badge>
              </button>
            ))}
          </div>

          {/* AI Alerts Section */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2 px-2">
              <p className="portal-label text-sidebar-foreground/70">AI Alerts</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 px-2 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                onClick={handleGenerateAiAlerts}
                disabled={aiAlertsLoading}
              >
                {aiAlertsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                {aiAlertsLoaded ? "Refresh" : "Generate"}
              </Button>
            </div>

            {aiAlertsLoading && (
              <div className="flex items-center justify-center py-3 text-xs text-sidebar-foreground/60 gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing projects...
              </div>
            )}

            {!aiAlertsLoading && aiAlertsLoaded && aiAlerts.length === 0 && (
              <p className="text-xs text-sidebar-foreground/60 px-2">No alerts found.</p>
            )}

            {!aiAlertsLoading && aiAlerts.length > 0 && (
              <ScrollArea className="h-[240px]">
                <div className="space-y-2 px-1">
                  {aiAlerts.map((alert, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-lg p-2.5 border text-xs",
                        alert.priority === "high"
                          ? "bg-destructive/10 border-destructive/30"
                          : alert.priority === "medium"
                          ? "bg-amber-500/10 border-amber-200 dark:border-amber-800"
                          : "bg-sidebar-accent/50 border-sidebar-border"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {alert.priority === "high" ? (
                          <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                        ) : (
                          <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                        )}
                        <span className="font-semibold truncate">{alert.project}</span>
                      </div>
                      <p className="text-sidebar-foreground/70 leading-relaxed">{alert.action}</p>
                      {alert.alert && <p className="mt-1 font-medium text-destructive">{alert.alert}</p>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {!aiAlertsLoaded && !aiAlertsLoading && (
              <p className="text-xs text-sidebar-foreground/60 px-2">Click Generate for AI-powered next actions.</p>
            )}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b bg-background flex items-center justify-between px-6 shrink-0">
          <div>
            <h2 className="text-base font-semibold">
              {activeTab === "pending" && "Pending Acceptance"}
              {activeTab === "active" && "Active Projects"}
              {activeTab === "all" && "All Projects"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {displayProjects.length} project{displayProjects.length !== 1 ? "s" : ""} found
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name or MID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2.5 pl-3 border-l">
              <NotificationCenter />
              <ThemeToggle />
              <div className="text-right hidden md:block">
                <p className="font-medium text-xs">{currentUser.name}</p>
                <p className="text-xs text-muted-foreground">{teamLabels[currentUser.team] || currentUser.team}</p>
              </div>
              <div className={`h-8 w-8 rounded-lg ${teamColorClass(currentUser.team)} flex items-center justify-center text-white font-semibold text-xs`}>
                {currentUser.name.charAt(0)}
              </div>
              <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Toolbar: view / sort / filters */}
        <div className="border-b bg-card/50 px-6 py-2.5 flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            {([
              { key: "cards" as ViewType, label: "Cards", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
              { key: "kanban" as ViewType, label: "Kanban", icon: <Columns3 className="h-3.5 w-3.5" /> },
              { key: "list" as ViewType, label: "List", icon: <List className="h-3.5 w-3.5" /> },
            ]).map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>

          {view === "kanban" && (
            <div ref={setKanbanToolbar} className="ml-auto flex items-center gap-2" />
          )}

          {view !== "kanban" && (
            <>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.key} value={o.key} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              >
                {sortDir === "asc" ? "Ascending" : "Descending"}
              </Button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Filter className="h-3.5 w-3.5" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <ScrollArea className="max-h-[380px] pr-2">
                    <div className="space-y-3">
                      {filterGroup("Project State", filterOptions.states, stateFilter, setStateFilter, (v) => stateLabels?.[v] || projectStateLabels[v as keyof typeof projectStateLabels] || v)}
                      {filterGroup("Project Stage", filterOptions.funnels, funnelFilter, setFunnelFilter, (v) => funnelStageLabels[v] || v)}
                      {filterGroup("Responsibility", filterOptions.resps, respFilter, setRespFilter, (v) => responsibilityLabels?.[v] || v)}
                      {filterGroup("Platform", filterOptions.platforms, platformFilter, setPlatformFilter, (v) => v)}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </>
          )}
        </div>

        {/* Content */}
        {view === "kanban" ? (
          <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
            <KanbanBoard
              projectsOverride={applyFilters(baseProjects)}
              toolbarContainer={kanbanToolbar}
              searchQuery={searchQuery}
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-6">
              {displayProjects.length === 0 ? (
                <div className="text-center py-16">
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    {activeTab === "pending" && <Clock className="h-6 w-6 text-amber-500" />}
                    {activeTab === "active" && <Rocket className="h-6 w-6 text-emerald-500" />}
                    {activeTab === "all" && <FolderKanban className="h-6 w-6 text-muted-foreground" />}
                  </div>
                  <h3 className="font-semibold text-sm mb-1">No projects found</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Try adjusting your search or filters.
                  </p>
                </div>
              ) : view === "cards" ? (
                <div className="space-y-3">
                  {displayProjects.map((project) => (
                    <ProjectCardNew key={project.id} project={project} riskVerdict={riskVerdicts[project.id]} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border bg-card overflow-hidden">
                  <Table>
                    <TableHeader className="bg-navy">
                      <TableRow className="hover:bg-navy">
                        <TableHead className="text-xs text-navy-foreground">Merchant</TableHead>
                        <TableHead className="text-xs text-navy-foreground">MID</TableHead>
                        <TableHead className="text-xs text-navy-foreground">Platform</TableHead>
                        <TableHead className="text-xs text-navy-foreground">State</TableHead>
                        <TableHead className="text-xs text-navy-foreground">Project Stage</TableHead>
                        <TableHead className="text-xs text-navy-foreground">Responsibility</TableHead>
                        <TableHead className="text-xs text-right text-navy-foreground">ARR</TableHead>
                        <TableHead className="text-xs text-right text-navy-foreground">Go-Live %</TableHead>
                        <TableHead className="text-xs text-navy-foreground">Expected Go-Live</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayProjects.map((p) => (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: p.id } })}
                        >
                          <TableCell className="text-xs font-medium"><span className="inline-flex items-center gap-1.5">{p.merchantName}<RiskBadge projectId={p.id} verdict={riskVerdicts[p.id]} /></span></TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{p.mid}</TableCell>
                          <TableCell className="text-xs">{p.platform || "—"}</TableCell>
                          <TableCell className="text-xs">
                            {stateLabels?.[p.projectState] || projectStateLabels[p.projectState] || p.projectState}
                          </TableCell>
                          <TableCell className="text-xs">{funnelStageLabels[getProjectFunnelStage(p)]}</TableCell>
                          <TableCell className="text-xs">
                            {responsibilityLabels?.[p.currentResponsibility] || p.currentResponsibility}
                          </TableCell>
                          <TableCell className="text-xs text-right">{p.arr ? p.arr.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-xs text-right">{p.goLivePercent ?? 0}%</TableCell>
                          <TableCell className="text-xs">{p.dates?.expectedGoLiveDate || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </main>

      <ProjectDetailsDialog
        project={detailsProject}
        open={!!detailsProject}
        onOpenChange={(o) => !o && setDetailsProject(null)}
      />
    </div>
  );
};
