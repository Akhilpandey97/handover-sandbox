import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useCustomFields, useAllCustomFieldValues } from "@/hooks/useCustomFields";
import { Project, ProjectState, projectStateLabels, getProjectFunnelStage, funnelStageLabels, FunnelStage } from "@/data/projectsData";
import { KanbanCard } from "./KanbanCard";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
import { Search, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

const KANBAN_FIELD_OPTIONS = [
  { key: "funnelStage", label: "Project Stage" },
  { key: "projectState", label: "Project State" },
  { key: "currentPhase", label: "Current Phase" },
  { key: "currentOwnerTeam", label: "Current Team" },
  { key: "platform", label: "Platform" },
  { key: "category", label: "Category" },
  { key: "currentResponsibility", label: "Responsibility" },
  { key: "assignedOwnerName", label: "Assigned Owner" },
];

const FUNNEL_ORDER: FunnelStage[] = ["sales", "pre_integration", "under_integration", "live"];
const FUNNEL_STAGE_STYLES: Record<FunnelStage, { text: string; bar: string; bg: string; ring: string }> = {
  sales: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  pre_integration: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  under_integration: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  live: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  none: { text: "text-navy", bar: "bg-navy/40", bg: "bg-navy/5", ring: "ring-navy/20" },
};

const STATE_STYLES: Record<string, { text: string; bar: string; bg: string; ring: string }> = {
  not_started: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  in_progress: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  on_hold: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  blocked: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  live: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
};

const PHASE_STYLES: Record<string, { text: string; bar: string; bg: string; ring: string }> = {
  mint: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  integration: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  ms: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  completed: { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
};

const FALLBACK_STYLES = [
  { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
  { text: "text-navy", bar: "bg-navy", bg: "bg-navy/5", ring: "ring-navy/20" },
];

function getFieldValue(project: Project, field: string, customValuesMap?: Record<string, Record<string, string>>): string {
  switch (field) {
    case "funnelStage": return getProjectFunnelStage(project);
    case "projectState": return project.projectState;
    case "currentPhase": return project.currentPhase;
    case "currentOwnerTeam": return project.currentOwnerTeam;
    case "platform": return project.platform || "Unknown";
    case "category": return project.category || "Uncategorized";
    case "currentResponsibility": return project.currentResponsibility;
    case "assignedOwnerName": return project.assignedOwnerName || "Unassigned";
    default:
      if (field.startsWith("custom_field_") && customValuesMap) {
        const fieldId = field.replace("custom_field_", "");
        return customValuesMap[project.id]?.[fieldId] || "Unset";
      }
      return project.projectState;
  }
}

function getFieldLabel(value: string, field: string, labels: any): string {
  switch (field) {
    case "funnelStage": return funnelStageLabels[value as FunnelStage] || value;
    case "projectState": return labels.stateLabels[value] || projectStateLabels[value as ProjectState] || value;
    case "currentPhase": return labels.phaseLabels[value] || value;
    case "currentOwnerTeam": return labels.teamLabels[value] || value;
    case "currentResponsibility": return labels.responsibilityLabels[value] || value;
    default: return value;
  }
}

function getColumnStyle(value: string, field: string) {
  if (field === "funnelStage") return FUNNEL_STAGE_STYLES[value as FunnelStage] || FUNNEL_STAGE_STYLES.none;
  if (field === "projectState") return STATE_STYLES[value] || FUNNEL_STAGE_STYLES.none;
  if (field === "currentPhase") return PHASE_STYLES[value] || FUNNEL_STAGE_STYLES.none;
  const hash = value.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return FALLBACK_STYLES[hash % FALLBACK_STYLES.length];
}

export const KanbanBoard = ({ projectsOverride, toolbarContainer, searchQuery = "" }: { projectsOverride?: Project[]; toolbarContainer?: HTMLElement | null; searchQuery?: string } = {}) => {
  const { projects: allProjects } = useProjects();
  const projects = projectsOverride ?? allProjects;
  const labels = useLabels();
  const { fields: customFields } = useCustomFields();
  const [groupField, setGroupField] = useState("funnelStage");
  const [funnelStageFilter, setFunnelStageFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [responsibilityFilter, setResponsibilityFilter] = useState<string[]>([]);
  const [csmFilter, setCsmFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [arrMin, setArrMin] = useState("");
  const [arrMax, setArrMax] = useState("");
  const [goLiveMin, setGoLiveMin] = useState("");
  const [goLiveMax, setGoLiveMax] = useState("");
  const [goLiveInProgressOnly, setGoLiveInProgressOnly] = useState(false);
  const [liveThisYearOnly, setLiveThisYearOnly] = useState(false);

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);
  const projectIds = useMemo(() => activeProjects.map(p => p.id), [activeProjects]);
  const { valuesMap: customValuesMap } = useAllCustomFieldValues(projectIds);

  // Derive filter options from data
  const filterOptions = useMemo(() => {
    const teams = new Set<string>();
    const phases = new Set<string>();
    const states = new Set<string>();
    const platforms = new Set<string>();
    const categories = new Set<string>();
    const responsibilities = new Set<string>();
    const csms = new Set<string>();
    const ownerMap = new Map<string, string>();
    const csmField = customFields.find(f => f.field_key === "custom_csm_manager");
    activeProjects.forEach(p => {
      if (p.currentOwnerTeam) teams.add(p.currentOwnerTeam);
      if (p.currentPhase) phases.add(p.currentPhase);
      if (p.projectState) states.add(p.projectState);
      if (p.platform) platforms.add(p.platform);
      if (p.category) categories.add(p.category);
      if (p.currentResponsibility) responsibilities.add(p.currentResponsibility);
      if (p.assignedOwner && p.assignedOwnerName) ownerMap.set(p.assignedOwner, p.assignedOwnerName);
      if (csmField) {
        const csm = customValuesMap[p.id]?.[csmField.id];
        if (csm) csms.add(csm);
      }
    });
    return {
      teams: [...teams].sort(),
      phases: [...phases].sort(),
      states: [...states].sort(),
      platforms: [...platforms].sort(),
      categories: [...categories].sort(),
      responsibilities: [...responsibilities].sort(),
      csms: [...csms].sort(),
      owners: Array.from(ownerMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [activeProjects, customFields, customValuesMap]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const csmField = customFields.find(f => f.field_key === "custom_csm_manager");
    return activeProjects.filter(p => {
      const matchesSearch = !q || p.merchantName?.toLowerCase().includes(q) || p.mid?.toLowerCase().includes(q);
      const matchesFunnel = funnelStageFilter.length === 0 || funnelStageFilter.includes(getProjectFunnelStage(p));
      const matchesTeam = teamFilter.length === 0 || teamFilter.includes(p.currentOwnerTeam);
      const matchesPhase = phaseFilter.length === 0 || phaseFilter.includes(p.currentPhase);
      const matchesState = stateFilter.length === 0 || stateFilter.includes(p.projectState);
      const matchesPlatform = platformFilter.length === 0 || platformFilter.includes(p.platform || "");
      const matchesCategory = categoryFilter.length === 0 || categoryFilter.includes(p.category || "");
      const matchesResponsibility = responsibilityFilter.length === 0 || responsibilityFilter.includes(p.currentResponsibility || "");
      const csm = csmField ? customValuesMap[p.id]?.[csmField.id] : undefined;
      const matchesCsm = csmFilter.length === 0 || (csm && csmFilter.includes(csm));
      const matchesOwner = ownerFilter.length === 0 || (
        ownerFilter.includes("unassigned") ? !p.assignedOwner : false
      ) || (p.assignedOwner && ownerFilter.includes(p.assignedOwner));
      const matchesArrMin = !arrMin || p.arr >= parseFloat(arrMin);
      const matchesArrMax = !arrMax || p.arr <= parseFloat(arrMax);
      const pct = Math.max(0, Math.min(100, Number(p.goLivePercent) || 0));
      const matchesGoLiveMin = !goLiveMin || pct >= parseFloat(goLiveMin);
      const matchesGoLiveMax = !goLiveMax || pct <= parseFloat(goLiveMax);
      const matchesGoLiveInProgress = !goLiveInProgressOnly || (pct > 0 && pct < 100);
      return matchesSearch && matchesFunnel && matchesTeam && matchesPhase && matchesState && matchesPlatform && matchesCategory && matchesResponsibility && matchesCsm && matchesOwner && matchesArrMin && matchesArrMax && matchesGoLiveMin && matchesGoLiveMax && matchesGoLiveInProgress;
    });
  }, [activeProjects, searchQuery, funnelStageFilter, teamFilter, phaseFilter, stateFilter, platformFilter, categoryFilter, responsibilityFilter, csmFilter, ownerFilter, arrMin, arrMax, goLiveMin, goLiveMax, goLiveInProgressOnly, customFields, customValuesMap]);

  const allFieldOptions = useMemo(() => {
    const customOptions = customFields.map(f => ({ key: `custom_field_${f.id}`, label: f.field_label }));
    return [...KANBAN_FIELD_OPTIONS, ...customOptions];
  }, [customFields]);

  const columns = useMemo(() => {
    const STATE_SORT_ORDER: Record<string, number> = {
      in_progress: 0,
      on_hold: 1,
      blocked: 2,
      not_started: 3,
      live: 4,
    };
    const groupMap = new Map<string, Project[]>();
    filteredProjects.forEach(p => {
      const val = getFieldValue(p, groupField, customValuesMap);
      if (groupField === "funnelStage" && val === "none") return;
      const existing = groupMap.get(val) || [];
      existing.push(p);
      groupMap.set(val, existing);
    });

    const yearStart = `${new Date().getFullYear()}-01-01`;
    const todayStr = new Date().toISOString().slice(0, 10);

    const entries = Array.from(groupMap.entries())
      .map(([key, allGroupProjects]) => {
        const groupProjects = (key === "live" && liveThisYearOnly)
          ? allGroupProjects.filter(p => {
              const d = p.dates?.goLiveDate || "";
              return !!d && d >= yearStart && d <= todayStr;
            })
          : allGroupProjects;
        const sorted = [...groupProjects].sort((a, b) => {
          const ao = STATE_SORT_ORDER[a.projectState] ?? 99;
          const bo = STATE_SORT_ORDER[b.projectState] ?? 99;
          if (ao !== bo) return ao - bo;
          return (b.arr ?? 0) - (a.arr ?? 0);
        });
        const arrByState: Record<string, number> = {};
        sorted.forEach(p => {
          arrByState[p.projectState] = (arrByState[p.projectState] ?? 0) + (p.arr ?? 0);
        });
        return {
          key,
          label: getFieldLabel(key, groupField, labels),
          projects: sorted,
          arrByState,
          ...getColumnStyle(key, groupField),
        };
      });

    if (groupField === "funnelStage") {
      return entries.sort((a, b) => FUNNEL_ORDER.indexOf(a.key as FunnelStage) - FUNNEL_ORDER.indexOf(b.key as FunnelStage));
    }
    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredProjects, groupField, labels, customValuesMap, liveThisYearOnly]);

  const formatArr = (n: number) =>
    n >= 10000000 ? `${(n / 10000000).toFixed(1)}Cr` :
    n >= 100000 ? `${(n / 100000).toFixed(1)}L` :
    n.toLocaleString();

  const standardOptions = allFieldOptions.filter(o => !o.key.startsWith("custom_field_"));
  const customOptions = allFieldOptions.filter(o => o.key.startsWith("custom_field_"));

  const toggleFunnel = (stage: string) => {
    setFunnelStageFilter(prev => prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]);
  };
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const activeFilterCount =
    funnelStageFilter.length + teamFilter.length + phaseFilter.length + stateFilter.length +
    platformFilter.length + categoryFilter.length + responsibilityFilter.length + csmFilter.length +
    ownerFilter.length +
    (arrMin ? 1 : 0) + (arrMax ? 1 : 0) +
    (goLiveMin ? 1 : 0) + (goLiveMax ? 1 : 0) + (goLiveInProgressOnly ? 1 : 0);

  const hasFilters = activeFilterCount > 0;

  const clearAllFilters = () => {
    setFunnelStageFilter([]);
    setTeamFilter([]);
    setPhaseFilter([]);
    setStateFilter([]);
    setPlatformFilter([]);
    setCategoryFilter([]);
    setResponsibilityFilter([]);
    setCsmFilter([]);
    setOwnerFilter([]);
    setArrMin("");
    setArrMax("");
    setGoLiveMin("");
    setGoLiveMax("");
    setGoLiveInProgressOnly(false);
  };

  const labelize = (val: string, kind: "team" | "phase" | "state" | "responsibility") => {
    if (kind === "team") return labels.teamLabels[val] || val;
    if (kind === "phase") return labels.phaseLabels[val] || val;
    if (kind === "state") return labels.stateLabels[val] || projectStateLabels[val as ProjectState] || val;
    if (kind === "responsibility") return labels.responsibilityLabels[val] || val;
    return val;
  };


  const toolbar = (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Group By:</Label>
          <Select value={groupField} onValueChange={setGroupField}>
            <SelectTrigger className="h-8 text-xs w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {standardOptions.map(opt => (
                <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
              ))}
              {customOptions.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Custom Fields</div>
                  {customOptions.map(opt => (
                    <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" collisionPadding={16} className="w-[600px] p-0 flex flex-col" style={{ maxHeight: 'calc(100vh - 100px)' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
              <p className="text-sm font-semibold">Filters</p>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={clearAllFilters}>
                  <X className="h-3 w-3" /> Reset
                </Button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Team", values: teamFilter, setter: setTeamFilter, options: filterOptions.teams.map(v => ({ value: v, label: labelize(v, "team") })) },
                  { label: "Phase", values: phaseFilter, setter: setPhaseFilter, options: filterOptions.phases.map(v => ({ value: v, label: labelize(v, "phase") })) },
                  { label: "State", values: stateFilter, setter: setStateFilter, options: filterOptions.states.map(v => ({ value: v, label: labelize(v, "state") })) },
                  { label: "Platform", values: platformFilter, setter: setPlatformFilter, options: filterOptions.platforms.map(v => ({ value: v, label: v })) },
                  { label: "Category", values: categoryFilter, setter: setCategoryFilter, options: filterOptions.categories.map(v => ({ value: v, label: v })) },
                  { label: "Responsibility", values: responsibilityFilter, setter: setResponsibilityFilter, options: filterOptions.responsibilities.map(v => ({ value: v, label: labelize(v, "responsibility") })) },
                  { label: "CSM", values: csmFilter, setter: setCsmFilter, options: filterOptions.csms.map(v => ({ value: v, label: v })) },
                  { label: "Owner", values: ownerFilter, setter: setOwnerFilter, options: [{ value: "unassigned", label: "Unassigned" }, ...filterOptions.owners.map(o => ({ value: o.id, label: o.name }))] },
                ].filter(g => g.options.length > 0).map(({ label, values, setter, options }) => (
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
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {options.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm">
                              <Checkbox
                                checked={values.includes(opt.value)}
                                onCheckedChange={() => toggle(setter, opt.value)}
                              />
                              <span className="truncate">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                        {values.length > 0 && (
                          <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setter([])}>Clear</Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">ARR Range (Cr)</label>
                  <div className="flex gap-1">
                    <Input type="number" placeholder="Min" value={arrMin} onChange={e => setArrMin(e.target.value)} className="w-full h-9 text-xs" />
                    <Input type="number" placeholder="Max" value={arrMax} onChange={e => setArrMax(e.target.value)} className="w-full h-9 text-xs" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Go-Live %</label>
                  <div className="flex gap-1">
                    <Input type="number" min={0} max={100} placeholder="Min %" value={goLiveMin} onChange={e => setGoLiveMin(e.target.value)} className="w-full h-9 text-xs" />
                    <Input type="number" min={0} max={100} placeholder="Max %" value={goLiveMax} onChange={e => setGoLiveMax(e.target.value)} className="w-full h-9 text-xs" />
                  </div>
                  <label className="flex items-center gap-2 mt-1 cursor-pointer">
                    <input type="checkbox" checked={goLiveInProgressOnly} onChange={e => setGoLiveInProgressOnly(e.target.checked)} className="h-3.5 w-3.5" />
                    <span className="text-xs text-muted-foreground">In progress only (exclude 0% &amp; 100%)</span>
                  </label>
                </div>
              </div>
              <div className="pt-2 border-t space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project Stage</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {(["sales","pre_integration","under_integration","live","none"] as const).map(stage => (
                    <label key={stage} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={funnelStageFilter.includes(stage)}
                        onChange={() => toggleFunnel(stage)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs text-muted-foreground">{funnelStageLabels[stage]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>


        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearAllFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

      </div>
  );

  return (
    <div className="flex flex-col h-full w-full gap-4 min-h-0">
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
      {/* Board */}
      <div className="flex gap-3 w-full flex-1 min-h-0 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.key} className="flex-1 min-w-[260px] flex flex-col h-full">
            <div className={cn("rounded-lg border bg-card shadow-sm flex flex-col h-full overflow-hidden ring-1", col.ring)}>

              <div className={cn("h-1 w-full", col.bar)} />
              <div className={cn("flex items-center justify-between gap-2 px-3 py-2.5 border-b", col.bg)}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("font-semibold text-sm tracking-tight truncate min-w-0", col.text)}>
                    {col.label}
                  </span>
                  {col.key === "live" && (
                    <label className="flex items-center gap-1 cursor-pointer shrink-0" title={`Only accounts that went live since Jan ${new Date().getFullYear()}`}>
                      <input
                        type="checkbox"
                        checked={liveThisYearOnly}
                        onChange={e => setLiveThisYearOnly(e.target.checked)}
                        className="h-3 w-3"
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">This year</span>
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-nowrap justify-end shrink-0">
                  {(["in_progress","on_hold","blocked","not_started","live"] as const).map(st => {
                    const amt = col.arrByState[st];
                    if (!amt) return null;
                    const s = STATE_STYLES[st];
                    return (
                      <span
                        key={st}
                        title={`${labelize(st, "state")} ARR`}
                        className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 whitespace-nowrap", s.bg, s.text, s.ring)}
                      >
                        {formatArr(amt)}
                      </span>
                    );
                  })}
                  <Badge variant="secondary" className="font-bold text-[11px] h-5 ml-1">
                    {col.projects.length}
                  </Badge>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-2 p-2.5">
                  {col.projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No projects
                    </p>
                  ) : (
                    col.projects.map((project) => {
                      const csmField = customFields.find(f => f.field_key === "custom_csm_manager");
                      const csmName = csmField ? customValuesMap[project.id]?.[csmField.id] : undefined;
                      return <KanbanCard key={project.id} project={project} csmName={csmName} />;
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}

function CheckboxRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5" />
      <span className="text-xs">{label}</span>
    </label>
  );
}

