import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  parseDashboardPath,
  pathForTab,
  projectViewPath,
  normalizeTabOrder,
  DEFAULT_PROJECT_VIEW,
  type ProjectView,
} from "@/lib/dashboard-routes";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { NoAccessCard } from "@/components/NoAccessCard";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { teamColorClass, teamLabels as defaultTeamLabels, TeamRole } from "@/data/teams";
import { UserManagement } from "./UserManagement";
import { TenantManagement } from "./TenantManagement";
import { SettingsPanel } from "./SettingsPanel";
import { ChecklistManagement } from "./ChecklistManagement";
import { BulkEditDialog, BulkFieldUpdates } from "./BulkEditDialog";
import { ParsedEmailsTab } from "./ParsedEmailsTab";
import { PlatformMerchants } from "./PlatformMerchants";
import { ShopifySmeTab } from "./ShopifySmeTab";
import { ShopifyLtEmailComms } from "./ShopifyLtEmailComms";
import { MonthlyGoLiveTracker } from "./MonthlyGoLiveTracker";
import { KanbanBoard } from "./KanbanBoard";
import { CSVUploadDialog } from "./CSVUploadDialog";
import { AddProjectDialog } from "./AddProjectDialog";
import { AssignOwnerDialog } from "./AssignOwnerDialog";
import { EditProjectDialog } from "./EditProjectDialog";
import { Project, calculateTimeByParty, calculateTimeFromChecklist, formatDuration, projectStateLabels, ProjectState, ProjectPhase, isProjectUnderIntegration, getProjectFunnelStage, funnelStageLabels, FunnelStage } from "@/data/projectsData";
import { supabase } from "@/integrations/supabase/client";
import { ProjectCardNew } from "./ProjectCardNew";
import { ProjectListDialog } from "@/components/ProjectListDialog";
import { ProjectDetailsDialog } from "./ProjectDetailsDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // kept for sub-tabs in reports
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowUpDown,
  BarChart3,
  Clock,
  Download,
  FolderKanban,
  LogOut,
  Search,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  ListChecks,
  User,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Upload,
  Plus,
  Target,
  Timer,
  Settings,
  PieChart,
  Rocket,
  Trash2,
  UserPlus,
  RefreshCw,
  Sparkles,
  Loader2,
  Pencil,
  CalendarDays,
  Mail,
  GripVertical,
  List,
  X,
  Archive,
  ShieldAlert,
  ArchiveRestore,
  MessageCircle,
  Server,
  ShoppingBag,
  Filter,
} from "lucide-react";
import { exportProjectsToCSV } from "@/utils/exportProjects";
import { exportProjectChecklistCSV, exportTeamOwnerCSV } from "@/utils/reportExportCSV";
import { useCustomFields, useAllCustomFieldValues } from "@/hooks/useCustomFields";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "./NotificationCenter";
import { AiChatBot } from "./AiChatBot";
import { useMyTenantAccess, useEnterTenant } from "@/hooks/useTenantAccess";
import { ToolbarIconButton, TOOLBAR_POPOVER, TOOLBAR_PANEL_MAX_H } from "./ToolbarIconButton";
import { RiskBadge } from "./RiskBadge";
import { EglRiskDashlet } from "./EglRiskDashlet";
import { AttentionRequiredDashlet } from "./AttentionRequiredDashlet";
import { DashletSlot } from "./DashletSlot";
import { DashletBuilder } from "./DashletBuilder";
import { CustomFieldDashlet } from "./CustomFieldDashlet";
import { KpiBar, type KpiBoxItem } from "./KpiBar";
import { useDashletOrder } from "@/hooks/useDashletOrder";
import { formatGoLiveDate } from "./GoLiveDate";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { toast } from "sonner";
import { fetchAiInsights } from "@/utils/aiInsights";
import { cn } from "@/lib/utils";

// Report components
import { ExecutiveDashboard } from "./reports/ExecutiveDashboard";
import { OperationalReports } from "./reports/OperationalReports";
import { MerchantResponsibility } from "./reports/MerchantResponsibility";
import { WeeksPerChecklistReport } from "./reports/WeeksPerChecklistReport";
import { TacticalLists } from "./reports/TacticalLists";
import { TATReport } from "./reports/TATReport";
import { TATDashlet } from "./TATDashlet";
import { ReportsBuilder } from "./reports/ReportsBuilder";
import { ReportScheduler } from "./reports/ReportScheduler";
import { PivotTableSettings } from "./settings/PivotTableSettings";
import { SandboxTesting } from "./reports/SandboxTesting";
import { PortalVisitsReport } from "./reports/PortalVisitsReport";
import { MovementReport } from "./reports/MovementReport";
import { RiskDashboard } from "./RiskDashboard";
import { arrToCrore, formatArrCr } from "@/lib/arr";

// All nav items that can be toggled
const ALL_NAV_ITEMS = [
  "dashboard",
  "projects",
  "risks",
  "reports",
  "settings",
  "emails",
  "archived",
  "platforms",
  "golive",
  "shopify-sme",
  "shopify-lt-emails",
  "tenants",
];
const ADMIN_ONLY_SETTINGS = ["users", "integrations"];

const LAST_PROJECT_VIEW_KEY = "manager_last_project_view";

const readLastProjectView = (): ProjectView => {
  try {
    const saved = localStorage.getItem(LAST_PROJECT_VIEW_KEY);
    if (saved === "kanban" || saved === "list" || saved === "golive") return saved;
  } catch { /* private mode */ }
  return DEFAULT_PROJECT_VIEW;
};

export const ManagerDashboard = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const routeState = useMemo(() => parseDashboardPath(pathname), [pathname]);
  const { currentUser, logout } = useAuth();
  const perms = usePermissions();
  const { labels: appLabels, getLabel, teamLabels, responsibilityLabels, phaseLabels, stateLabels: stateLabelsFromCtx, updateLabels, isLoading: labelsLoading } = useLabels();
  const arrLabel = getLabel("field_arr");
  const { projects, isLoading, addProject, deleteProject, updateProject, archiveProject } = useProjects();
  const { fields: customFields } = useCustomFields();
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();
  const {
    order: dashletOrder,
    visibleOrder: visibleDashletOrder,
    hidden: hiddenDashlets,
    toggleHidden: toggleDashletHidden,
    custom: customDashlets,
    addCustom: addCustomDashlet,
    removeCustom: removeCustomDashlet,
    dragging: draggingDashlet,
    onDragStart: onDashletDragStart,
    onDragOver: onDashletDragOver,
    onDragEnd: onDashletDragEnd,
  } = useDashletOrder(["kpi", "workload", "tat", "attention", "egl", "stages", "health"], "manager_dashboard_dashlet_order");
  const projectIds = useMemo(() => projects.map(p => p.id), [projects]);
  const { valuesMap: customValuesMap } = useAllCustomFieldValues(projectIds);
  const [searchQuery, setSearchQuery] = useState("");
  // Search is an icon in the sidebar that reveals its input, rather than a
  // permanent field in a global bar.
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: myAccess = [] } = useMyTenantAccess();
  const enterTenant = useEnterTenant();
  // Tab state is derived from the URL, never stored — that is what keeps the two
  // from drifting apart. "" means the path names no tab, so `/` resolves a default.
  const activeTab = routeState.tab;
  const projectView = routeState.projectView;
  const [projectToolbarHost, setProjectToolbarHost] = useState<HTMLDivElement | null>(null);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [responsibilityFilter, setResponsibilityFilter] = useState<string[]>([]);
  const [underIntegrationFilter, setUnderIntegrationFilter] = useState(false);
  const [funnelStageFilter, setFunnelStageFilter] = useState<string[]>([]);
  const [drillDown, setDrillDown] = useState<{ title: string; description?: string; projects: Project[] } | null>(null);

  const toggleFilterValue = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };
  const [arrMin, setArrMin] = useState<string>("");
  const [arrMax, setArrMax] = useState<string>("");
  const [kickOffFrom, setKickOffFrom] = useState<string>("");
  const [kickOffTo, setKickOffTo] = useState<string>("");
  const [goLiveFrom, setGoLiveFrom] = useState<string>("");
  const [goLiveTo, setGoLiveTo] = useState<string>("");
  const [expectedGoLiveFrom, setExpectedGoLiveFrom] = useState<string>("");
  const [expectedGoLiveTo, setExpectedGoLiveTo] = useState<string>("");
  const [expectedGoLiveNone, setExpectedGoLiveNone] = useState<boolean>(false);
  const [updatesSearch, setUpdatesSearch] = useState<string>("");
  const [updatesSelectedProject, setUpdatesSelectedProject] = useState<Project | null>(null);
  const reportType = routeState.reportType;
  const reportSubTab = routeState.reportSubTab;
  const settingsSubTab = routeState.settingsSubTab;
  const lastProjectViewRef = useRef<ProjectView>(readLastProjectView());
  useEffect(() => {
    if (routeState.tab !== "projects") return;
    lastProjectViewRef.current = routeState.projectView;
    try { localStorage.setItem(LAST_PROJECT_VIEW_KEY, routeState.projectView); } catch { /* private mode */ }
  }, [routeState.tab, routeState.projectView]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [listEditProject, setListEditProject] = useState<Project | null>(null);
  const [listEditOpen, setListEditOpen] = useState(false);
  const [listAssignProject, setListAssignProject] = useState<Project | null>(null);
  const [listViewDetailsProject, setListViewDetailsProject] = useState<Project | null>(null);
  const [listSortField, setListSortField] = useState<string>("none");
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");

  // Custom field filters (Projects tab + List View)
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string[]>>({});
  const [lvCustomFieldFilters, setLvCustomFieldFilters] = useState<Record<string, string[]>>({});

  // Independent list view filters
  const [lvTeamFilter, setLvTeamFilter] = useState<string[]>([]);
  const [lvOwnerFilter, setLvOwnerFilter] = useState<string[]>([]);
  const [lvPhaseFilter, setLvPhaseFilter] = useState<string[]>([]);
  const [lvStateFilter, setLvStateFilter] = useState<string[]>([]);
  const [lvPlatformFilter, setLvPlatformFilter] = useState<string[]>([]);
  const [lvCategoryFilter, setLvCategoryFilter] = useState<string[]>([]);
  const [lvResponsibilityFilter, setLvResponsibilityFilter] = useState<string[]>([]);
  const [lvFunnelStageFilter, setLvFunnelStageFilter] = useState<string[]>([]);
  const [lvNeedsAttentionOnly, setLvNeedsAttentionOnly] = useState(false);
  const [lvArrMin, setLvArrMin] = useState<string>("");
  const [lvArrMax, setLvArrMax] = useState<string>("");
  const [lvKickOffFrom, setLvKickOffFrom] = useState<string>("");
  const [lvKickOffTo, setLvKickOffTo] = useState<string>("");
  const [lvGoLiveFrom, setLvGoLiveFrom] = useState<string>("");
  const [lvGoLiveTo, setLvGoLiveTo] = useState<string>("");

  // Sidebar expand state for sub-menus
  const [reportsExpanded, setReportsExpanded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // List view column selection
  // Column headers follow the names configured in Settings → Field Labels.
  const LIST_VIEW_COLUMNS = [
    { key: "merchantName", label: getLabel("field_merchant_name") },
    { key: "mid", label: getLabel("field_mid") },
    { key: "platform", label: getLabel("field_platform") },
    { key: "category", label: getLabel("field_category") },
    { key: "merchantState", label: "Merchant State" },
    { key: "mintComment", label: getLabel("field_current_phase_comment") },
    { key: "liveDate", label: getLabel("field_actual_go_live_date") },
    { key: "recentComments", label: "Recent Comments" },
    { key: "status", label: "Status" },
    { key: "projectStage", label: getLabel("field_project_stage") },
    { key: "arr", label: getLabel("field_arr") },
    { key: "owner", label: getLabel("field_assigned_owner") },
    { key: "salesSpoc", label: getLabel("field_sales_spoc") },
    { key: "kickOffDate", label: getLabel("field_kick_off_date") },
    { key: "goLiveDate", label: getLabel("field_go_live_date") },
    { key: "expectedGoLiveDate", label: getLabel("field_expected_go_live_date") },
    { key: "integrationType", label: getLabel("field_integration_type") },
    { key: "pgOnboarding", label: getLabel("field_pg_onboarding") },
    { key: "goLivePercent", label: getLabel("field_go_live_percent") },
    { key: "mintNotes", label: getLabel("field_mint_notes") },
    { key: "projectNotes", label: getLabel("field_project_notes") },
    { key: "opsComment", label: "Ops Comment" },
    { key: "phase2Comment", label: getLabel("field_phase2_comment") },
  ];
  const [listViewColumns, setListViewColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("listview_columns");
      // "needsAttention" was briefly a column of its own. The badge is inline
      // beside the merchant name again, so drop the key from saved
      // arrangements — the header and body both map over this list, and a key
      // with no column left would render an empty one. Only this key is
      // pruned: saved arrangements also hold custom-field keys, which are
      // valid and absent from LIST_VIEW_COLUMNS.
      return saved ? (JSON.parse(saved) as string[]).filter((c) => c !== "needsAttention") : ["merchantName", "platform", "category", "merchantState", "mintComment", "liveDate", "recentComments", "status"];
    } catch { return ["merchantName", "platform", "category", "merchantState", "mintComment", "liveDate", "recentComments", "status"]; }
  });
  const [listViewPage, setListViewPage] = useState(1);
  const [listViewPageSize, setListViewPageSize] = useState(10);

  // Nav visibility from labels
  const getNavVisibility = (): Record<string, boolean> => {
    try {
      const saved = appLabels.nav_visibility;
      if (saved) return JSON.parse(saved);
    } catch {}
    return Object.fromEntries(ALL_NAV_ITEMS.map(k => [k, true]));
  };
  const navVisibility = getNavVisibility();

  // Draggable tab order
  const DEFAULT_TAB_ORDER = ["dashboard", "projects", "risks", "reports", "settings", "emails", "platforms", "golive", "shopify-sme", "shopify-lt-emails"];
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("manager_tab_order");
      const parsed = saved ? JSON.parse(saved) : DEFAULT_TAB_ORDER;
      // Saved orders predate listview/kanban/calendar folding into Projects and
      // checklist/users moving into Settings; map them in place so the first
      // visible entry — and therefore the landing tab — does not shift.
      return normalizeTabOrder(parsed);
    } catch { return DEFAULT_TAB_ORDER; }
  });
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  // AI insights state for inline reports
  const [projectAiInsight, setProjectAiInsight] = useState<string | null>(null);
  const [projectAiLoading, setProjectAiLoading] = useState(false);
  const [teamAiInsight, setTeamAiInsight] = useState<string | null>(null);
  const [teamAiLoading, setTeamAiLoading] = useState(false);

  // Bulk selection state
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkArchiveDialogOpen, setBulkArchiveDialogOpen] = useState(false);
  const [bulkStateDialogOpen, setBulkStateDialogOpen] = useState(false);
  const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
  const [bulkStateValue, setBulkStateValue] = useState<ProjectState>("in_progress");

  // Sort state for projects tab
  const [sortField, setSortField] = useState<string>("none");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Fetch profiles for owner filter
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string; team: string }[]>([]);
  useEffect(() => {
    const fetchProfiles = async () => {
      const { data } = await supabase.from("profiles").select("id, name, team");
      setAllProfiles(data || []);
    };
    fetchProfiles();
  }, []);

  const TAB_CONFIG_KEYS = ["dashboard", "projects", "risks", "reports", "settings", "emails", "platforms", "golive", "shopify-sme", "shopify-lt-emails", "tenants", "archived", "hi-there"];

  // A bare "/" names no tab, so redirect to the first visible one. Match the
  // exact path rather than "no tab resolved": navigating to a page outside the
  // dashboard (a project workspace, say) also resolves to no tab, and this
  // component is still mounted for that render — keying off the tab would
  // redirect to the dashboard instead of letting the new page take over.
  // Visibility comes from LabelsContext, which serves placeholder labels while
  // it loads, so resolving early would pick the wrong tab and redirect twice.
  useEffect(() => {
    if (pathname !== "/" || labelsLoading) return;
    const visibleTabs = [...tabOrder, ...(currentUser?.team === "super_admin" && !tabOrder.includes("tenants") ? ["tenants"] : [])]
      .filter(tab => TAB_CONFIG_KEYS.includes(tab))
      .filter(tab => navVisibility[tab] !== false || tab === "tenants");
    navigate({ to: pathForTab(visibleTabs[0] || "dashboard"), replace: true });
  }, [pathname, labelsLoading, tabOrder, navVisibility, currentUser?.team, navigate]);

  // Calculate project time stats helper - FIXED: uses checklist-level time
  const calculateProjectStats = (project: Project) => {
    const checklistTime = calculateTimeFromChecklist(project.checklist);

    const completedChecklist = project.checklist.filter((c) => c.completed).length;
    const totalChecklist = project.checklist.length;

    return {
      projectTime: checklistTime, // Use checklist-aggregated time as the source of truth
      checklistTime,
      completedChecklist,
      totalChecklist,
      checklistProgress: totalChecklist > 0 ? Math.round((completedChecklist / totalChecklist) * 100) : 0,
    };
  };

  // Merged Project + Checklist Report
  const projectChecklistReport = useMemo(() => {
    return projects.map((project) => {
      const stats = calculateProjectStats(project);
      const mintTasks = project.checklist.filter(c => c.ownerTeam === "mint");
      const integrationTasks = project.checklist.filter(c => c.ownerTeam === "integration");

      const checklistItems = project.checklist.map((item) => {
        const time = calculateTimeByParty(item.responsibilityLog);
        return {
          id: item.id,
          checklistTitle: item.title,
          team: item.ownerTeam,
          phase: item.phase,
          gokwikTime: time.gokwik,
          merchantTime: time.merchant,
          totalTime: time.gokwik + time.merchant,
          completed: item.completed,
          responsibility: item.currentResponsibility,
        };
      });

      return {
        ...project,
        stats,
        mintCompleted: mintTasks.filter(c => c.completed).length,
        mintTotal: mintTasks.length,
        integrationCompleted: integrationTasks.filter(c => c.completed).length,
        integrationTotal: integrationTasks.length,
        checklistItems,
      };
    }).sort((a, b) =>
      (b.stats.projectTime.gokwik + b.stats.projectTime.merchant) -
      (a.stats.projectTime.gokwik + a.stats.projectTime.merchant)
    );
  }, [projects]);

  // Merged Team + Owner Report
  const teamOwnerReport = useMemo(() => {
    const teams: TeamRole[] = ["mint", "integration", "ms"];
    return teams.map((team) => {
      const teamProjects = projects.filter(p => p.currentOwnerTeam === team);
      let teamGokwikTime = 0;
      let teamMerchantTime = 0;
      let teamCompletedTasks = 0;
      let teamTotalTasks = 0;

      teamProjects.forEach((project) => {
        // Count tasks only for this team's checklist items
        project.checklist.forEach((item) => {
          if (item.ownerTeam === team) {
            teamTotalTasks++;
            if (item.completed) teamCompletedTasks++;
          }
        });
        // Sum time from ALL checklist items in the project (not just this team's)
        const projectTime = calculateTimeFromChecklist(project.checklist);
        teamGokwikTime += projectTime.gokwik;
        teamMerchantTime += projectTime.merchant;
      });

      const ownerMap = new Map<string, {
        ownerId: string; ownerName: string; totalProjects: number;
        completedTasks: number; totalTasks: number; gokwikTime: number;
        merchantTime: number; projectNames: string[];
      }>();

      teamProjects.forEach((project) => {
        const ownerId = project.assignedOwner || "unassigned";
        const ownerName = project.assignedOwnerName || "Unassigned";
        const existing = ownerMap.get(ownerId) || {
          ownerId, ownerName, totalProjects: 0, completedTasks: 0,
          totalTasks: 0, gokwikTime: 0, merchantTime: 0, projectNames: [],
        };

        existing.totalProjects++;
        existing.projectNames.push(project.merchantName);
        existing.totalTasks += project.checklist.filter(c => c.ownerTeam === team).length;
        existing.completedTasks += project.checklist.filter(c => c.ownerTeam === team && c.completed).length;

        // Sum time from ALL checklist items (not just this team's)
        const ownerProjectTime = calculateTimeFromChecklist(project.checklist);
        existing.gokwikTime += ownerProjectTime.gokwik;
        existing.merchantTime += ownerProjectTime.merchant;

        ownerMap.set(ownerId, existing);
      });

      return {
        team,
        teamLabel: teamLabels[team],
        projectCount: teamProjects.length,
        pendingCount: teamProjects.filter(p => p.pendingAcceptance).length,
        completedTasks: teamCompletedTasks,
        totalTasks: teamTotalTasks,
        gokwikTime: teamGokwikTime,
        merchantTime: teamMerchantTime,
        owners: Array.from(ownerMap.values()).sort((a, b) => b.totalProjects - a.totalProjects),
      };
    });
  }, [projects]);

  const toggleProjectExpand = (projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) newSet.delete(projectId);
      else newSet.add(projectId);
      return newSet;
    });
  };

  const filteredOwners = useMemo(() => {
    const managerProfiles = allProfiles.filter(p => p.team === "manager");
    if (teamFilter.length === 0) {
      return allProfiles;
    }
    const teamProfiles = allProfiles.filter(p => teamFilter.includes(p.team));
    managerProfiles.forEach(mp => {
      if (!teamProfiles.find(tp => tp.id === mp.id)) {
        teamProfiles.push(mp);
      }
    });
    return teamProfiles;
  }, [allProfiles, teamFilter]);

  // Bulk selection helpers
  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) newSet.delete(projectId);
      else newSet.add(projectId);
      return newSet;
    });
  };

  const toggleSelectAll = (projectIds: string[]) => {
    setSelectedProjects(prev => {
      const allSelected = projectIds.every(id => prev.has(id));
      return allSelected ? new Set() : new Set(projectIds);
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedProjects);
    for (const id of ids) {
      deleteProject(id);
    }
    setSelectedProjects(new Set());
    setBulkDeleteDialogOpen(false);
    toast.success(`Deleted ${ids.length} project(s)`);
  };

  const handleBulkArchive = () => {
    const ids = Array.from(selectedProjects);
    for (const id of ids) {
      archiveProject(id, true);
    }
    setSelectedProjects(new Set());
    setBulkArchiveDialogOpen(false);
    toast.success(`Archived ${ids.length} project(s)`);
  };

  const handleBulkStateUpdate = async () => {
    const ids = Array.from(selectedProjects);
    for (const id of ids) {
      const project = projects.find(p => p.id === id);
      if (project) {
        updateProject({ ...project, projectState: bulkStateValue });
      }
    }
    setSelectedProjects(new Set());
    setBulkStateDialogOpen(false);
    toast.success(`Updated ${ids.length} project(s) to ${stateLabelsFromCtx[bulkStateValue] || projectStateLabels[bulkStateValue]}`);
  };

  const handleBulkEdit = async (updates: Partial<BulkFieldUpdates>, customFieldUpdates?: Record<string, string>) => {
    const ids = Array.from(selectedProjects);
    for (const id of ids) {
      const project = projects.find(p => p.id === id);
      if (!project) continue;
      const patched = { ...project };
      if (updates.projectState !== undefined) patched.projectState = updates.projectState;
      if (updates.platform !== undefined) patched.platform = updates.platform;
      if (updates.category !== undefined) patched.category = updates.category;
      if (updates.arr !== undefined) patched.arr = updates.arr;
      if (updates.txnsPerDay !== undefined) patched.txnsPerDay = updates.txnsPerDay;
      if (updates.aov !== undefined) patched.aov = updates.aov;
      if (updates.salesSpoc !== undefined) patched.salesSpoc = updates.salesSpoc;
      if (updates.integrationType !== undefined) patched.integrationType = updates.integrationType;
      if (updates.pgOnboarding !== undefined) patched.pgOnboarding = updates.pgOnboarding;
      if (updates.goLivePercent !== undefined) patched.goLivePercent = updates.goLivePercent;
      if (updates.brandUrl !== undefined) patched.links = { ...patched.links, brandUrl: updates.brandUrl };
      if (updates.jiraLink !== undefined) patched.links = { ...patched.links, jiraLink: updates.jiraLink };
      if (updates.brdLink !== undefined) patched.links = { ...patched.links, brdLink: updates.brdLink };
      if (updates.mintChecklistLink !== undefined) patched.links = { ...patched.links, mintChecklistLink: updates.mintChecklistLink };
      if (updates.integrationChecklistLink !== undefined) patched.links = { ...patched.links, integrationChecklistLink: updates.integrationChecklistLink };
      if (updates.kickOffDate !== undefined) patched.dates = { ...patched.dates, kickOffDate: updates.kickOffDate };
      if (updates.expectedGoLiveDate !== undefined) patched.dates = { ...patched.dates, expectedGoLiveDate: updates.expectedGoLiveDate };
      if (updates.goLiveDate !== undefined) patched.dates = { ...patched.dates, goLiveDate: updates.goLiveDate };
      if (updates.mintNotes !== undefined) patched.notes = { ...patched.notes, mintNotes: updates.mintNotes };
      if (updates.projectNotes !== undefined) patched.notes = { ...patched.notes, projectNotes: updates.projectNotes };
      if (updates.currentPhaseComment !== undefined) patched.notes = { ...patched.notes, currentPhaseComment: updates.currentPhaseComment };
      if (updates.phase2Comment !== undefined) patched.notes = { ...patched.notes, phase2Comment: updates.phase2Comment };
      updateProject(patched);

      // Save custom field values
      if (customFieldUpdates && Object.keys(customFieldUpdates).length > 0) {
        for (const [fieldId, value] of Object.entries(customFieldUpdates)) {
          const { data: existing } = await supabase
            .from("custom_field_values")
            .select("id")
            .eq("project_id", id)
            .eq("field_id", fieldId)
            .maybeSingle();
          if (existing) {
            await supabase.from("custom_field_values").update({ value }).eq("id", existing.id);
          } else {
            await supabase.from("custom_field_values").insert({
              project_id: id, field_id: fieldId, value, tenant_id: currentUser?.tenantId || null,
            });
          }
        }
      }
    }
    setSelectedProjects(new Set());
    toast.success(`Updated ${ids.length} project(s)`);
  };

  // Helper to get project phase label (next incomplete checklist item from current owner team)
  const getProjectPhaseLabel = (p: Project) => {
    const teamItems = p.checklist.filter(c => c.ownerTeam === p.currentOwnerTeam);
    const nextItem = teamItems.find(c => !c.completed) || p.checklist.find(c => !c.completed);
    return nextItem ? nextItem.title : "All Complete";
  };

  // Collect unique phase labels for filter dropdown
  const uniquePhaseLabels = useMemo(() => {
    const labels = new Set<string>();
    projects.forEach(p => labels.add(getProjectPhaseLabel(p)));
    return Array.from(labels).sort();
  }, [projects]);

  const uniquePlatforms = useMemo(() => {
    const vals = new Set<string>();
    projects.forEach(p => { if (p.platform) vals.add(p.platform); });
    return Array.from(vals).sort();
  }, [projects]);

  const uniqueCategories = useMemo(() => {
    const vals = new Set<string>();
    projects.forEach(p => { if (p.category) vals.add(p.category); });
    return Array.from(vals).sort();
  }, [projects]);

  const lvFilteredOwners = useMemo(() => {
    const managerProfiles = allProfiles.filter(p => p.team === "manager");
    if (lvTeamFilter.length === 0) return allProfiles;
    const teamProfiles = allProfiles.filter(p => lvTeamFilter.includes(p.team));
    managerProfiles.forEach(mp => {
      if (!teamProfiles.find(tp => tp.id === mp.id)) teamProfiles.push(mp);
    });
    return teamProfiles;
  }, [allProfiles, lvTeamFilter]);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Filter projects with new filters
  const filteredProjects = projects.filter((p) => {
    if (p.archived) return false;
    const matchesSearch =
      p.merchantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.mid.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTeam = teamFilter.length === 0 || teamFilter.includes(p.currentOwnerTeam);
    const matchesOwner = ownerFilter.length === 0 || (ownerFilter.includes("unassigned") ? !p.assignedOwner : ownerFilter.includes(p.assignedOwner || ""));
    const matchesPhase = phaseFilter.length === 0 || phaseFilter.includes(getProjectPhaseLabel(p));
    const matchesState = stateFilter.length === 0 || stateFilter.includes(p.projectState);
    const matchesPlatform = platformFilter.length === 0 || platformFilter.includes(p.platform || "");
    const matchesCategory = categoryFilter.length === 0 || categoryFilter.includes(p.category || "");
    const matchesResponsibility = responsibilityFilter.length === 0 || responsibilityFilter.includes(p.currentResponsibility || "");
    const matchesArrMin = !arrMin || arrToCrore(p.arr) >= parseFloat(arrMin);
    const matchesArrMax = !arrMax || arrToCrore(p.arr) <= parseFloat(arrMax);
    const matchesKickOffFrom = !kickOffFrom || p.dates.kickOffDate >= kickOffFrom;
    const matchesKickOffTo = !kickOffTo || p.dates.kickOffDate <= kickOffTo;
    const matchesGoLiveFrom = !goLiveFrom || (p.dates.goLiveDate && p.dates.goLiveDate >= goLiveFrom) || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate >= goLiveFrom);
    const matchesGoLiveTo = !goLiveTo || (p.dates.goLiveDate && p.dates.goLiveDate <= goLiveTo) || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate <= goLiveTo);
    const matchesExpectedGoLiveFrom = !expectedGoLiveFrom || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate >= expectedGoLiveFrom);
    const matchesExpectedGoLiveTo = !expectedGoLiveTo || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate <= expectedGoLiveTo);
    const matchesExpectedGoLiveNone = !expectedGoLiveNone || !p.dates.expectedGoLiveDate;
    const matchesCustomFields = Object.entries(customFieldFilters).every(([fieldId, vals]) => {
      if (!vals || vals.length === 0) return true;
      const v = customValuesMap[p.id]?.[fieldId] || "";
      return vals.includes(v);
    });
    const matchesUnderIntegration = !underIntegrationFilter || isProjectUnderIntegration(p);
    const matchesFunnelStage = funnelStageFilter.length === 0 || funnelStageFilter.includes(getProjectFunnelStage(p));
    return matchesSearch && matchesTeam && matchesOwner && matchesPhase && matchesState && matchesPlatform && matchesCategory && matchesResponsibility && matchesArrMin && matchesArrMax && matchesKickOffFrom && matchesKickOffTo && matchesGoLiveFrom && matchesGoLiveTo && matchesExpectedGoLiveFrom && matchesExpectedGoLiveTo && matchesExpectedGoLiveNone && matchesCustomFields && matchesUnderIntegration && matchesFunnelStage;
  });

  // Stats — filteredProjects already excludes archived (line 538), so always use it
  const displayProjects = filteredProjects;
  // Drill-down popup for clickable dashboard cards
  const totalProjects = displayProjects.length;
  
  const completedProjects = displayProjects.filter((p) => p.projectState === "live").length;
  const activeProjects = displayProjects.filter((p: Project) => p.projectState === "in_progress").length;

  // Time distribution - use checklist-level aggregation
  let totalGokwikTime = 0;
  let totalMerchantTime = 0;
  displayProjects.forEach((p) => {
    const time = calculateTimeFromChecklist(p.checklist);
    totalGokwikTime += time.gokwik;
    totalMerchantTime += time.merchant;
  });

  // Pipeline stats for overview
  const totalArr = displayProjects.reduce((s, p) => s + arrToCrore(p.arr), 0);
  const liveArr = displayProjects.filter(p => p.projectState === "live").reduce((s, p) => s + arrToCrore(p.arr), 0);
  
  const activeArr = displayProjects.filter((p: Project) => p.projectState === "in_progress").reduce((s: number, p: Project) => s + arrToCrore(p.arr), 0);
  const blockedProjects = displayProjects.filter(p => p.projectState === "blocked").length;
  const onHoldProjects = displayProjects.filter(p => p.projectState === "on_hold").length;
  const inProgressNoExpectedGoLive = displayProjects.filter((p: Project) => p.projectState === "in_progress" && !p.dates.expectedGoLiveDate).length;

  const underIntegrationCount = displayProjects.filter((p: Project) => isProjectUnderIntegration(p)).length;

  const handleAddProject = (project: Project) => {
    addProject(project);
    toast.success(`Added ${project.merchantName}`);
  };

  const filteredProjectIds = filteredProjects.map(p => p.id);
  const allFilteredSelected = filteredProjectIds.length > 0 && filteredProjectIds.every(id => selectedProjects.has(id));

  const clearFilters = () => {
    setTeamFilter([]);
    setOwnerFilter([]);
    setPhaseFilter([]);
    setStateFilter([]);
    setPlatformFilter([]);
    setCategoryFilter([]);
    setResponsibilityFilter([]);
    setArrMin("");
    setArrMax("");
    setKickOffFrom("");
    setKickOffTo("");
    setGoLiveFrom("");
    setGoLiveTo("");
    setExpectedGoLiveFrom("");
    setExpectedGoLiveTo("");
    setExpectedGoLiveNone(false);
    setCustomFieldFilters({});
    setUnderIntegrationFilter(false);
    setFunnelStageFilter([]);
  };

  const activeCustomFieldCountTop = Object.values(customFieldFilters).filter(v => v && v.length > 0).length;
  const hasActiveFilters = teamFilter.length > 0 || ownerFilter.length > 0 || phaseFilter.length > 0 || stateFilter.length > 0 || platformFilter.length > 0 || categoryFilter.length > 0 || responsibilityFilter.length > 0 || arrMin || arrMax || kickOffFrom || kickOffTo || goLiveFrom || goLiveTo || expectedGoLiveFrom || expectedGoLiveTo || expectedGoLiveNone || activeCustomFieldCountTop > 0 || underIntegrationFilter || funnelStageFilter.length > 0;

  // Independent list view filtering
  const lvFilteredProjects = projects.filter((p) => {
    if (p.archived) return false;
    const matchesSearch =
      p.merchantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.mid.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTeam = lvTeamFilter.length === 0 || lvTeamFilter.includes(p.currentOwnerTeam);
    const matchesOwner = lvOwnerFilter.length === 0 || (lvOwnerFilter.includes("unassigned") ? !p.assignedOwner : lvOwnerFilter.includes(p.assignedOwner || ""));
    const matchesPhase = lvPhaseFilter.length === 0 || lvPhaseFilter.includes(getProjectPhaseLabel(p));
    const matchesState = lvStateFilter.length === 0 || lvStateFilter.includes(p.projectState);
    const matchesPlatform = lvPlatformFilter.length === 0 || lvPlatformFilter.includes(p.platform || "");
    const matchesCategory = lvCategoryFilter.length === 0 || lvCategoryFilter.includes(p.category || "");
    const matchesResponsibility = lvResponsibilityFilter.length === 0 || lvResponsibilityFilter.includes(p.currentResponsibility || "");
    const matchesArrMin = !lvArrMin || p.arr >= parseFloat(lvArrMin);
    const matchesArrMax = !lvArrMax || p.arr <= parseFloat(lvArrMax);
    const matchesKickOffFrom = !lvKickOffFrom || p.dates.kickOffDate >= lvKickOffFrom;
    const matchesKickOffTo = !lvKickOffTo || p.dates.kickOffDate <= lvKickOffTo;
    const matchesGoLiveFrom = !lvGoLiveFrom || (p.dates.goLiveDate && p.dates.goLiveDate >= lvGoLiveFrom) || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate >= lvGoLiveFrom);
    const matchesGoLiveTo = !lvGoLiveTo || (p.dates.goLiveDate && p.dates.goLiveDate <= lvGoLiveTo) || (p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate <= lvGoLiveTo);
    const matchesCustomFields = Object.entries(lvCustomFieldFilters).every(([fieldId, vals]) => {
      if (!vals || vals.length === 0) return true;
      const v = customValuesMap[p.id]?.[fieldId] || "";
      return vals.includes(v);
    });
    const matchesFunnelStage = lvFunnelStageFilter.length === 0 || lvFunnelStageFilter.includes(getProjectFunnelStage(p));
    const matchesNeedsAttention = !lvNeedsAttentionOnly || riskVerdicts[p.id]?.level === "high";
    return matchesSearch && matchesTeam && matchesOwner && matchesPhase && matchesState && matchesPlatform && matchesCategory && matchesResponsibility && matchesArrMin && matchesArrMax && matchesKickOffFrom && matchesKickOffTo && matchesGoLiveFrom && matchesGoLiveTo && matchesCustomFields && matchesFunnelStage && matchesNeedsAttention;
  });

  const clearLvFilters = () => {
    setLvTeamFilter([]);
    setLvOwnerFilter([]);
    setLvPhaseFilter([]);
    setLvStateFilter([]);
    setLvPlatformFilter([]);
    setLvCategoryFilter([]);
    setLvResponsibilityFilter([]);
    setLvArrMin("");
    setLvArrMax("");
    setLvKickOffFrom("");
    setLvKickOffTo("");
    setLvGoLiveFrom("");
    setLvGoLiveTo("");
    setLvCustomFieldFilters({});
    setLvFunnelStageFilter([]);
    setLvNeedsAttentionOnly(false);
  };

  const lvFilteredProjectIds = lvFilteredProjects.map((project) => project.id);
  const allLvFilteredSelected = lvFilteredProjectIds.length > 0 && lvFilteredProjectIds.every((id) => selectedProjects.has(id));

  const lvActiveCustomFieldCount = Object.values(lvCustomFieldFilters).filter(v => v && v.length > 0).length;
  const activeCustomFieldCount = Object.values(customFieldFilters).filter(v => v && v.length > 0).length;
  const lvHasActiveFilters = lvTeamFilter.length > 0 || lvOwnerFilter.length > 0 || lvPhaseFilter.length > 0 || lvStateFilter.length > 0 || lvPlatformFilter.length > 0 || lvCategoryFilter.length > 0 || lvResponsibilityFilter.length > 0 || lvArrMin || lvArrMax || lvKickOffFrom || lvKickOffTo || lvGoLiveFrom || lvGoLiveTo || lvActiveCustomFieldCount > 0 || lvFunnelStageFilter.length > 0 || lvNeedsAttentionOnly;


  // Tab config for sidebar
  const TAB_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
    dashboard: { icon: <PieChart className="h-4 w-4" />, label: "Dashboard" },
    projects: { icon: <FolderKanban className="h-4 w-4" />, label: "Projects" },
    listview: { icon: <List className="h-4 w-4" />, label: "List View" },
    calendar: { icon: <CalendarDays className="h-4 w-4" />, label: "Calendar" },
    reports: { icon: <TrendingUp className="h-4 w-4" />, label: "Reports" },
    checklist: { icon: <ListChecks className="h-4 w-4" />, label: "Checklist" },
    users: { icon: <Users className="h-4 w-4" />, label: "Users" },
    settings: { icon: <Settings className="h-4 w-4" />, label: "Settings" },
    risks: { icon: <ShieldAlert className="h-4 w-4" />, label: "Risks" },
    kanban: { icon: <FolderKanban className="h-4 w-4" />, label: "Kanban" },
    emails: { icon: <Mail className="h-4 w-4" />, label: "Emails" },
    tenants: { icon: <Building2 className="h-4 w-4" />, label: "Tenants" },
    archived: { icon: <Archive className="h-4 w-4" />, label: "Archived" },
    platforms: { icon: <Server className="h-4 w-4" />, label: "Platforms" },
    golive: { icon: <CalendarDays className="h-4 w-4" />, label: "Go-Live Tracker" },
    "shopify-sme": { icon: <ShoppingBag className="h-4 w-4" />, label: "Shopify SME and Ent" },
    "shopify-lt-emails": { icon: <Mail className="h-4 w-4" />, label: "Shopify LT Integration Email Communication" },
    "hi-there": { icon: <span className="animate-wave text-base leading-none">👋</span>, label: "Buddy" },
  };

  const SETTINGS_SUB_CONFIG: Record<string, { label: string }> = {
    general: { label: "General" },
    fields: { label: "Field Labels" },
    "custom-fields": { label: "Custom Fields" },
    "checklist-forms": { label: "Checklist Forms" },
    checklist: { label: "Checklist" },
    users: { label: "Users" },
    colours: { label: "Colours" },
    email: { label: "Add New Projects" },
    workflows: { label: "AI Workflows" },
    "pivot-table": { label: "Pivot Table" },
    funnel: { label: "Project Stages" },
    "risk-rules": { label: "Risk Rules" },
    "activity-log": { label: "Activity Log" },
    "slack-alerts": { label: "Slack Alerts" },
    integrations: { label: "Integrations" },
    navigation: { label: "Navigation" },
  };

  const REPORTS_SUB_CONFIG: Record<string, { label: string; icon?: string }> = {
    predefined: { label: "Pre Defined" },
    builder: { label: "Report Builder" },
    scheduler: { label: "Scheduler" },
    "pivot-table": { label: "Pivot Table" },
    sandbox: { label: "Sandbox Testing" },
    "portal-visits": { label: "Portal Visits" },
    "daily-report": { label: "Daily Report" },
    "weekly-report": { label: "Weekly Report" },
  };

  const handleTabDragStart = (tab: string) => setDraggedTab(tab);
  const handleTabDragOver = (e: React.DragEvent, targetTab: string) => {
    e.preventDefault();
    if (!draggedTab || draggedTab === targetTab) return;
    setTabOrder(prev => {
      const newOrder = [...prev];
      const fromIdx = newOrder.indexOf(draggedTab);
      const toIdx = newOrder.indexOf(targetTab);
      if (fromIdx === -1 || toIdx === -1) return prev;
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, draggedTab);
      return newOrder;
    });
  };
  const handleTabDragEnd = () => {
    setDraggedTab(null);
    // Read through the setter: `tabOrder` here is the value from the render that
    // registered this handler, so the last drop would otherwise not be saved.
    setTabOrder((current) => {
      localStorage.setItem("manager_tab_order", JSON.stringify(current));
      return current;
    });
  };

  const handleColDragStart = (col: string) => setDraggedCol(col);
  const handleColDragOver = (targetCol: string) => {
    if (!draggedCol || draggedCol === targetCol) return;
    setListViewColumns((prev: string[]) => {
      const newCols = [...prev];
      const fromIdx = newCols.indexOf(draggedCol);
      const toIdx = newCols.indexOf(targetCol);
      if (fromIdx === -1 || toIdx === -1) return prev;
      newCols.splice(fromIdx, 1);
      newCols.splice(toIdx, 0, draggedCol);
      return newCols;
    });
  };
  const handleColDragEnd = (cols: string[]) => {
    setDraggedCol(null);
    localStorage.setItem("listview_columns", JSON.stringify(cols));
  };

  const handleNavToggle = async (navKey: string, enabled: boolean) => {
    const current = getNavVisibility();
    current[navKey] = enabled;
    await updateLabels({ nav_visibility: JSON.stringify(current) });
  };

  const fetchProjectAiInsight = async () => {
    setProjectAiLoading(true);
    try {
      const topProjects = projectChecklistReport.slice(0, 10).map(p => `${p.merchantName}: ${p.stats.completedChecklist}/${p.stats.totalChecklist} tasks, ${formatDuration(p.stats.projectTime.gokwik + p.stats.projectTime.merchant)} total`).join("; ");
      const result = await fetchAiInsights({
        type: "insights",
        project: {
          merchantName: `Project & Checklist Summary: ${projects.length} total projects. Top by time: ${topProjects}`,
          mid: "PCR",
          currentPhase: "overview",
          projectState: "overview",
          arr: 0,
          platform: "All",
          dates: { kickOffDate: "N/A" },
          currentOwnerTeam: "All",
          currentResponsibility: "N/A",
          checklist: [],
          transferHistory: [],
        },
      });
      setProjectAiInsight(result);
    } catch {
      setProjectAiInsight("Failed to generate AI insights.");
    } finally {
      setProjectAiLoading(false);
    }
  };

  const fetchTeamAiInsight = async () => {
    setTeamAiLoading(true);
    try {
      const teamSummary = teamOwnerReport.map(t => `${t.teamLabel}: ${t.projectCount} projects, ${t.completedTasks}/${t.totalTasks} tasks, ${t.owners.length} owners`).join("; ");
      const result = await fetchAiInsights({
        type: "insights",
        project: {
          merchantName: `Team & Owner Summary: ${teamSummary}`,
          mid: "TOR",
          currentPhase: "overview",
          projectState: "overview",
          arr: 0,
          platform: "All",
          dates: { kickOffDate: "N/A" },
          currentOwnerTeam: "All",
          currentResponsibility: "N/A",
          checklist: [],
          transferHistory: [],
        },
      });
      setTeamAiInsight(result);
    } catch {
      setTeamAiInsight("Failed to generate AI insights.");
    } finally {
      setTeamAiLoading(false);
    }
  };

  const isGokwikGeneral = currentUser?.team === "gokwik_general";
  // listview/kanban used to be separate nav entries; both are Projects views now.
  const GOKWIK_GENERAL_TABS = ["dashboard", "projects", "reports"];

  const isManagerOrAdmin = perms.isManagerOrAbove;
  const sidebarTabs = [
    ...tabOrder,
    ...(currentUser?.team === "super_admin" && !tabOrder.includes("tenants") ? ["tenants"] : []),
    ...(isManagerOrAdmin && !tabOrder.includes("archived") ? ["archived"] : []),
    ...(!tabOrder.includes("platforms") ? ["platforms"] : []),
    ...(!tabOrder.includes("golive") ? ["golive"] : []),
    ...(!tabOrder.includes("shopify-sme") ? ["shopify-sme"] : []),
    ...(!tabOrder.includes("shopify-lt-emails") ? ["shopify-lt-emails"] : []),
    ...(!tabOrder.includes("hi-there") ? ["hi-there"] : []),
  ]
    .filter(tab => !["listview", "kanban", "calendar", "checklist", "users"].includes(tab))
    .filter(tab => tab !== "tenants" || currentUser?.team === "super_admin")
    .filter(tab => tab !== "archived" || isManagerOrAdmin)
    .filter(tab => TAB_CONFIG[tab])
    .filter(tab => navVisibility[tab] !== false || tab === "tenants" || tab === "settings" || tab === "archived")
    .filter(tab => !isGokwikGeneral || GOKWIK_GENERAL_TABS.includes(tab) || tab === "hi-there");

  const openProjectView = (view: ProjectView) => {
    navigate({ to: projectViewPath(view) });
  };

  // Leaving Projects for another tab drops the view from the URL, so remember it
  // and restore it when the user comes back.
  const openTab = (tab: string) => {
    if (tab === "projects") return openProjectView(lastProjectViewRef.current);
    navigate({ to: pathForTab(tab) });
  };

  // Render a single nav item
  const renderNavItem = (tab: string) => {
    const isReports = tab === "reports";
    const isSettings = tab === "settings";
    const isActive = activeTab === tab;
    const isParentActive = isActive || (isReports && reportsExpanded) || (isSettings && settingsExpanded);

    return (
      <div key={tab}>
        <button
          onClick={() => {
            if (isReports) {
              setReportsExpanded(!reportsExpanded);
              if (!reportsExpanded) { openTab("reports"); }
            } else if (isSettings) {
              setSettingsExpanded(!settingsExpanded);
              if (!settingsExpanded) { openTab("settings"); }
            } else {
              openTab(tab);
            }
          }}
          draggable
          onDragStart={() => handleTabDragStart(tab)}
          onDragOver={(e) => handleTabDragOver(e, tab)}
          onDragEnd={handleTabDragEnd}
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 text-left group",
            isActive && !isReports && !isSettings
              ? "gradient-primary text-primary-foreground shadow-[var(--shadow-soft)]"
              : isParentActive
              ? "bg-primary/20 text-sidebar-foreground font-semibold"
              : "hover:bg-sidebar-accent/60 text-sidebar-foreground",
            draggedTab === tab ? "opacity-50" : ""
          )}
        >
          <span className={cn(
            "flex items-center justify-center h-7 w-7 rounded-md shrink-0 transition-colors",
            isActive && !isReports && !isSettings
              ? "bg-primary-foreground/20 text-primary-foreground"
              : isParentActive
              ? "bg-primary/10 text-primary"
              : "bg-sidebar-accent text-sidebar-foreground group-hover:text-sidebar-foreground"
          )}>
            {TAB_CONFIG[tab].icon}
          </span>
          <span className="font-medium text-sm flex-1">{TAB_CONFIG[tab].label}</span>
          {(isReports || isSettings) && (
            <ChevronDown className={cn(
              "h-4 w-4 transition-transform duration-200",
              (isReports ? reportsExpanded : settingsExpanded) ? "rotate-180" : ""
            )} />
          )}
        </button>

        {/* Reports sub-menu */}
        {isReports && reportsExpanded && (
          <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-sidebar-border/60 pl-2">
            {Object.entries(REPORTS_SUB_CONFIG).filter(([key]) => navVisibility[`reports:${key}`] !== false).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => navigate({ to: pathForTab("reports", { reportSubTab: key, reportType }) })}
                className={cn(
                  "w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150",
                  reportSubTab === key && activeTab === "reports"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                )}
              >
                {cfg.icon && <span className="text-base">{cfg.icon}</span>}
                {cfg.label}
              </button>
            ))}
          </div>
        )}

        {/* Settings sub-menu */}
        {isSettings && settingsExpanded && (
          <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-sidebar-border/60 pl-2">
            {Object.entries(SETTINGS_SUB_CONFIG).filter(([key]) => (key === "navigation" || navVisibility[`settings:${key}`] !== false) && (!ADMIN_ONLY_SETTINGS.includes(key) || perms.canManageUsers)).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => navigate({ to: pathForTab("settings", { settingsSubTab: key }) })}
                className={cn(
                  "w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150",
                  settingsSubTab === key && activeTab === "settings"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-[hsl(var(--surface-2))] text-foreground flex">
      {/* Left Sidebar — collapsible */}
      <aside className={cn(
        "bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-all duration-300 relative",
        sidebarCollapsed ? "w-16" : "w-[212px]"
      )}>
        {/* Logo & Title */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            {appLabels.org_logo_url ? (
              <img src={appLabels.org_logo_url} alt="Logo" className={cn("rounded-xl object-contain shadow-lg ring-2 ring-primary/20", sidebarCollapsed ? "h-8 w-8" : "h-12 w-12")} />
            ) : (
              <div className={cn("rounded-xl gradient-primary flex items-center justify-center shadow-[var(--shadow-soft)]", sidebarCollapsed ? "h-8 w-8" : "h-11 w-11")}>
                <BarChart3 className={cn(sidebarCollapsed ? "h-4 w-4" : "h-5 w-5", "text-primary-foreground")} />
              </div>
            )}
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <h1 className="font-semibold text-[16px] leading-tight text-sidebar-foreground truncate">{appLabels.app_title}</h1>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 [&_button]:text-sidebar-foreground/70 [&_button:hover]:text-sidebar-foreground">
                  <button
                    type="button"
                    onClick={() => setSearchOpen((o) => !o)}
                    title="Search projects"
                    aria-label="Search projects"
                    aria-expanded={searchOpen}
                    className={cn(
                      "rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/60",
                      searchOpen || searchQuery ? "!text-primary" : "",
                    )}
                  >
                    <Search className="h-4 w-4" />
                  </button>
                  <NotificationCenter />
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(true)}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                    className="rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/60"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Collapsed rail: the same three, stacked, since 16 columns cannot
              hold them in a row. */}
          {sidebarCollapsed && (
            <div className="mt-3 flex flex-col items-center gap-1 [&_button]:text-sidebar-foreground/70 [&_button:hover]:text-sidebar-foreground">
              <button
                type="button"
                onClick={() => { setSidebarCollapsed(false); setSearchOpen(true); }}
                title="Search projects"
                aria-label="Search projects"
                className="rounded-md p-2 transition-colors hover:bg-sidebar-accent/60"
              >
                <Search className="h-4 w-4" />
              </button>
              <NotificationCenter />
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="rounded-md p-2 transition-colors hover:bg-sidebar-accent/60"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Revealed by the icon above. Kept mounted only while open so the
            sidebar stays compact, but the query itself survives closing. */}
        {!sidebarCollapsed && searchOpen && (
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50" />
              <Input
                autoFocus
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); } }}
                className="h-8 border-sidebar-border bg-sidebar-accent/40 pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2 pb-2 pt-8 overflow-y-auto">
          <div className="space-y-0.5">
            {sidebarTabs.map((tab) => sidebarCollapsed ? (
              <button
                key={tab}
                onClick={() => openTab(tab)}
                className={cn(
                  "w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-200",
                  activeTab === tab
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground"
                )}
                title={TAB_CONFIG[tab]?.label}
              >
                {TAB_CONFIG[tab]?.icon}
              </button>
            ) : renderNavItem(tab))}

          </div>
        </nav>

        {/* Account — the avatar opens everything else: identity, theme and
            logout, so the sidebar itself stays down to navigation. */}
        <div className="p-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={`${currentUser?.name} — ${teamLabels[currentUser?.team ?? ""] || "Manager"}`}
                aria-label="Account"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg p-1 transition-colors hover:bg-sidebar-accent/60",
                  sidebarCollapsed && "justify-center",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm">
                  {currentUser?.name.charAt(0)}
                </span>
                {!sidebarCollapsed && (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-xs font-medium leading-tight text-sidebar-foreground">{currentUser?.name}</span>
                    <span className="block text-[10px] leading-tight text-sidebar-foreground/60">{teamLabels[currentUser?.team ?? ""] || "Manager"}</span>
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-56 p-1.5">
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium text-foreground">{currentUser?.name}</p>
                <p className="truncate text-xs text-muted-foreground">{teamLabels[currentUser?.team ?? ""] || "Manager"}</p>
              </div>
              {/* Workspaces this person has been granted. Their way in — the
                  grant alone does not move them anywhere. */}
              {myAccess.length > 0 && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">Support access</p>
                  {myAccess.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => enterTenant.mutate(g.tenant_id)}
                      disabled={g.tenant_id === currentUser?.supportTenantId}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
                      <span className="min-w-0 flex-1 truncate">
                        {g.tenants?.name || "Workspace"}
                      </span>
                      {g.tenant_id === currentUser?.supportTenantId && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">in</span>
                      )}
                    </button>
                  ))}
                </>
              )}
              <div className="my-1 h-px bg-border" />
              <div className="flex items-center justify-between rounded-md px-2 py-1 text-sm text-foreground">
                <span>Theme</span>
                <ThemeToggle />
              </div>
              <button
                type="button"
                onClick={logout}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </PopoverContent>
          </Popover>
        </div>

      </aside>

      {/* Main Content */}
      <main className="flex-1 flex min-h-0 flex-col min-w-0">

        {/* Content Area — the projects tab fills the viewport and scrolls
            inside its board/tables; every other tab scrolls the page. */}
        <div className={cn("min-h-0 flex-1 app-shell-surface", (activeTab === "projects" || activeTab === "hi-there") ? "flex flex-col overflow-hidden" : "overflow-auto")}>
          <div className={cn("p-4 sm:p-6", (activeTab === "projects" || activeTab === "hi-there") && "flex min-h-0 flex-1 flex-col")}>

          {activeTab === "projects" && (
            // One centred row: the view tabs and that view's own controls sit
            // together on a single centre line, with no divider under them. The
            // active tab is a filled pill rather than an underline, which needs
            // a baseline to read against.
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-1" role="tablist" aria-label="Project views">
                {[
                  { value: "kanban", label: "Kanban", icon: <GripVertical className="h-3.5 w-3.5" /> },
                  { value: "list", label: "List", icon: <List className="h-3.5 w-3.5" /> },
                  { value: "golive", label: "Go-Live Tracker", icon: <CalendarDays className="h-3.5 w-3.5" /> },
                ].map(({ value, label, icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={projectView === value}
                     onClick={() => openProjectView(value as "kanban" | "list" | "golive")}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                      projectView === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
              <div ref={setProjectToolbarHost} className="flex flex-wrap items-center gap-2" />
              {/* Project-wide actions, icon-only to keep the row on one line.
                  They used to sit in the global bar and so were reachable from
                  every tab; they belong with the projects they act on. */}
              {!isGokwikGeneral && (
                <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                  <Button
                    onClick={() => exportProjectsToCSV(projects, { teamLabels, stateLabels: stateLabelsFromCtx, responsibilityLabels, getLabel: (k: string) => appLabels[k] || k }, { fields: customFields, valuesMap: customValuesMap })}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title="Export CSV"
                    aria-label="Export CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => setCsvDialogOpen(true)}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title="Import CSV"
                    aria-label="Import CSV"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => setAddDialogOpen(true)}
                    size="icon"
                    className="h-8 w-8"
                    title="Add project"
                    aria-label="Add project"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}


          {/* ========= OVERVIEW TAB ========= */}
          {/* items-stretch so the two half-width dashlets match each other's height */}
          {activeTab === "dashboard" && <div className="mx-auto max-w-[1500px]">
            {(() => {
              // Each dashboard section is a named slot so the order can be
              // rearranged and remembered; see useDashletOrder.
              const dashlets: Record<string, React.ReactNode> = {
                kpi: (() => {
                  const stateBoxes: Array<{ key: string; state: ProjectState; icon: typeof AlertCircle; tone: string }> = [
                    { key: "not_started", state: "not_started", icon: FolderKanban, tone: "bg-muted text-foreground/70" },
                    { key: "in_progress", state: "in_progress", icon: Rocket, tone: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
                    { key: "on_hold", state: "on_hold", icon: Clock, tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
                    { key: "blocked", state: "blocked", icon: ShieldAlert, tone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
                    { key: "live", state: "live", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
                  ];
                  const kpiItems: KpiBoxItem[] = [
                    {
                      key: "all",
                      label: "All projects",
                      value: totalProjects,
                      sub: `Pipeline ${arrLabel}: ${totalArr.toFixed(2)} Cr`,
                      icon: FolderKanban,
                      tone: "bg-muted text-foreground/70",
                      onClick: () => setDrillDown({ title: "All projects", projects: displayProjects }),
                    },
                    ...stateBoxes.map(({ key, state, icon, tone }) => {
                      const list = displayProjects.filter(p => p.projectState === state);
                      const label = stateLabelsFromCtx[state] || projectStateLabels[state];
                      const atRisk = list.filter(p => riskVerdicts[p.id]?.level === "high");
                      return {
                        key,
                        label: state === "in_progress" ? "In Progress" : label,
                        value: list.length,
                        sub: `${arrLabel}: ${list.reduce((s, p) => s + arrToCrore(p.arr), 0).toFixed(2)} Cr`,
                        icon,
                        tone,
                        onClick: () => setDrillDown({ title: label, description: "Project state", projects: list }),
                        attentionCount: atRisk.length,
                        onAttentionClick: () => setDrillDown({ title: `${label} — needs attention`, projects: atRisk }),
                      } satisfies KpiBoxItem;
                    }),
                  ];
                  return <KpiBar items={kpiItems} storageKey="manager_dashboard_kpi_order" />;
                })(),

                workload: (
                  <section className="flex h-full min-h-[16rem] flex-col rounded-lg border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Team workload</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">Current project ownership and completion status</p>
                      </div>
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                        {teamOwnerReport.map((team) => {
                          const teamProjects = displayProjects.filter(p => p.currentOwnerTeam === team.team);
                          const totalCount = teamProjects.length;
                          const pendingCount = teamProjects.filter(p => p.pendingAcceptance).length;
                          const isTeamCompleted = (p: Project) => {
                            const teamItems = p.checklist.filter(c => c.ownerTeam === team.team);
                            return teamItems.length > 0 && teamItems.every(c => c.completed);
                          };
                          const completedCount = teamProjects.filter(isTeamCompleted).length;
                          const activeCount = totalCount - pendingCount - completedCount;
                          const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                          const teamNeedsAttention = teamProjects.filter(p => riskVerdicts[p.id]?.level === "high");
                          const miniCards = [
                            { label: "active", value: activeCount, tone: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300", list: teamProjects.filter(p => !p.pendingAcceptance && !isTeamCompleted(p)) },
                            { label: "pending", value: pendingCount, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", list: teamProjects.filter(p => p.pendingAcceptance) },
                            { label: "complete", value: completedCount, tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", list: teamProjects.filter(isTeamCompleted) },
                          ];
                          return (
                            <div key={team.team} className="grid gap-3 px-4 py-2.5 md:grid-cols-[minmax(150px,0.8fr)_minmax(200px,1.1fr)_84px] md:items-center">
                              <div className="flex items-center gap-2.5">
                                <div className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                                  team.team === "mint" && "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
                                  team.team === "integration" && "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
                                  team.team === "ms" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
                                )}>
                                  {team.teamLabel.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="text-xs font-semibold text-foreground">{team.teamLabel}</p>
                                    {teamNeedsAttention.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setDrillDown({
                                          title: `${team.teamLabel} — needs attention`,
                                          description: `${teamNeedsAttention.length} of ${totalCount} need attention`,
                                          projects: teamNeedsAttention,
                                        })}
                                        className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
                                      >
                                        {teamNeedsAttention.length} needs attention
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">{totalCount} owned projects</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5 text-center">
                                {miniCards.map(mc => (
                                  <div
                                    key={mc.label}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setDrillDown({ title: `${team.teamLabel} · ${mc.label}`, projects: mc.list })}
                                    className={cn("cursor-pointer rounded-md px-1.5 py-1.5 transition-opacity hover:opacity-80", mc.tone)}
                                  >
                                    <p className="text-sm font-semibold leading-tight">{mc.value}</p>
                                    <p className="text-[10px] opacity-80">{mc.label}</p>
                                  </div>
                                ))}
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setDrillDown({ title: `${team.teamLabel} · all`, projects: teamProjects })}
                                className="cursor-pointer md:text-right"
                              >
                                <p className="text-base font-semibold leading-tight text-foreground">{completionRate}%</p>
                                <p className="text-[11px] text-muted-foreground">completion</p>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <ProjectDetailsDialog
                      project={updatesSelectedProject}
                      open={!!updatesSelectedProject}
                      onOpenChange={open => { if (!open) setUpdatesSelectedProject(null); }}
                    />
                  </section>
                ),
                tat: <TATDashlet projects={displayProjects} />,
                attention: <AttentionRequiredDashlet />,
                egl: <EglRiskDashlet />,
                stages: (
                  <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Delivery stages</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">Where active project work is concentrated</p>
                      </div>
                      <BarChart3 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                        {(() => {
                          // Group projects by next incomplete checklist item title (from current owner team first)
                          const phaseGroups: Record<string, Project[]> = {};
                          displayProjects.forEach(p => {
                            const teamItems = p.checklist.filter(c => c.ownerTeam === p.currentOwnerTeam);
                            const nextItem = teamItems.find(c => !c.completed) || p.checklist.find(c => !c.completed);
                            const label = nextItem ? nextItem.title : "All Complete";
                            (phaseGroups[label] = phaseGroups[label] || []).push(p);
                          });
                          const sorted = Object.entries(phaseGroups).sort((a, b) => b[1].length - a[1].length);
                          return sorted.map(([label, list]) => {
                            const count = list.length;
                            const pct = totalProjects > 0 ? Math.round((count / totalProjects) * 100) : 0;
                            return (
                              <div
                                key={label}
                                role="button"
                                tabIndex={0}
                                onClick={() => setDrillDown({ title: label, description: "Next pending checklist item", projects: list })}
                                className="cursor-pointer space-y-1 rounded-md p-1 hover:bg-muted/50"
                              >
                                <div className="flex items-center justify-between text-xs">
                                  <span className="max-w-[70%] truncate font-medium text-foreground/80" title={label}>{label}</span>
                                  <span className="whitespace-nowrap text-[11px] font-semibold text-foreground">{count} · {pct}%</span>
                                </div>
                                <Progress value={pct} className="h-1.5" />
                              </div>
                            );
                          });
                        })()}
                    </div>
                  </section>
                ),
                health: (
                  <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Delivery health</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">Project state distribution across the portfolio</p>
                      </div>
                      <Settings className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                        {(Object.keys(projectStateLabels) as ProjectState[]).map(state => {
                          const stateList = displayProjects.filter(p => p.projectState === state);
                          const count = stateList.length;
                          const pct = totalProjects > 0 ? Math.round((count / totalProjects) * 100) : 0;
                          return (
                            <div
                              key={state}
                              role="button"
                              tabIndex={0}
                              onClick={() => setDrillDown({ title: stateLabelsFromCtx[state] || projectStateLabels[state], description: "Project state", projects: stateList })}
                              className="cursor-pointer space-y-1 rounded-md p-1 hover:bg-muted/50"
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-foreground/80">{stateLabelsFromCtx[state] || projectStateLabels[state]}</span>
                                <span className="text-[11px] font-semibold text-foreground">{count} · {pct}%</span>
                              </div>
                              <Progress value={pct} className="h-1.5" />
                            </div>
                          );
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
                    projects={displayProjects}
                    onDrillDown={(title, list) => setDrillDown({ title, projects: list })}
                  />
                );
              });
              const dashletLabels: Record<string, string> = {
                kpi: "KPI bar",
                workload: "Team workload",
                tat: "TAT",
                attention: "Attention required",
                egl: "Projects at risk of missing EGL",
                stages: "Delivery stages",
                health: "Delivery health",
                ...Object.fromEntries(customDashlets.map((c) => [c.id, c.title])),
              };
              const builderItems = dashletOrder.filter((id) => dashletLabels[id]).map((id) => ({ id, label: dashletLabels[id]! }));
              // The KPI bar and Team workload span the full width; every other
              // section is a half-width dashlet. Everything stacks below lg.
              return (
                <>
                  <div className="mb-3 flex justify-end">
                    <DashletBuilder
                      items={builderItems}
                      hidden={hiddenDashlets}
                      onToggle={toggleDashletHidden}
                      custom={customDashlets}
                      onAddCustom={addCustomDashlet}
                      onRemoveCustom={removeCustomDashlet}
                    />
                  </div>
                  <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
                    {visibleDashletOrder.map((id) => dashlets[id] ? (
                      <DashletSlot
                        key={id}
                        className={id === "kpi" || id === "workload" ? "lg:col-span-2" : "lg:col-span-1"}
                        isDragging={draggingDashlet === id}
                        onDragStart={() => onDashletDragStart(id)}
                        onDragOver={() => onDashletDragOver(id)}
                        onDragEnd={onDashletDragEnd}
                      >
                        {dashlets[id]}
                      </DashletSlot>
                    ) : null)}
                  </div>
                </>
              );

            })()}

            <ProjectListDialog
              title={drillDown?.title || ""}
              description={drillDown?.description}
              projects={drillDown?.projects || []}
              open={!!drillDown}
              onOpenChange={(o) => { if (!o) setDrillDown(null); }}
            />
          </div>}


          {/* ========= LIST VIEW TAB ========= */}
          {activeTab === "projects" && projectView === "list" && <div className="flex min-h-0 flex-1 flex-col">
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm border-border">
              {projectToolbarHost ? createPortal(<CardHeader className="w-full border-0 bg-transparent p-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 relative">
                    {/* Sort Dropdown - left side */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <ToolbarIconButton icon={<ArrowUpDown className="h-3.5 w-3.5" />} label="Sort" count={listSortField !== "none" ? 1 : 0} />
                      </PopoverTrigger>
                      <PopoverContent align="start" className={TOOLBAR_POPOVER.sort}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold">Sort by</p>
                          {listSortField !== "none" && (
                            <Button variant="ghost" size="sm" onClick={() => { setListSortField("none"); setListSortDir("asc"); }} className="text-xs h-7">Clear</Button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground font-medium">Field</label>
                            <Select value={listSortField} onValueChange={setListSortField}>
                              <SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="merchantName">Merchant Name</SelectItem>
                                <SelectItem value="arr">{arrLabel}</SelectItem>
                                <SelectItem value="platform">Platform</SelectItem>
                                <SelectItem value="kickOffDate">Start Date</SelectItem>
                                <SelectItem value="owner">Owner</SelectItem>
                                <SelectItem value="status">Status</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground font-medium">Direction</label>
                            <Select value={listSortDir} onValueChange={(v) => setListSortDir(v as "asc" | "desc")}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="asc">Ascending</SelectItem>
                                <SelectItem value="desc">Descending</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    {/* Filters - left side */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <ToolbarIconButton icon={<Filter className="h-3.5 w-3.5" />} label="Filters" count={[lvTeamFilter.length > 0, lvOwnerFilter.length > 0, lvPhaseFilter.length > 0, lvStateFilter.length > 0, lvKickOffFrom, lvKickOffTo, lvGoLiveFrom, lvGoLiveTo, lvNeedsAttentionOnly].filter(Boolean).length} />
                      </PopoverTrigger>
                      <PopoverContent align="start" collisionPadding={16} className={TOOLBAR_POPOVER.filters} style={TOOLBAR_PANEL_MAX_H}>
                        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
                          <p className="text-xs font-semibold">Filters</p>
                          {lvHasActiveFilters && (
                            <Button variant="ghost" size="sm" onClick={clearLvFilters} className="h-6 text-[11px] gap-1"><X className="h-3 w-3" /> Reset</Button>
                          )}
                        </div>
                        <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-2.5">
                        <label className="flex items-center gap-2 cursor-pointer border-b pb-2">
                          <input
                            type="checkbox"
                            checked={lvNeedsAttentionOnly}
                            onChange={(e) => setLvNeedsAttentionOnly(e.target.checked)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="text-xs text-muted-foreground">Needs attention only</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: "Team", values: lvTeamFilter, setter: setLvTeamFilter, options: [{ value: "mint", label: teamLabels.mint }, { value: "integration", label: teamLabels.integration }, { value: "ms", label: teamLabels.ms }] },
                            { label: "Owner", values: lvOwnerFilter, setter: setLvOwnerFilter, options: [{ value: "unassigned", label: "None (Unassigned)" }, ...lvFilteredOwners.map(o => ({ value: o.id, label: o.name }))] },
                            { label: "State", values: lvStateFilter, setter: setLvStateFilter, options: (Object.keys(projectStateLabels) as ProjectState[]).map(s => ({ value: s, label: stateLabelsFromCtx[s] || projectStateLabels[s] })) },
                            { label: "Platform", values: lvPlatformFilter, setter: setLvPlatformFilter, options: uniquePlatforms.map(p => ({ value: p, label: p })) },
                            { label: "Category", values: lvCategoryFilter, setter: setLvCategoryFilter, options: uniqueCategories.map(c => ({ value: c, label: c })) },
                            { label: "Responsibility", values: lvResponsibilityFilter, setter: setLvResponsibilityFilter, options: [{ value: "gokwik", label: responsibilityLabels.gokwik }, { value: "merchant", label: responsibilityLabels.merchant }, { value: "neutral", label: "Neutral" }] },
                            { label: "Project Stage", values: lvFunnelStageFilter, setter: setLvFunnelStageFilter, options: (["sales","pre_integration","under_integration","live","none"] as FunnelStage[]).map(s => ({ value: s, label: funnelStageLabels[s] })) },
                          ].map(({ label, values, setter, options }) => (
                            <div key={label} className="space-y-1">
                              <label className="text-xs text-muted-foreground font-medium">{label}</label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" className="w-full justify-between h-10 text-sm font-normal">
                                    <span className="truncate">{values.length === 0 ? `All ${label}s` : `${values.length} selected`}</span>
                                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56 p-2" align="start">
                                  <div className="max-h-48 overflow-y-auto">
                                    <div className="space-y-1">
                                      {options.map(opt => (
                                        <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm">
                                          <Checkbox
                                            checked={values.includes(opt.value)}
                                            onCheckedChange={() => toggleFilterValue(setter, opt.value)}
                                          />
                                          <span className="truncate">{opt.label}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                  {values.length > 0 && (
                                    <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setter([])}>Clear</Button>
                                  )}
                                </PopoverContent>
                              </Popover>
                            </div>
                          ))}
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground font-medium">{arrLabel} Range (Cr)</label>
                            <div className="flex gap-1">
                              <Input type="number" placeholder="Min" value={lvArrMin} onChange={e => setLvArrMin(e.target.value)} className="w-full h-9 text-xs" />
                              <Input type="number" placeholder="Max" value={lvArrMax} onChange={e => setLvArrMax(e.target.value)} className="w-full h-9 text-xs" />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="space-y-1 border rounded-md p-3 overflow-hidden">
                            <label className="text-xs text-muted-foreground font-medium">Start Date Range</label>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                              <Input type="date" value={lvKickOffFrom} onChange={e => setLvKickOffFrom(e.target.value)} className="h-9 text-xs min-w-0" />
                              <span className="text-xs text-muted-foreground px-1">to</span>
                              <Input type="date" value={lvKickOffTo} onChange={e => setLvKickOffTo(e.target.value)} className="h-9 text-xs min-w-0" />
                            </div>
                          </div>
                          <div className="space-y-1 border rounded-md p-3 overflow-hidden">
                            <label className="text-xs text-muted-foreground font-medium">Go-Live Date Range</label>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                              <Input type="date" value={lvGoLiveFrom} onChange={e => setLvGoLiveFrom(e.target.value)} className="h-9 text-xs min-w-0" />
                              <span className="text-xs text-muted-foreground px-1">to</span>
                              <Input type="date" value={lvGoLiveTo} onChange={e => setLvGoLiveTo(e.target.value)} className="h-9 text-xs min-w-0" />
                            </div>
                          </div>
                        </div>
                        {customFields.length > 0 && (
                          <div className="pt-2 border-t space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground tracking-normal">Custom Fields</p>
                            <div className="grid grid-cols-2 gap-3">
                              {customFields.map(cf => {
                                const vals = lvCustomFieldFilters[cf.id] || [];
                                const setVals = (next: string[]) => setLvCustomFieldFilters(prev => ({ ...prev, [cf.id]: next }));
                                const presentValues = Array.from(new Set(
                                  Object.values(customValuesMap).map(m => m?.[cf.id]).filter(Boolean) as string[]
                                )).sort();
                                const opts = (cf.field_type === "select" && cf.options.length > 0 ? cf.options : presentValues);
                                return (
                                  <div key={cf.id} className="space-y-1">
                                    <label className="text-xs text-muted-foreground font-medium">{cf.field_label}</label>
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-between h-10 text-sm font-normal">
                                          <span className="truncate">{vals.length === 0 ? `All` : `${vals.length} selected`}</span>
                                          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-56 p-2" align="start">
                                        <div className="max-h-48 overflow-y-auto space-y-1">
                                          {opts.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">No values yet</p>}
                                          {opts.map(opt => (
                                            <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm">
                                              <Checkbox
                                                checked={vals.includes(opt)}
                                                onCheckedChange={() => setVals(vals.includes(opt) ? vals.filter(v => v !== opt) : [...vals, opt])}
                                              />
                                              <span className="truncate">{opt}</span>
                                            </label>
                                          ))}
                                        </div>
                                        {vals.length > 0 && (
                                          <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setVals([])}>Clear</Button>
                                        )}
                                      </PopoverContent>
                                    </Popover>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedProjects.size > 0 && (
                      <>
                        <Badge variant="secondary" className="text-xs">{selectedProjects.size} selected</Badge>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBulkAssignDialogOpen(true)}>
                          <UserPlus className="h-3.5 w-3.5" />
                          Assign
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBulkEditDialogOpen(true)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBulkStateDialogOpen(true)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          State
                        </Button>
                        {isManagerOrAdmin && <Button variant="outline" size="icon" className="h-8 w-8 text-amber-600" onClick={() => setBulkArchiveDialogOpen(true)} title="Archive selected projects"><Archive className="h-3.5 w-3.5" /></Button>}
                        <Button variant="outline" size="icon" className="h-8 w-8 text-destructive" onClick={() => setBulkDeleteDialogOpen(true)} title="Delete selected projects"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    {/* Select Columns Popover */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <ToolbarIconButton icon={<ListChecks className="h-3.5 w-3.5" />} label="Select columns" />
                      </PopoverTrigger>
                      <PopoverContent className={TOOLBAR_POPOVER.columns} align="end" avoidCollisions={false} side="bottom">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 tracking-normal">Visible Columns</p>
                        <div className="space-y-1 max-h-[300px] overflow-auto">
                          {LIST_VIEW_COLUMNS.map(col => {
                            const active = listViewColumns.includes(col.key);
                            return (
                              <label key={col.key} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer text-sm hover:bg-muted/50 rounded">
                                <Checkbox checked={active} onCheckedChange={() => {
                                  const newCols = active ? listViewColumns.filter(c => c !== col.key) : [...listViewColumns, col.key];
                                  setListViewColumns(newCols);
                                  localStorage.setItem("listview_columns", JSON.stringify(newCols));
                                }} className="h-4 w-4" />
                                {col.label}
                              </label>
                            );
                          })}
                          {customFields.length > 0 && (
                            <>
                              <div className="mt-2 pt-2 border-t">
                                <p className="text-[10px] font-semibold text-muted-foreground tracking-normal mb-1">Custom Fields</p>
                              </div>
                              {customFields.map(cf => {
                                const key = `custom_field_${cf.id}`;
                                const active = listViewColumns.includes(key);
                                return (
                                  <label key={key} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer text-sm hover:bg-muted/50 rounded">
                                    <Checkbox checked={active} onCheckedChange={() => {
                                      const newCols = active ? listViewColumns.filter(c => c !== key) : [...listViewColumns, key];
                                      setListViewColumns(newCols);
                                      localStorage.setItem("listview_columns", JSON.stringify(newCols));
                                    }} className="h-4 w-4" />
                                    {cf.field_label}
                                  </label>
                                );
                              })}
                            </>
                          )}
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
                  </div>
                </div>
              </CardHeader>, projectToolbarHost) : null}
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                {/* rounded + clipping so the accent bar and header follow the card's corners */}
                <div className="h-1 w-full shrink-0 bg-navy" />
                <div className="min-h-0 flex-1 overflow-auto">
                  <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
                    {/* Opaque: the header sits over scrolling rows, and bg-navy/5
                        is only a 5% tint on its own. */}
                    <TableHeader className="sticky top-0 z-10 table-header-tint">
                      <TableRow className="hover:bg-navy/5 border-b">
                        <TableHead className="w-10 text-navy">
                          <Checkbox checked={allLvFilteredSelected} onCheckedChange={() => toggleSelectAll(lvFilteredProjectIds)} aria-label="Select all visible projects" />
                        </TableHead>
                        {listViewColumns.map(colKey => {
                          const col = LIST_VIEW_COLUMNS.find(c => c.key === colKey);
                          let label = col?.label;
                          if (!label && colKey.startsWith("custom_field_")) {
                            const cf = customFields.find(f => `custom_field_${f.id}` === colKey);
                            label = cf?.field_label;
                          }
                          if (!label) return null;
                          return (
                            <TableHead
                              key={colKey}
                              draggable
                              onDragStart={() => handleColDragStart(colKey)}
                              onDragOver={(e) => { e.preventDefault(); handleColDragOver(colKey); }}
                              onDragEnd={() => handleColDragEnd(listViewColumns)}
                              className={cn("whitespace-nowrap text-xs tracking-normal cursor-grab select-none font-semibold text-navy", draggedCol === colKey && "opacity-40")}
                            >
                              {label}
                            </TableHead>
                          );
                        })}
                        {!isGokwikGeneral && <TableHead className="w-20 text-xs tracking-normal text-sidebar-foreground">Action</TableHead>}
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
                              case "owner": va = a.assignedOwnerName || ""; vb = b.assignedOwnerName || ""; break;
                              case "status": va = a.projectState; vb = b.projectState; break;
                            }
                            return listSortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
                          });
                        }
                        const paged = sorted.slice((listViewPage - 1) * listViewPageSize, listViewPage * listViewPageSize);
                        return paged.map(project => {
                          const getColValue = (key: string) => {
                            switch (key) {
                              case "merchantName": return project.merchantName;
                              case "mid": return project.mid;
                              case "platform": return project.platform || "—";
                              case "category": return project.category || "—";
                              case "merchantState": return getProjectPhaseLabel(project);
                              case "mintComment": return project.notes?.currentPhaseComment || project.notes?.mintNotes || "—";
                              case "liveDate": return project.dates.goLiveDate || project.dates.expectedGoLiveDate || "—";
                              case "recentComments": {
                                const comments = project.checklist
                                  .filter(c => c.comment)
                                  .sort((a2, b2) => (b2.commentAt || "").localeCompare(a2.commentAt || ""))
                                  .slice(0, 3)
                                  .map(c => `${c.commentAt?.slice(0, 10) || "NA"} : ${c.comment?.slice(0, 30)}...`);
                                return comments.length > 0 ? comments.join("\n") : "—";
                              }
                              case "status": return stateLabelsFromCtx[project.projectState] || projectStateLabels[project.projectState];
                              case "arr": return `${project.arr}`;
                              case "owner": return project.assignedOwnerName || "Unassigned";
                              case "salesSpoc": return project.salesSpoc || "—";
                              case "kickOffDate": return project.dates.kickOffDate;
                              case "goLiveDate": return project.dates.goLiveDate || project.dates.expectedGoLiveDate || "—";
                              case "projectStage": return funnelStageLabels[getProjectFunnelStage(project)] || "—";
                              case "expectedGoLiveDate": return formatGoLiveDate(project);
                              case "integrationType": return project.integrationType || "—";
                              case "pgOnboarding": return project.pgOnboarding || "—";
                              case "goLivePercent": return `${project.goLivePercent || 0}%`;
                              case "mintNotes": return project.notes?.mintNotes || "—";
                              case "projectNotes": return project.notes?.projectNotes || "—";
                              case "opsComment": return project.notes?.opsComment || "—";
                              case "phase2Comment": return project.notes?.phase2Comment || "—";
                              default: {
                                if (key.startsWith("custom_field_")) {
                                  const fieldId = key.replace("custom_field_", "");
                                  return customValuesMap[project.id]?.[fieldId] || "—";
                                }
                                return "—";
                              }
                            }
                          };
                          const statusColor = project.projectState === "in_progress" ? "text-amber-500" :
                            project.projectState === "live" ? "text-emerald-500" :
                            project.projectState === "blocked" ? "text-destructive" : "text-muted-foreground";
                          return (
                            <TableRow key={project.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { from: "list" } })}>
                              <TableCell onClick={(event) => event.stopPropagation()}>
                                <Checkbox checked={selectedProjects.has(project.id)} onCheckedChange={() => toggleProjectSelection(project.id)} aria-label={`Select ${project.merchantName}`} />
                              </TableCell>
                              {listViewColumns.map(colKey => (
                                <TableCell key={colKey} className={cn("text-sm", colKey === "status" && statusColor, colKey === "recentComments" && "max-w-[200px]")}>
                                  {colKey === "merchantName" ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      {getColValue(colKey)}
                                      <RiskBadge projectId={project.id} verdict={riskVerdicts[project.id]} />
                                    </span>
                                  ) : ["mintNotes", "projectNotes", "opsComment", "phase2Comment"].includes(colKey) ? (
                                    <span className="truncate block max-w-[200px]" title={getColValue(colKey)}>{getColValue(colKey)}</span>
                                  ) : colKey === "recentComments" ? (
                                    <div className="space-y-0.5">
                                      {getColValue(colKey).split("\n").map((line, i) => (
                                        <div key={i} className="text-xs text-muted-foreground truncate">{line}</div>
                                      ))}
                                    </div>
                                  ) : colKey === "mintComment" ? (
                                    <span className="truncate block max-w-[180px]" title={getColValue(colKey)}>{getColValue(colKey)}</span>
                                  ) : colKey === "status" ? (
                                    isGokwikGeneral ? (
                                      <span>{getColValue(colKey)}</span>
                                    ) : (
                                    <div onClick={(e) => e.stopPropagation()}>
                                      <Select value={project.projectState} onValueChange={(v) => updateProject({ ...project, projectState: v as any })}>
                                        <SelectTrigger className="h-7 text-xs w-[120px] border-none p-0 shadow-none"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          {(Object.keys(projectStateLabels) as any[]).map(s => (
                                            <SelectItem key={s} value={s}>{stateLabelsFromCtx[s] || projectStateLabels[s]}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    )
                                  ) : (
                                    getColValue(colKey)
                                  )}
                                </TableCell>
                              ))}
                              {!isGokwikGeneral && (
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Assign owner" onClick={() => setListAssignProject(project)}>
                                    <UserPlus className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setListEditProject(project); setListEditOpen(true); }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  {isManagerOrAdmin && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-600" title="Archive project" onClick={() => archiveProject(project.id, true)}>
                                      <Archive className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteProject(project.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                              )}
                            </TableRow>
                          );
                        });
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
            <EditProjectDialog project={listEditProject} open={listEditOpen} onOpenChange={setListEditOpen} onSave={(p) => { updateProject(p); setListEditOpen(false); }} />
            <AssignOwnerDialog project={listAssignProject || undefined} open={!!listAssignProject} onOpenChange={(open) => { if (!open) setListAssignProject(null); }} />
          </div>}

          {activeTab === "projects" && projectView === "golive" && <div className="flex min-h-0 flex-1 flex-col">
            <MonthlyGoLiveTracker toolbarContainer={projectToolbarHost} searchQuery={searchQuery} />
          </div>}

          {activeTab === "projects" && projectView === "kanban" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <KanbanBoard toolbarContainer={projectToolbarHost} searchQuery={searchQuery} />
            </div>
          )}

          {/* ========= REPORTS TAB ========= */}
          {activeTab === "reports" && <div className="space-y-6">
            {/* Sub-tab: Pre Defined */}
                  {reportSubTab === "predefined" && (
                    <div className="space-y-4">
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: "executive", label: "Executive" },
                          { key: "operational", label: "Operational" },
                          { key: "merchant", label: responsibilityLabels.merchant },
                          { key: "tactical", label: "Tactical" },
                          { key: "project", label: "Project & Checklist" },
                          { key: "team", label: "Team & Owner" },
                          { key: "weeks_checklist", label: "Weeks per Checklist" },
                          { key: "tat", label: "TAT" },
                        ].map(({ key, label }) => (
                          <Button key={key} variant={reportType === key ? "default" : "outline"} size="sm" onClick={() => navigate({ to: pathForTab("reports", { reportSubTab: "predefined", reportType: key }) })}>
                            {label}
                          </Button>
                        ))}
                      </div>
                      {reportType === "executive" && <ExecutiveDashboard projects={displayProjects} />}
                      {reportType === "operational" && <OperationalReports projects={displayProjects} />}
                      {reportType === "merchant" && <MerchantResponsibility projects={displayProjects} />}
                      {reportType === "tactical" && <TacticalLists projects={displayProjects} />}
                      {reportType === "weeks_checklist" && <WeeksPerChecklistReport projects={displayProjects} />}
                      {reportType === "tat" && <TATReport projects={displayProjects} />}

                    {/* Merged Project + Checklist Report */}
                    {reportType === "project" && (
                      <div className="space-y-3">
                        {/* AI Insights + Download */}
                        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="portal-heading flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-primary" />
                                AI Project & Checklist Insights
                              </CardTitle>
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => exportProjectChecklistCSV(displayProjects, { teamLabels, responsibilityLabels, phaseLabels, stateLabels: stateLabelsFromCtx, getLabel: (k: string) => k })} className="gap-2">
                                  <Download className="h-3 w-3" />
                                  Export CSV
                                </Button>
                                <Button size="sm" variant="outline" onClick={fetchProjectAiInsight} disabled={projectAiLoading} className="gap-2">
                                  {projectAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                  {projectAiInsight ? "Refresh" : "Generate"}
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          {projectAiInsight && (
                            <CardContent className="pt-0">
                              <div className="text-sm space-y-1 whitespace-pre-line">{projectAiInsight}</div>
                            </CardContent>
                          )}
                        </Card>
                        {projectChecklistReport.map((project) => (
                          <Collapsible key={project.id} open={expandedProjects.has(project.id)} onOpenChange={() => toggleProjectExpand(project.id)}>
                            <CollapsibleTrigger asChild>
                              <div className="flex items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                                <div className="flex items-center gap-3">
                                  {expandedProjects.has(project.id) ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                                  <div>
                                    <span className="font-semibold">{project.merchantName}</span>
                                    <span className="text-xs text-muted-foreground ml-2">({project.mid})</span>
                                    <span className="text-xs text-muted-foreground ml-2">Start: {project.dates.kickOffDate}</span>
                                  </div>
                                  <Badge variant="outline">{teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam}</Badge>
                                  <Badge variant="secondary">{project.stats.completedChecklist}/{project.stats.totalChecklist} tasks</Badge>
                                </div>
                                <div className="flex items-center gap-4">
                                  <div className="text-right text-sm">
                                    <span className="text-primary font-medium">{formatDuration(project.stats.projectTime.gokwik)}</span>
                                    <span className="text-muted-foreground mx-1">/</span>
                                    <span className="text-amber-500 font-medium">{formatDuration(project.stats.projectTime.merchant)}</span>
                                  </div>
                                  <div className="w-24">
                                    <Progress value={project.stats.checklistProgress} className="h-2" />
                                  </div>
                                  <span className="text-xs text-muted-foreground w-10 text-right">{project.stats.checklistProgress}%</span>
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-2 ml-8 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground mb-1">{teamLabels.mint} Tasks</p>
                                    <p className="font-semibold">{project.mintCompleted}/{project.mintTotal}</p>
                                  </div>
                                  <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground mb-1">{teamLabels.integration} Tasks</p>
                                    <p className="font-semibold">{project.integrationCompleted}/{project.integrationTotal}</p>
                                  </div>
                                </div>
                                <div className="border rounded-lg overflow-hidden">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Checklist Item</TableHead>
                                        <TableHead>Team</TableHead>
                                        <TableHead>Responsibility</TableHead>
                                        <TableHead>{responsibilityLabels.gokwik} Time</TableHead>
                                        <TableHead>{responsibilityLabels.merchant} Time</TableHead>
                                        <TableHead>Status</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {project.checklistItems.map((item) => (
                                        <TableRow key={item.id}>
                                          <TableCell className="font-medium">{item.checklistTitle}</TableCell>
                                          <TableCell><Badge variant="outline">{teamLabels[item.team] || item.team}</Badge></TableCell>
                                          <TableCell>{responsibilityLabels[item.responsibility] || item.responsibility}</TableCell>
                                          <TableCell>{formatDuration(item.gokwikTime)}</TableCell>
                                          <TableCell>{formatDuration(item.merchantTime)}</TableCell>
                                          <TableCell>
                                            {item.completed ? (
                                              <Badge className="bg-emerald-500/10 text-emerald-600">Done</Badge>
                                            ) : (
                                              <Badge variant="secondary">Pending</Badge>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                      </div>
                    )}

                    {/* Merged Team + Owner Report */}
                    {reportType === "team" && (
                      <div className="space-y-6">
                        {/* AI Insights + Download */}
                        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="portal-heading flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-primary" />
                                AI Team & Owner Insights
                              </CardTitle>
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => exportTeamOwnerCSV(teamOwnerReport)} className="gap-2">
                                  <Download className="h-3 w-3" />
                                  Export CSV
                                </Button>
                                <Button size="sm" variant="outline" onClick={fetchTeamAiInsight} disabled={teamAiLoading} className="gap-2">
                                  {teamAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                  {teamAiInsight ? "Refresh" : "Generate"}
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          {teamAiInsight && (
                            <CardContent className="pt-0">
                              <div className="text-sm space-y-1 whitespace-pre-line">{teamAiInsight}</div>
                            </CardContent>
                          )}
                        </Card>
                        {teamOwnerReport.map((team) => (
                          <Card key={team.team} className="bg-muted/30">
                            <CardContent className="p-6">
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <div className={`h-12 w-12 rounded-xl ${teamColorClass(team.team)} flex items-center justify-center text-white font-bold text-lg`}>
                                    {team.teamLabel.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-lg">{team.teamLabel}</p>
                                    <p className="text-sm text-muted-foreground">{team.projectCount} projects</p>
                                  </div>
                                </div>
                                {team.pendingCount > 0 && (
                                  <Badge className="bg-amber-500 text-white">{team.pendingCount} Pending</Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-4 gap-4 mb-6">
                                <div className="bg-background rounded-lg p-4 text-center">
                                  <p className="text-2xl font-bold">{team.projectCount}</p>
                                  <p className="text-xs text-muted-foreground">Projects</p>
                                </div>
                                <div className="bg-background rounded-lg p-4 text-center">
                                  <p className="text-2xl font-bold">{team.completedTasks}/{team.totalTasks}</p>
                                  <p className="text-xs text-muted-foreground">Tasks</p>
                                </div>
                                <div className="bg-background rounded-lg p-4 text-center">
                                  <p className="text-2xl font-bold text-primary">{formatDuration(team.gokwikTime)}</p>
                                  <p className="text-xs text-muted-foreground">{responsibilityLabels.gokwik}</p>
                                </div>
                                <div className="bg-background rounded-lg p-4 text-center">
                                  <p className="text-2xl font-bold text-amber-500">{formatDuration(team.merchantTime)}</p>
                                  <p className="text-xs text-muted-foreground">{responsibilityLabels.merchant}</p>
                                </div>
                              </div>
                              {team.owners.length > 0 && (
                                <div>
                                  <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    Owners in {team.teamLabel}
                                  </p>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Owner</TableHead>
                                        <TableHead>Projects</TableHead>
                                        <TableHead>Tasks</TableHead>
                                        <TableHead>{responsibilityLabels.gokwik} Time</TableHead>
                                        <TableHead>{responsibilityLabels.merchant} Time</TableHead>
                                        <TableHead>Project Names</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {team.owners.map((owner) => (
                                        <TableRow key={owner.ownerId}>
                                          <TableCell className="font-medium">{owner.ownerName}</TableCell>
                                          <TableCell>{owner.totalProjects}</TableCell>
                                          <TableCell>{owner.completedTasks}/{owner.totalTasks}</TableCell>
                                          <TableCell>{formatDuration(owner.gokwikTime)}</TableCell>
                                          <TableCell>{formatDuration(owner.merchantTime)}</TableCell>
                                          <TableCell className="max-w-[200px]">
                                            <span className="text-xs text-muted-foreground truncate block">
                                              {owner.projectNames.join(", ")}
                                            </span>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                    </div>
                  )}

                  {/* Sub-tab: Report Builder */}
                  {reportSubTab === "builder" && (
                    <ReportsBuilder projects={displayProjects} customFields={customFields} customValuesMap={customValuesMap} />
                  )}


                  {/* Sub-tab: Scheduler */}
                  {reportSubTab === "scheduler" && (
                    <ReportScheduler />
                  )}

                  {/* Sub-tab: Pivot Table */}
                  {reportSubTab === "pivot-table" && (
                    <PivotTableSettings projects={displayProjects} customFields={customFields} customValuesMap={customValuesMap} />
                  )}

                  {/* Sub-tab: Sandbox Testing */}
                  {reportSubTab === "sandbox" && (
                    <SandboxTesting />
                  )}

                  {reportSubTab === "portal-visits" && (
                    <PortalVisitsReport />
                  )}

                  {reportSubTab === "daily-report" && (
                    <MovementReport timeframe="daily" />
                  )}

                  {reportSubTab === "weekly-report" && (
                    <MovementReport timeframe="weekly" />
                  )}
          </div>}

          {/* Settings Tab */}
          {activeTab === "settings" && <div className="space-y-6">
            {ADMIN_ONLY_SETTINGS.includes(settingsSubTab) && !perms.canManageUsers ? (
              <NoAccessCard />
            ) : settingsSubTab === "checklist" ? (
              <ChecklistManagement />
            ) : settingsSubTab === "users" ? (
              <UserManagement />
            ) : settingsSubTab === "navigation" ? (
              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm border-border">
                <CardHeader className="border-b bg-muted/30">
                  <CardTitle className="portal-heading flex items-center gap-2">
                    <Settings className="h-5 w-5 text-primary" />
                    Navigation Visibility
                  </CardTitle>
                  <CardDescription>Enable or disable navigation items for the sidebar</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {ALL_NAV_ITEMS.map((navKey) => {
                      const isLocked = navKey === "settings";
                      return (
                        <div key={navKey} className={cn("flex items-center justify-between p-3 border rounded-lg", isLocked && "bg-muted/40")}>
                          <div className="flex items-center gap-2">
                            {TAB_CONFIG[navKey]?.icon}
                            <span className="text-sm font-medium">{TAB_CONFIG[navKey]?.label || navKey}</span>
                            {isLocked && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Always Visible</Badge>}
                          </div>
                          <Checkbox
                            checked={isLocked ? true : navVisibility[navKey] !== false}
                            onCheckedChange={(checked) => !isLocked && handleNavToggle(navKey, !!checked)}
                            disabled={isLocked}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8">
                    <h4 className="text-sm font-semibold mb-1">Reports Sub-tabs</h4>
                    <p className="text-xs text-muted-foreground mb-3">Show or hide sub-navigation items under Reports</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {Object.entries(REPORTS_SUB_CONFIG).map(([key, cfg]) => {
                        const navKey = `reports:${key}`;
                        return (
                          <div key={navKey} className="flex items-center justify-between p-3 border rounded-lg">
                            <span className="text-sm font-medium">{cfg.label}</span>
                            <Checkbox
                              checked={navVisibility[navKey] !== false}
                              onCheckedChange={(checked) => handleNavToggle(navKey, !!checked)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-8">
                    <h4 className="text-sm font-semibold mb-1">Settings Sub-tabs</h4>
                    <p className="text-xs text-muted-foreground mb-3">Show or hide sub-navigation items under Settings</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {Object.entries(SETTINGS_SUB_CONFIG).map(([key, { label }]) => {
                        const navKey = `settings:${key}`;
                        const isLocked = key === "navigation";
                        return (
                          <div key={navKey} className={cn("flex items-center justify-between p-3 border rounded-lg", isLocked && "bg-muted/40")}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{label}</span>
                              {isLocked && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Always Visible</Badge>}
                            </div>
                            <Checkbox
                              checked={isLocked ? true : navVisibility[navKey] !== false}
                              onCheckedChange={(checked) => !isLocked && handleNavToggle(navKey, !!checked)}
                              disabled={isLocked}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <SettingsPanel activeSubTab={settingsSubTab} />
            )}
          </div>}

          {/* Risks Tab */}
          {activeTab === "hi-there" && <AiChatBot />}

          {activeTab === "risks" && <RiskDashboard />}



          {/* Emails Tab */}
          {activeTab === "emails" && <div className="space-y-6">
            <ParsedEmailsTab />
          </div>}

          {/* Platforms Tab */}
          {activeTab === "platforms" && <PlatformMerchants />}
          {activeTab === "golive" && <MonthlyGoLiveTracker />}
          {activeTab === "shopify-sme" && <ShopifySmeTab />}
          {activeTab === "shopify-lt-emails" && <ShopifyLtEmailComms />}

          {/* Tenants Tab (Super Admin only) */}
          {activeTab === "tenants" && (currentUser?.team === "super_admin" ? <TenantManagement /> : <NoAccessCard />)}

          {/* Archived Projects Tab (Manager / Super Admin only) */}
          {activeTab === "archived" && !isManagerOrAdmin && <NoAccessCard />}
          {activeTab === "archived" && isManagerOrAdmin && (() => {
            const archivedProjects = projects.filter(p => p.archived);
            return (
              <div className="space-y-4">
                <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm border-border">
                  <CardHeader className="border-b bg-muted/30 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="portal-heading flex items-center gap-2">
                        <Archive className="h-5 w-5 text-primary" />
                        Archived Projects
                        <Badge variant="secondary" className="ml-1">{archivedProjects.length}</Badge>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">Archived projects are hidden from all other views. Restore them to make them active again.</p>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {archivedProjects.length === 0 ? (
                      <div className="text-center py-20">
                        <Archive className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                        <h3 className="font-semibold text-lg mb-2">No Archived Projects</h3>
                        <p className="text-muted-foreground text-sm">Projects you archive will appear here.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {archivedProjects.map(project => (
                          <div key={project.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{project.merchantName}</span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5">{project.mid}</Badge>
                                {project.platform && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{project.platform}</Badge>}
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{project.projectState}</Badge>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>{arrLabel}: {formatArrCr(project.arr)}</span>
                                {project.assignedOwnerName && <span>Owner: {project.assignedOwnerName}</span>}
                                {project.archivedAt && <span>Archived: {new Date(project.archivedAt).toLocaleDateString()}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-4 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 text-xs h-8 text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                                onClick={() => archiveProject(project.id, false)}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Restore
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => deleteProject(project.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          </div>
        </div>
      </main>


      <CSVUploadDialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen} />
      <AddProjectDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSave={handleAddProject} />

      {/* Bulk Edit Dialog */}
      <BulkEditDialog
        open={bulkEditDialogOpen}
        onOpenChange={setBulkEditDialogOpen}
        selectedCount={selectedProjects.size}
        onSave={handleBulkEdit}
      />

      {/* Bulk Assign Dialog */}
      {bulkAssignDialogOpen && (
        <AssignOwnerDialog
          open={bulkAssignDialogOpen}
          onOpenChange={setBulkAssignDialogOpen}
          projectIds={Array.from(selectedProjects)}
          onAssigned={() => setSelectedProjects(new Set())}
        />
      )}

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkArchiveDialogOpen} onOpenChange={setBulkArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {selectedProjects.size} project(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived projects are hidden from all views. You can restore them anytime from the Archived tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkArchive} className="bg-amber-600 text-white hover:bg-amber-700">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedProjects.size} project(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected projects and all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk State Update */}
      <AlertDialog open={bulkStateDialogOpen} onOpenChange={setBulkStateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update state for {selectedProjects.size} project(s)</AlertDialogTitle>
            <AlertDialogDescription>
              Select the new project state to apply to all selected projects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Select value={bulkStateValue} onValueChange={(v) => setBulkStateValue(v as ProjectState)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(projectStateLabels) as ProjectState[]).map(s => (
                  <SelectItem key={s} value={s}>{stateLabelsFromCtx[s] || projectStateLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkStateUpdate}>Update All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
