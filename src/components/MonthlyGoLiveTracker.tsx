import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, RefreshCw, ExternalLink, ArrowUpDown, Filter, ListChecks, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EditProjectDialog } from "./EditProjectDialog";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { getProjectFunnelStage, funnelStageLabels, projectStateLabels } from "@/data/projectsData";
import { RiskBadge } from "./RiskBadge";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { arrCroreValue } from "@/lib/arr";
import { useCustomFields, useAllCustomFieldValues } from "@/hooks/useCustomFields";
import { ToolbarIconButton, TOOLBAR_POPOVER, TOOLBAR_PANEL_MAX_H } from "./ToolbarIconButton";

type Project = {
  id: string;
  merchant_name: string;
  arr: number | null;
  current_phase: string | null;
  project_state: string | null;
  assigned_owner: string | null;
  expected_go_live_date: string | null;
  tracker_month: string | null;
  platform: string | null;
};

type Insight = {
  project_id: string;
  month: string;
  blocker: string | null;
  blocked_on: string | null;
  deadline: string | null;
  confidence: string | null;
  pg_creds: string | null;
  db_walkthrough: string | null;
  csm_alignment: string | null;
  manual_overrides: Record<string, string>;
};

const STAGE_BADGE: Record<string, string> = {
  live: "bg-emerald-500 text-white",
  under_integration: "bg-amber-500 text-white",
  pre_integration: "bg-sky-500 text-white",
  sales: "bg-violet-500 text-white",
  none: "bg-muted text-muted-foreground",
};

const CONF_BADGE: Record<string, string> = {
  High: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  Low: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const COLUMN_STORAGE_KEY = "golive_tracker_columns";

function ymToLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS[parseInt(m,10)-1]} ${y}`;
}
function weekOfMonth(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const week = Math.ceil((d.getDate() + 6 - d.getDay()) / 7) || Math.ceil(d.getDate() / 7);
  return `(Week${week})`;
}
function dateLabel(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · W${weekOfMonth(dateStr).replace(/[^\d]/g, "")}`;
}

export const MonthlyGoLiveTracker = ({ toolbarContainer, searchQuery = "" }: { toolbarContainer?: HTMLElement | null; searchQuery?: string } = {}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getLabel } = useLabels();
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultYm);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insights, setInsights] = useState<Record<string, Insight>>({});
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const { projects: fullProjects, updateProject } = useProjects();
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();
  // Column parity with the List view: status and the tenant's custom fields
  // were selectable there but absent here.
  const { fields: customFields } = useCustomFields();
  const { valuesMap: customValuesMap } = useAllCustomFieldValues(useMemo(() => projects.map(p => p.id), [projects]));
  const editingProject = editProjectId ? fullProjects.find(p => p.id === editProjectId) : null;

  const arrLabel = getLabel("field_arr");
  const stageLabel = getLabel("field_project_stage");
  // This view names the field Project Owner; Settings → Field Labels
  // still calls it Assigned Owner everywhere else.
  const ownerLabel = "Project Owner";
  const expectedLabel = getLabel("field_expected_go_live_date");
  const stateLabel = getLabel("field_project_state");

  // Stage resolves through the tenant's configured project-stage rules
  const funnelStages = useMemo(() => {
    const map: Record<string, string> = {};
    fullProjects.forEach(p => { map[p.id] = getProjectFunnelStage(p); });
    return map;
  }, [fullProjects]);

  const fullById = useMemo(
    () => Object.fromEntries(fullProjects.map(fp => [fp.id, fp])),
    [fullProjects],
  );

  const SYSTEM_COLUMNS = useMemo(() => ([
    { key: "mid", label: getLabel("field_mid") },
    { key: "platform", label: getLabel("field_platform") },
    { key: "category", label: getLabel("field_category") },
    { key: "salesSpoc", label: getLabel("field_sales_spoc") },
    { key: "kickOffDate", label: getLabel("field_kick_off_date") },
    { key: "actualGoLive", label: getLabel("field_actual_go_live_date") },
    { key: "integrationType", label: getLabel("field_integration_type") },
    { key: "pgOnboarding", label: getLabel("field_pg_onboarding") },
    { key: "goLivePercent", label: getLabel("field_go_live_percent") },
  ]), [getLabel]);

  const systemValue = (projectId: string, key: string): string => {
    const fp = fullById[projectId];
    if (!fp) return "—";
    switch (key) {
      case "mid": return fp.mid || "—";
      case "platform": return fp.platform || "—";
      case "category": return fp.category || "—";
      case "salesSpoc": return fp.salesSpoc || "—";
      case "kickOffDate": return fp.dates?.kickOffDate || "—";
      case "actualGoLive": return fp.dates?.goLiveDate || "—";
      case "integrationType": return fp.integrationType || "—";
      case "pgOnboarding": return fp.pgOnboarding || "—";
      case "goLivePercent": return fp.goLivePercent != null ? `${fp.goLivePercent}%` : "—";
      default: return "—";
    }
  };

  const ALL_COLUMNS = useMemo(() => ([
    { key: "arr", label: `${arrLabel} Cr.` },
    { key: "stage", label: stageLabel },
    { key: "status", label: stateLabel },
    { key: "blocker", label: "Blocker" },
    { key: "blocked_on", label: "Blocked On" },
    { key: "deadline", label: "Deadline" },
    { key: "confidence", label: "Confidence" },
    { key: "owner", label: ownerLabel },
    { key: "expected", label: expectedLabel },
    ...SYSTEM_COLUMNS,
    ...customFields.map(cf => ({ key: `custom_field_${cf.id}`, label: cf.field_label })),
  ]), [arrLabel, stageLabel, stateLabel, ownerLabel, expectedLabel, SYSTEM_COLUMNS, customFields]);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
        }
      } catch { /* ignore */ }
    }
    return ["arr", "stage", "blocker", "blocked_on", "deadline", "confidence", "owner", "expected"];
  });
  const isVisible = (key: string) => visibleColumns.includes(key);
  const toggleColumn = (key: string) => {
    const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key];
    setVisibleColumns(next);
    try { window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // Sort
  const [sortField, setSortField] = useState<string>("none");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Filters
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [confidenceFilter, setConfidenceFilter] = useState<string[]>([]);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [arrMin, setArrMin] = useState("");
  const [arrMax, setArrMax] = useState("");
  const [expectedFrom, setExpectedFrom] = useState("");
  const [expectedTo, setExpectedTo] = useState("");

  const activeFilterCount =
    stageFilter.length + stateFilter.length + confidenceFilter.length +
    (arrMin ? 1 : 0) + (arrMax ? 1 : 0) + (expectedFrom ? 1 : 0) + (expectedTo ? 1 : 0) + (needsAttentionOnly ? 1 : 0);

  const clearFilters = () => {
    setStageFilter([]); setStateFilter([]); setConfidenceFilter([]); setNeedsAttentionOnly(false);
    setArrMin(""); setArrMax(""); setExpectedFrom(""); setExpectedTo("");
  };

  const toggleValue = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [from, to] = monthBounds(month);
      // Projects whose expected_go_live in the month OR tagged tracker_month = month
      const { data: pData } = await supabase
        .from("projects")
        .select("id, merchant_name, arr, current_phase, project_state, assigned_owner, expected_go_live_date, tracker_month, platform")
        .eq("archived", false)
        .or(`tracker_month.eq.${month},and(expected_go_live_date.gte.${from},expected_go_live_date.lte.${to})`);
      const list = (pData || []) as Project[];
      setProjects(list);

      const ids = list.map(p => p.id);
      if (ids.length > 0) {
        const [{ data: iData }, { data: profData }] = await Promise.all([
          supabase.from("project_ai_insights").select("*").eq("month", month).in("project_id", ids),
          supabase.from("profiles").select("id, name").in("id", list.map(p => p.assigned_owner).filter(Boolean) as string[]),
        ]);
        const iMap: Record<string, Insight> = {};
        (iData || []).forEach((r: any) => { iMap[r.project_id] = r; });
        setInsights(iMap);
        const oMap: Record<string, string> = {};
        (profData || []).forEach((p: any) => { oMap[p.id] = p.name; });
        setOwners(oMap);

      } else {
        setInsights({});
        setOwners({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month]);

  const monthBounds = (ym: string): [string, string] => {
    const [y, m] = ym.split("-").map(Number);
    const start = `${ym}-01`;
    const end = new Date(y, m, 0).toISOString().slice(0, 10);
    return [start, end];
  };

  const runAiRefresh = async () => {
    if (projects.length === 0) return;
    setAiLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `/api/public/enrich-golive-tracker`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ projectIds: projects.map(p => p.id), month }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success("AI insights refreshed");
      await load();
    } catch (e: any) {
      toast.error(`AI refresh failed: ${e?.message || e}`);
    } finally {
      setAiLoading(false);
    }
  };

  const updateInsight = async (projectId: string, field: keyof Insight, value: string) => {
    const existing = insights[projectId];
    const overrides = { ...(existing?.manual_overrides || {}), [field]: value };
    const payload: any = {
      project_id: projectId,
      month,
      [field]: value,
      manual_overrides: overrides,
    };
    const { data, error } = await supabase
      .from("project_ai_insights")
      .upsert(payload, { onConflict: "project_id,month" })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setInsights(prev => ({ ...prev, [projectId]: data as any }));
  };

  const stageOf = (id: string) => funnelStages[id] || "none";
  const stageText = (id: string) => funnelStageLabels[stageOf(id)] || "—";


  const sortedRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (query && !p.merchant_name.toLowerCase().includes(query)) return false;
      if (stageFilter.length > 0 && !stageFilter.includes(stageOf(p.id))) return false;
      if (stateFilter.length > 0 && !stateFilter.includes(p.project_state || "")) return false;
      if (confidenceFilter.length > 0 && !confidenceFilter.includes(insights[p.id]?.confidence || "")) return false;
      if (needsAttentionOnly && riskVerdicts[p.id]?.level !== "high") return false;
      const arrCr = p.arr != null ? Number(arrCroreValue(p.arr)) : null;
      if (arrMin && (arrCr == null || arrCr < parseFloat(arrMin))) return false;
      if (arrMax && (arrCr == null || arrCr > parseFloat(arrMax))) return false;
      if (expectedFrom && (!p.expected_go_live_date || p.expected_go_live_date < expectedFrom)) return false;
      if (expectedTo && (!p.expected_go_live_date || p.expected_go_live_date > expectedTo)) return false;
      return true;
    });

    if (sortField !== "none") {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...filtered].sort((a, b) => {
        switch (sortField) {
          case "merchantName": return dir * a.merchant_name.localeCompare(b.merchant_name);
          case "arr": return dir * ((a.arr ?? 0) - (b.arr ?? 0));
          case "stage": return dir * stageText(a.id).localeCompare(stageText(b.id));
          case "confidence": return dir * (insights[a.id]?.confidence || "").localeCompare(insights[b.id]?.confidence || "");
          case "owner": return dir * (owners[a.assigned_owner || ""] || "").localeCompare(owners[b.assigned_owner || ""] || "");
          case "expected": return dir * (a.expected_go_live_date || "").localeCompare(b.expected_go_live_date || "");
          default: return 0;
        }
      });
    }

    return [...filtered].sort((a, b) => {
      const aBlocked = a.project_state === "blocked" ? 0 : 1;
      const bBlocked = b.project_state === "blocked" ? 0 : 1;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return (a.expected_go_live_date || "").localeCompare(b.expected_go_live_date || "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, searchQuery, stageFilter, stateFilter, confidenceFilter, needsAttentionOnly, riskVerdicts, arrMin, arrMax, expectedFrom, expectedTo, sortField, sortDir, insights, owners, funnelStages]);

  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = -6; i <= 6; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return opts;
  }, []);

  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => set.add(stageOf(p.id)));
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, funnelStages]);

  // Count only columns that still exist: "csm" was removed and may linger in a
  // saved arrangement, which would widen the empty-state colspan.
  const visibleColCount = 1 + ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).length;

  const toolbar = (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <ToolbarIconButton icon={<ArrowUpDown className="h-3.5 w-3.5" />} label="Sort" count={sortField !== "none" ? 1 : 0} />
            </PopoverTrigger>
            <PopoverContent align="start" className={TOOLBAR_POPOVER.sort}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Sort By</p>
                {sortField !== "none" && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSortField("none"); setSortDir("asc"); }}>Clear</Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Field</label>
                  <Select value={sortField} onValueChange={setSortField}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="merchantName">Opportunity</SelectItem>
                      <SelectItem value="arr">{arrLabel}</SelectItem>
                      <SelectItem value="stage">{stageLabel}</SelectItem>
                      <SelectItem value="confidence">Confidence</SelectItem>
                      <SelectItem value="owner">{ownerLabel}</SelectItem>
                      <SelectItem value="expected">{expectedLabel}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Direction</label>
                  <Select value={sortDir} onValueChange={(v) => setSortDir(v as "asc" | "desc")}>
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

          {/* Filters */}
          <Popover>
            <PopoverTrigger asChild>
              <ToolbarIconButton icon={<Filter className="h-3.5 w-3.5" />} label="Filters" count={activeFilterCount} />
            </PopoverTrigger>
            <PopoverContent align="start" collisionPadding={16} className={TOOLBAR_POPOVER.filters} style={TOOLBAR_PANEL_MAX_H}>
              <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
                <p className="text-xs font-semibold">Filters</p>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1" onClick={clearFilters}><X className="h-3 w-3" /> Reset</Button>
                )}
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer border-b pb-2">
                <Checkbox checked={needsAttentionOnly} onCheckedChange={v => setNeedsAttentionOnly(!!v)} className="h-3.5 w-3.5" />
                <span className="text-xs text-muted-foreground">Needs attention only</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: stageLabel, values: stageFilter, setter: setStageFilter, options: stageOptions.map(s => ({ value: s, label: funnelStageLabels[s] || s })) },
                  { label: stateLabel, values: stateFilter, setter: setStateFilter, options: Object.keys(projectStateLabels).map(s => ({ value: s, label: projectStateLabels[s as keyof typeof projectStateLabels] })) },
                  { label: "Confidence", values: confidenceFilter, setter: setConfidenceFilter, options: ["High", "Medium", "Low"].map(c => ({ value: c, label: c })) },
                ].map(({ label, values, setter, options }) => (
                  <div key={label} className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium">{label}</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between h-8 text-xs font-normal">
                          <span className="truncate">{values.length === 0 ? `All` : `${values.length} selected`}</span>
                          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {options.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm">
                              <Checkbox checked={values.includes(opt.value)} onCheckedChange={() => toggleValue(setter, opt.value)} />
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
                  <label className="text-xs text-muted-foreground font-medium">{arrLabel} Range (Cr)</label>
                  <div className="flex gap-1">
                    <Input type="number" placeholder="Min" value={arrMin} onChange={e => setArrMin(e.target.value)} className="w-full h-9 text-xs" />
                    <Input type="number" placeholder="Max" value={arrMax} onChange={e => setArrMax(e.target.value)} className="w-full h-9 text-xs" />
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-foreground font-medium">{expectedLabel} Range</label>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                    <Input type="date" value={expectedFrom} onChange={e => setExpectedFrom(e.target.value)} className="h-9 text-xs min-w-0" />
                    <span className="text-xs text-muted-foreground px-1">to</span>
                    <Input type="date" value={expectedTo} onChange={e => setExpectedTo(e.target.value)} className="h-9 text-xs min-w-0" />
                  </div>
                </div>
              </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Select Columns */}
          <Popover>
            <PopoverTrigger asChild>
              <ToolbarIconButton icon={<ListChecks className="h-3.5 w-3.5" />} label="Select columns" />
            </PopoverTrigger>
            <PopoverContent className={TOOLBAR_POPOVER.columns} align="end">
              <p className="text-xs font-semibold text-muted-foreground mb-2 tracking-normal">Visible Columns</p>
              <div className="space-y-1 max-h-[300px] overflow-auto">
                {ALL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer text-sm hover:bg-muted/50 rounded">
                    <Checkbox checked={isVisible(col.key)} onCheckedChange={() => toggleColumn(col.key)} className="h-4 w-4" />
                    {col.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map(m => <SelectItem key={m} value={m}>{ymToLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <ToolbarIconButton
            icon={aiLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            label="Refresh AI"
            onClick={runAiRefresh}
            disabled={aiLoading}
          />
        </div>
      </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
      <Card className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="h-1 w-full shrink-0 bg-navy" />
            <div className="min-h-0 flex-1 overflow-auto">
            <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible" className="text-sm w-full [&_td]:py-2 [&_th]:py-2 [&_td]:align-middle">
              <TableHeader className="sticky top-0 z-10 table-header-tint">
                <TableRow className="hover:bg-navy/5 border-b">
                  <TableHead className="font-semibold whitespace-nowrap min-w-[180px] text-navy">Opportunity</TableHead>
                  {isVisible("arr") && <TableHead className="font-semibold text-right whitespace-nowrap text-navy">{arrLabel} Cr.</TableHead>}
                  {isVisible("stage") && <TableHead className="font-semibold whitespace-nowrap text-navy">{stageLabel}</TableHead>}
                  {isVisible("status") && <TableHead className="font-semibold whitespace-nowrap text-navy">{stateLabel}</TableHead>}
                  {isVisible("blocker") && <TableHead className="font-semibold min-w-[240px] max-w-[340px] text-navy">Blocker</TableHead>}
                  {isVisible("blocked_on") && <TableHead className="font-semibold min-w-[120px] text-navy">Blocked On</TableHead>}
                  {isVisible("deadline") && <TableHead className="font-semibold min-w-[100px] text-navy">Deadline</TableHead>}
                  {isVisible("confidence") && <TableHead className="font-semibold whitespace-nowrap text-navy">Confidence</TableHead>}
                  {isVisible("owner") && <TableHead className="font-semibold whitespace-nowrap min-w-[140px] text-navy">{ownerLabel}</TableHead>}
                  {isVisible("expected") && <TableHead className="font-semibold whitespace-nowrap text-navy">{expectedLabel}</TableHead>}
                  {SYSTEM_COLUMNS.map(col => isVisible(col.key) && (
                    <TableHead key={col.key} className="font-semibold whitespace-nowrap text-navy">{col.label}</TableHead>
                  ))}
                  {customFields.map(cf => isVisible(`custom_field_${cf.id}`) && (
                    <TableHead key={cf.id} className="font-semibold whitespace-nowrap text-navy">{cf.field_label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={visibleColCount} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && sortedRows.length === 0 && <TableRow><TableCell colSpan={visibleColCount} className="text-center text-muted-foreground py-8">No projects for {ymToLabel(month)}.</TableCell></TableRow>}
              {sortedRows.map(p => {
                const i = insights[p.id];
                const isBlocked = p.project_state === "blocked" || (i?.confidence?.toLowerCase() === "low");
                const conf = i?.confidence || "";
                const blockerText = i?.blocker || "";
                const isUrl = /^https?:\/\//i.test(blockerText);
                const stage = stageOf(p.id);
                return (
                  <TableRow key={p.id} onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: p.id }, search: { from: "go-live" } })} className={cn("cursor-pointer hover:bg-muted/40", isBlocked && "bg-red-50/40 dark:bg-red-500/5")}>
                    <TableCell className={cn("font-medium whitespace-nowrap", isBlocked && "text-red-600 dark:text-red-400")} title={p.merchant_name}>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); navigate({ to: "/projects/$projectId", params: { projectId: p.id }, search: { from: "go-live" } }); }}
                        className="max-w-[220px] truncate text-left hover:text-primary hover:underline cursor-pointer"
                      >
                        {p.merchant_name}
                      </button>
                      <RiskBadge projectId={p.id} verdict={riskVerdicts[p.id]} className="ml-1.5 align-middle" />
                    </TableCell>
                    {isVisible("arr") && <TableCell className="text-right tabular-nums whitespace-nowrap">{p.arr != null ? arrCroreValue(p.arr) : "—"}</TableCell>}
                    {isVisible("stage") && (
                      <TableCell className="whitespace-nowrap">
                        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", STAGE_BADGE[stage] || "bg-navy text-navy-foreground")}>{funnelStageLabels[stage] || "—"}</span>
                      </TableCell>
                    )}
                    {isVisible("status") && (
                      <TableCell className="whitespace-nowrap text-sm">
                        {projectStateLabels[p.project_state as keyof typeof projectStateLabels] || "—"}
                      </TableCell>
                    )}
                    {isVisible("blocker") && (
                    <TableCell className="align-top max-w-[340px]">
                      {isUrl ? (
                        <a href={blockerText.split(" ")[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline break-all">
                          <span>{blockerText.split(" — ")[0].replace(/^https?:\/\/[^/]+\/browse\//, "")}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <textarea
                          value={blockerText}
                          // Grow to fit on mount too, not only while typing —
                          // otherwise saved text loads clipped to a single row.
                          ref={el => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
                          onChange={e => {
                            setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), blocker: e.target.value } }));
                            e.currentTarget.style.height = "auto";
                            e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                          }}
                          onBlur={e => updateInsight(p.id, "blocker", e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full min-h-[28px] resize-none whitespace-pre-wrap break-words border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                          placeholder="—"
                          rows={1}
                        />
                      )}
                    </TableCell>
                    )}
                    {isVisible("blocked_on") && (
                    <TableCell className="align-top">
                      <textarea
                        value={i?.blocked_on || ""}
                        onChange={e => {
                          setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), blocked_on: e.target.value } }));
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                        }}
                        onBlur={e => updateInsight(p.id, "blocked_on", e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full min-h-[28px] resize-none whitespace-pre-wrap break-words border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                        placeholder="—"
                        rows={1}
                      />
                    </TableCell>
                    )}
                    {isVisible("deadline") && (
                    <TableCell className="align-top">
                      <textarea
                        value={i?.deadline || ""}
                        onChange={e => {
                          setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), deadline: e.target.value } }));
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                        }}
                        onBlur={e => updateInsight(p.id, "deadline", e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full min-h-[28px] resize-none whitespace-pre-wrap break-words border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                        placeholder="—"
                        rows={1}
                      />
                    </TableCell>
                    )}
                    {isVisible("confidence") && (
                    <TableCell className="whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <Select value={conf} onValueChange={v => updateInsight(p.id, "confidence", v)}>
                        <SelectTrigger className={cn("h-7 border-0 bg-transparent w-[100px] px-2", conf && CONF_BADGE[conf], conf && "rounded-md font-medium")}><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="High">High</SelectItem>
                          <SelectItem value="Medium">Medium</SelectItem>
                          <SelectItem value="Low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    )}
                    {isVisible("owner") && (
                    <TableCell className="whitespace-nowrap" title={owners[p.assigned_owner || ""] || ""}>
                      <div className="max-w-[160px] truncate">{owners[p.assigned_owner || ""] || "—"}</div>
                    </TableCell>
                    )}
                    {isVisible("expected") && (
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {dateLabel(p.expected_go_live_date)}
                        {fullProjects.find(fp => fp.id === p.id)?.dates?.expectedGoLiveDateIsDerived && (
                          <span className="ml-1 text-[10px] text-muted-foreground" title="Estimated from the latest checklist due date — no go-live date has been set on this project">est.</span>
                        )}
                      </TableCell>
                    )}
                    {SYSTEM_COLUMNS.map(col => isVisible(col.key) && (
                      <TableCell key={col.key} className="whitespace-nowrap text-sm">{systemValue(p.id, col.key)}</TableCell>
                    ))}
                    {customFields.map(cf => isVisible(`custom_field_${cf.id}`) && (
                      <TableCell key={cf.id} className="whitespace-nowrap text-sm">
                        {customValuesMap[p.id]?.[cf.id] || "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            </div>
        </CardContent>
      </Card>

      {editingProject && (
        <EditProjectDialog
          project={editingProject}
          open={!!editProjectId}
          onOpenChange={(o) => { if (!o) setEditProjectId(null); }}
          onSave={(updated) => {
            updateProject(updated);
            toast.success("Project updated");
            load();
          }}
        />
      )}
    </div>
  );
};
