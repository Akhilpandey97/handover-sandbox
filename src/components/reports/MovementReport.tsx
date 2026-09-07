import { useMemo, useState } from "react";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import {
  Project,
  FunnelStage,
  funnelStageLabels,
  getProjectFunnelStage,
  projectStateLabels,
} from "@/data/projectsData";
import { useMovementReport, MovementEntry } from "@/hooks/useMovementReport";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw, Filter, Mail, ExternalLink, Loader2, Sparkles, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { ProjectDetailsDialog } from "@/components/ProjectDetailsDialog";
import { EmailReportDialog } from "./EmailReportDialog";
import { ScheduleMovementReportDialog } from "./ScheduleMovementReportDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  timeframe: "daily" | "weekly";
}

type Bucket = "wins" | "updates" | "lowlights";

const FilterGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const CheckRow = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) => (
  <label className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/60 px-2 py-1 rounded">
    <Checkbox checked={checked} onCheckedChange={onChange} />
    <span>{label}</span>
  </label>
);

// ---------- Helpers ----------

const formatArr = (arr: number | undefined | null): string => {
  if (arr == null || isNaN(Number(arr))) return "TBD";
  const v = Number(arr);
  if (v === 0) return "TBD";
  // values are stored in Cr already? Most other UI shows raw — keep 2 decimals
  return `${v.toFixed(2)} Cr`;
};

const formatEgl = (d: string | undefined | null): string => {
  if (!d) return "TBD";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "TBD";
  return format(dt, "dd MMM");
};

const cleanDescription = (s: string): string =>
  (s || "").replace(/\s+/g, " ").trim();

// A project can resolve to a stage that was since renamed or deleted in
// Settings → Project Stages, so anything unrecognised falls back to "none".
const resolveStageKey = (p: Project, funnelOrder: FunnelStage[]): FunnelStage => {
  const stage = getProjectFunnelStage(p);
  return funnelOrder.includes(stage) ? stage : "none";
};

const buildSummary = (entries: MovementEntry[], maxParts = 3): string => {
  if (!entries.length) return "";
  // de-dupe by description, prefer most recent first (entries are already newest-first)
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const e of entries) {
    const d = cleanDescription(e.description);
    if (!d) continue;
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(d);
    if (parts.length >= maxParts) break;
  }
  let out = parts.join("; ");
  if (out.length > 320) out = out.slice(0, 317) + "...";
  return out;
};

const PHASE_RANK: Record<string, number> = {
  sales: 0, pre_integration: 1, mint: 2, integration: 2, under_integration: 2, ms: 2, live: 3,
};
const phaseRank = (v: string | undefined | null): number => {
  if (!v) return -1;
  const k = String(v).toLowerCase().trim();
  return PHASE_RANK[k] ?? -1;
};
const LOWLIGHT_KEYWORDS_RX = /\b(not getting any update|no response|no responses|unresponsive|following up|awaiting response|chasing|reminder sent|haven't heard|still waiting|no eta)\b/i;
const WIN_RESOLVED_RX = /\b(resolved|unblocked|cleared|sign(ed)?[- ]off|approved|pg done|sandbox cleared|api(s)? validated)\b/i;
const EGL_FIELD_RX = /expected.?go.?live/i;
const PHASE_FIELD_RX = /^(current_phase|phase|project_state|state|funnel|stage)$/i;

const classifyProject = (p: Project, entries: MovementEntry[]): Bucket => {
  if (p.projectState === "on_hold" || p.projectState === "blocked") return "lowlights";
  if (!entries || entries.length === 0) return "lowlights";

  let funnelForward = false, funnelRegressed = false, wentLive = false, eglPushed = false;
  let checklistCompleted = 0;

  for (const e of entries) {
    for (const c of (e.changes || [])) {
      if (PHASE_FIELD_RX.test(c.field)) {
        const fr = phaseRank(c.from);
        const tr = phaseRank(c.to);
        if (fr >= 0 && tr >= 0) {
          if (tr > fr) funnelForward = true;
          if (tr < fr) funnelRegressed = true;
        }
        if (/live/i.test(c.to || "")) wentLive = true;
      }
      if (EGL_FIELD_RX.test(c.field)) {
        const fd = new Date(c.from).getTime();
        const td = new Date(c.to).getTime();
        if (!isNaN(fd) && !isNaN(td) && td > fd) eglPushed = true;
      }
    }
    if (e.category === "checklist") {
      if ((e.actionType && /complet/i.test(e.actionType)) ||
          /\b(completed|marked complete|checked off|ticked off)\b/i.test(e.description || "")) {
        checklistCompleted++;
      }
    }
  }

  const allText = entries.map(e => (e.description || "")).join(" ");

  // Lowlights (hard signals)
  if (eglPushed) return "lowlights";
  if (funnelRegressed) return "lowlights";
  if (LOWLIGHT_KEYWORDS_RX.test(allText)) return "lowlights";

  // Wins (hard signals)
  if (wentLive || p.projectState === "live") return "wins";
  if (funnelForward) return "wins";
  if (checklistCompleted >= 1) return "wins";
  if (WIN_RESOLVED_RX.test(allText)) return "wins";

  return "updates";
};

export interface AiSummary { bucket: Bucket; line1: string; line2: string; }

// ---------- Email HTML builder (funnel-wise) ----------

const buildFunnelEmailHtml = (
  title: string,
  windowLabel: string,
  filtered: Project[],
  movementMap: Record<string, MovementEntry[]>,
  aiMap: Record<string, AiSummary>,
  funnelOrder: FunnelStage[],
): string => {
  const isActive = (p: Project) => (movementMap[p.id]?.length ?? 0) > 0;

  const renderLine = (p: Project) => {
    const ai = aiMap[p.id];
    const entries = movementMap[p.id] || [];
    const fallback = buildSummary(entries, 2) || "No specific updates captured this period.";
    const funnel = funnelStageLabels[getProjectFunnelStage(p)];
    const line1 = ai?.line1 || fallback;
    const line2 = ai?.line2 || "";
    return `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;line-height:1.5;color:#1e293b;">
      <div><strong style="font-size:14px;">${escapeHtml(p.merchantName)}</strong></div>
      <div style="color:#475569;font-size:12px;margin:2px 0 6px;">ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.dates?.expectedGoLiveDate))}</strong> &nbsp;|&nbsp; ${escapeHtml(funnel)} · ${escapeHtml(projectStateLabels[p.projectState])}</div>
      <div>${escapeHtml(line1)}</div>
      ${line2 ? `<div style="color:#475569;margin-top:2px;">${escapeHtml(line2)}</div>` : ""}
    </div>`;
  };

  const totalActive = filtered.filter(isActive).length;
  const totalInactive = filtered.length - totalActive;

  let html = `<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1e293b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 14px;color:#64748b;font-size:12px;">${escapeHtml(windowLabel)} · Generated ${format(new Date(), "dd MMM yyyy, HH:mm")}</p>`;
  html += `<div style="background:#f1f5f9;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:20px;">
    <strong>${filtered.length}</strong> projects · <strong style="color:#059669;">${totalActive}</strong> Active · <strong style="color:#64748b;">${totalInactive}</strong> Inactive
  </div>`;

  for (const stage of funnelOrder) {
    const list = filtered.filter(p => resolveStageKey(p, funnelOrder) === stage);
    if (list.length === 0) continue;
    const active = list.filter(isActive);
    const inactive = list.filter(p => !isActive(p));

    html += `<div style="margin-bottom:26px;">
      <h2 style="font-size:14px;margin:0 0 10px;padding:8px 12px;background:#0f172a;color:#fff;border-radius:4px;">
        ${escapeHtml(funnelStageLabels[stage])} · ${list.length} projects · ${active.length} Active / ${inactive.length} Inactive
      </h2>`;
    if (active.length > 0) {
      html += active.map(renderLine).join("");
    } else {
      html += `<p style="color:#94a3b8;font-size:12px;margin:0 0 6px;">No movement this period.</p>`;
    }
    if (inactive.length > 0) {
      html += `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:12px;color:#94a3b8;">
        <strong style="color:#64748b;">Inactive (${inactive.length}):</strong> ${inactive.map(p => escapeHtml(p.merchantName)).join(", ")}
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
};

// ---------- Email HTML builder (Wins / Updates / Lowlights for weekly) ----------

const buildBucketedEmailHtml = (
  title: string,
  windowLabel: string,
  activeBuckets: Record<Bucket, Project[]>,
  inactive: Project[],
  movementMap: Record<string, MovementEntry[]>,
  aiMap: Record<string, AiSummary>,
): string => {
  const renderLine = (p: Project) => {
    const ai = aiMap[p.id];
    const entries = movementMap[p.id] || [];
    const fallback = buildSummary(entries, 2) || "No specific updates captured this period.";
    const funnel = funnelStageLabels[getProjectFunnelStage(p)];
    const line1 = ai?.line1 || fallback;
    const line2 = ai?.line2 || "";
    return `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;line-height:1.5;color:#1e293b;">
      <div><strong style="font-size:14px;">${escapeHtml(p.merchantName)}</strong></div>
      <div style="color:#475569;font-size:12px;margin:2px 0 6px;">ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.dates?.expectedGoLiveDate))}</strong> &nbsp;|&nbsp; ${escapeHtml(funnel)} · ${escapeHtml(projectStateLabels[p.projectState])}</div>
      <div>${escapeHtml(line1)}</div>
      ${line2 ? `<div style="color:#475569;margin-top:2px;">${escapeHtml(line2)}</div>` : ""}
    </div>`;
  };

  const section = (label: string, color: string, list: Project[], emptyText: string) => {
    const body = list.length === 0
      ? `<p style="color:#94a3b8;font-size:12px;margin:0;">${emptyText}</p>`
      : list.map(renderLine).join("");
    return `<div style="margin-bottom:24px;">
      <h2 style="font-size:15px;margin:0 0 8px;padding:6px 10px;background:${color};color:#fff;border-radius:4px;display:inline-block;">${label} (${list.length})</h2>
      ${body}
    </div>`;
  };

  let html = `<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1e293b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 18px;color:#64748b;font-size:12px;">${escapeHtml(windowLabel)} · Generated ${format(new Date(), "dd MMM yyyy, HH:mm")}</p>`;
  html += section("Wins", "#059669", activeBuckets.wins, "No new wins this period.");
  html += section("Updates", "#2563eb", activeBuckets.updates, "No active updates this period.");
  html += section("Lowlights", "#dc2626", activeBuckets.lowlights, "No lowlights this period.");
  if (inactive.length > 0) {
    html += `<div style="margin-top:32px;">
      <h2 style="font-size:14px;color:#64748b;margin:0 0 8px;border-top:1px solid #e2e8f0;padding-top:14px;">Inactive (${inactive.length})</h2>
      <p style="margin:0;font-size:12px;color:#94a3b8;">${inactive.map(p => escapeHtml(p.merchantName)).join(", ")}</p>
    </div>`;
  }
  html += `</div>`;
  return html;
};

// ---------- Main component ----------

export const MovementReport = ({ timeframe }: Props) => {
  const { projects } = useProjects();
  const { teamLabels } = useLabels();
  const { stages } = useFunnelConfig();
  const { data: movementMap = {}, isLoading, refetch, isFetching, dataUpdatedAt } = useMovementReport(timeframe);

  // Stages are configured most-advanced-first (first rule to match wins), so the
  // report reverses them to read earliest-first and appends the unmatched bucket.
  const funnelOrder = useMemo<FunnelStage[]>(
    () => [...stages].reverse().map(s => s.id).concat("none"),
    [stages],
  );
  const funnelRank = useMemo(
    () => funnelOrder.reduce((acc, s, i) => { acc[s] = i; return acc; }, {} as Record<FunnelStage, number>),
    [funnelOrder],
  );

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [aiMap, setAiMap] = useState<Record<string, AiSummary>>({});
  const [aiLoading, setAiLoading] = useState(false);

  const [funnelFilter, setFunnelFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [responsibilityFilter, setResponsibilityFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]); // active / inactive
  const [arrMin, setArrMin] = useState("");
  const [arrMax, setArrMax] = useState("");

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, v: string) =>
    setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const resetFilters = () => {
    setFunnelFilter([]); setTeamFilter([]); setStateFilter([]); setResponsibilityFilter([]);
    setPlatformFilter([]); setStatusFilter([]); setArrMin(""); setArrMax("");
  };

  const activeFilterCount = [funnelFilter, teamFilter, stateFilter, responsibilityFilter, platformFilter, statusFilter]
    .reduce((s, a) => s + a.length, 0) + (arrMin ? 1 : 0) + (arrMax ? 1 : 0);

  const platforms = useMemo(
    () => Array.from(new Set(projects.map(p => p.platform).filter(Boolean))).sort(),
    [projects]
  );
  const teams = useMemo(
    () => Array.from(new Set(projects.map(p => p.currentOwnerTeam).filter(Boolean))).sort(),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (p.archived) return false;
      const isActive = (movementMap[p.id]?.length ?? 0) > 0;
      const status = isActive ? "active" : "inactive";
      if (statusFilter.length && !statusFilter.includes(status)) return false;
      if (funnelFilter.length && !funnelFilter.includes(resolveStageKey(p, funnelOrder))) return false;
      if (teamFilter.length && !teamFilter.includes(p.currentOwnerTeam)) return false;
      if (stateFilter.length && !stateFilter.includes(p.projectState)) return false;
      if (responsibilityFilter.length && !responsibilityFilter.includes(p.currentResponsibility)) return false;
      if (platformFilter.length && !platformFilter.includes(p.platform)) return false;
      if (arrMin && p.arr < parseFloat(arrMin)) return false;
      if (arrMax && p.arr > parseFloat(arrMax)) return false;
      return true;
    });
  }, [projects, movementMap, funnelOrder, funnelFilter, teamFilter, stateFilter, responsibilityFilter, platformFilter, statusFilter, arrMin, arrMax]);

  const grouped = useMemo(() => {
    const g: Record<FunnelStage, Project[]> = {};
    for (const stage of funnelOrder) g[stage] = [];
    for (const p of filteredProjects) {
      g[resolveStageKey(p, funnelOrder)].push(p);
    }
    return g;
  }, [filteredProjects, funnelOrder]);

  const totals = useMemo(() => {
    let active = 0, total = 0;
    for (const p of filteredProjects) {
      total++;
      if ((movementMap[p.id]?.length ?? 0) > 0) active++;
    }
    return { active, total, inactive: total - active };
  }, [filteredProjects, movementMap]);

  // Daily = funnel-wise; Weekly = Wins/Updates/Lowlights
  const buildHtml = () => {
    const windowLabel = timeframe === "daily" ? `Today (IST) · ${startLabel}` : `This week (Mon–today IST) · ${startLabel}`;
    const reportTitle = `${timeframe === "daily" ? "Daily" : "Weekly"} Movement Report`;
    const byFunnel = (a: Project, b: Project) =>
      (funnelRank[resolveStageKey(a, funnelOrder)] ?? 99) - (funnelRank[resolveStageKey(b, funnelOrder)] ?? 99);

    if (timeframe === "daily") {
      const sorted = [...filteredProjects].sort(byFunnel);
      return buildFunnelEmailHtml(reportTitle, windowLabel, sorted, movementMap, aiMap, funnelOrder);
    }

    const activeBuckets: Record<Bucket, Project[]> = { wins: [], updates: [], lowlights: [] };
    for (const p of filteredProjects) {
      const entries = movementMap[p.id] || [];
      // Always classify deterministically; AI only writes prose.
      const bucket = classifyProject(p, entries);
      activeBuckets[bucket].push(p);
    }
    const byArrDesc = (a: Project, b: Project) => (Number(b.arr) || 0) - (Number(a.arr) || 0);
    activeBuckets.wins.sort(byArrDesc);
    activeBuckets.updates.sort(byArrDesc);
    activeBuckets.lowlights.sort(byArrDesc);
    return buildBucketedEmailHtml(reportTitle, windowLabel, activeBuckets, [], movementMap, aiMap);
  };

  const generateAiSummaries = async () => {
    const activeProjects = filteredProjects.filter(p => (movementMap[p.id]?.length ?? 0) > 0);
    if (activeProjects.length === 0) return;
    setAiLoading(true);
    try {
      const items = activeProjects.map(p => ({
        id: p.id,
        merchantName: p.merchantName,
        funnel: funnelStageLabels[getProjectFunnelStage(p)],
        projectState: projectStateLabels[p.projectState],
        arr: formatArr(p.arr),
        egl: formatEgl(p.dates?.expectedGoLiveDate),
        bucket: classifyProject(p, movementMap[p.id] || []),
        entries: (movementMap[p.id] || []).slice(0, 25).map(e => ({
          ts: e.timestamp, category: e.category, description: cleanDescription(e.description),
        })),
      }));

      // Chunk to keep prompts manageable
      const chunkSize = 12;
      const merged: Record<string, AiSummary> = {};
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const res = await fetch(`/api/public/ai-project-insights`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ type: "movement_summary", timeframe, items: chunk }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "AI request failed");
        for (const r of (data.result || []) as Array<{ id: string; bucket: Bucket; line1: string; line2: string }>) {
          merged[r.id] = { bucket: r.bucket, line1: r.line1, line2: r.line2 };
        }
      }
      setAiMap(prev => ({ ...prev, ...merged }));
      toast.success(`AI summaries generated for ${Object.keys(merged).length} projects`);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate AI summaries");
    } finally {
      setAiLoading(false);
    }
  };


  const title = timeframe === "daily" ? "Daily Report" : "Weekly Report";
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const istY = istNow.getUTCFullYear(), istM = istNow.getUTCMonth(), istD = istNow.getUTCDate();
  const istDow = istNow.getUTCDay();
  const mondayD = istD - ((istDow + 6) % 7);
  const startLabel = timeframe === "daily"
    ? format(new Date(Date.UTC(istY, istM, istD)), "dd MMM yyyy")
    : `${format(new Date(Date.UTC(istY, istM, mondayD)), "dd MMM")} – ${format(new Date(Date.UTC(istY, istM, istD)), "dd MMM yyyy")}`;
  const windowLabel = timeframe === "daily"
    ? `Today (IST) · ${startLabel}`
    : `This week (Mon–today IST) · ${startLabel}`;

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="portal-heading">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {windowLabel} · {totals.total} projects · {totals.active} active / {totals.inactive} inactive
              {dataUpdatedAt ? ` · Updated ${format(new Date(dataUpdatedAt), "HH:mm")}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                  {activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="end">
                <div className="flex items-center justify-between p-3 border-b">
                  <p className="font-semibold text-sm">Filters</p>
                  <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeFilterCount === 0}>Reset</Button>
                </div>
                <ScrollArea className="max-h-[500px] p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FilterGroup title="Status">
                      <CheckRow label="Active" checked={statusFilter.includes("active")} onChange={() => toggle(setStatusFilter, "active")} />
                      <CheckRow label="Inactive" checked={statusFilter.includes("inactive")} onChange={() => toggle(setStatusFilter, "inactive")} />
                    </FilterGroup>
                    <FilterGroup title="Project Stage">
                      {funnelOrder.map(s => (
                        <CheckRow key={s} label={funnelStageLabels[s]} checked={funnelFilter.includes(s)} onChange={() => toggle(setFunnelFilter, s)} />
                      ))}
                    </FilterGroup>
                    <FilterGroup title="Team">
                      {teams.map(t => (
                        <CheckRow key={t} label={teamLabels[t] || t} checked={teamFilter.includes(t)} onChange={() => toggle(setTeamFilter, t)} />
                      ))}
                    </FilterGroup>
                    <FilterGroup title="Project State">
                      {(Object.keys(projectStateLabels) as Array<keyof typeof projectStateLabels>).map(s => (
                        <CheckRow key={s} label={projectStateLabels[s]} checked={stateFilter.includes(s)} onChange={() => toggle(setStateFilter, s)} />
                      ))}
                    </FilterGroup>
                    <FilterGroup title="Responsibility">
                      {["gokwik", "merchant", "neutral"].map(r => (
                        <CheckRow key={r} label={r.charAt(0).toUpperCase() + r.slice(1)} checked={responsibilityFilter.includes(r)} onChange={() => toggle(setResponsibilityFilter, r)} />
                      ))}
                    </FilterGroup>
                    <FilterGroup title="Platform">
                      {platforms.slice(0, 12).map(p => (
                        <CheckRow key={p} label={p} checked={platformFilter.includes(p)} onChange={() => toggle(setPlatformFilter, p)} />
                      ))}
                    </FilterGroup>
                    <div className="col-span-2 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ARR Range</p>
                      <div className="flex gap-2">
                        <Input placeholder="Min" type="number" value={arrMin} onChange={(e) => setArrMin(e.target.value)} />
                        <Input placeholder="Max" type="number" value={arrMax} onChange={(e) => setArrMax(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={generateAiSummaries} disabled={aiLoading || isLoading} className="gap-2">
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {Object.keys(aiMap).length > 0 ? "Re-run AI" : "AI Summaries"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)} className="gap-2">
              <CalendarClock className="h-4 w-4" /> Schedule
            </Button>
            <Button size="sm" onClick={async () => {
              if (Object.keys(aiMap).length === 0) await generateAiSummaries();
              setEmailOpen(true);
            }} disabled={aiLoading} className="gap-2">
              <Mail className="h-4 w-4" /> Send via Email
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" /> Loading report...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">No projects match the current filters.</div>
        ) : (
          <div className="space-y-3">
            {funnelOrder.map(stage => {
              const list = grouped[stage];
              if (!list || list.length === 0) return null;
              const activeCount = list.filter(p => (movementMap[p.id]?.length ?? 0) > 0).length;
              return (
                <FunnelSection
                  key={stage}
                  stage={stage}
                  projects={list}
                  movementMap={movementMap}
                  aiMap={aiMap}
                  activeCount={activeCount}
                  onOpenProject={setSelectedProject}
                />
              );
            })}
          </div>
        )}
      </CardContent>

      {selectedProject && (
        <ProjectDetailsDialog
          project={selectedProject}
          open={!!selectedProject}
          onOpenChange={(o) => !o && setSelectedProject(null)}
        />
      )}
      <EmailReportDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        defaultSubject={`${title} — ${format(new Date(), "dd MMM yyyy")}`}
        htmlBody={buildHtml()}
      />
      <ScheduleMovementReportDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        timeframe={timeframe}
      />
    </Card>
  );
};

const bucketBadge = (b: Bucket) => {
  const map: Record<Bucket, { label: string; cls: string }> = {
    wins: { label: "Win", cls: "bg-emerald-600 hover:bg-emerald-600 text-white" },
    updates: { label: "Update", cls: "bg-blue-600 hover:bg-blue-600 text-white" },
    lowlights: { label: "Lowlight", cls: "bg-red-600 hover:bg-red-600 text-white" },
  };
  const m = map[b];
  return <Badge className={m.cls}>{m.label}</Badge>;
};

const FunnelSection = ({
  stage, projects, movementMap, aiMap, activeCount, onOpenProject,
}: {
  stage: FunnelStage;
  projects: Project[];
  movementMap: Record<string, MovementEntry[]>;
  aiMap: Record<string, AiSummary>;
  activeCount: number;
  onOpenProject: (p: Project) => void;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-foreground text-background hover:opacity-90 transition">
          <div className="flex items-center gap-3">
            <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "" : "-rotate-90")} />
            <span className="font-semibold text-sm">{funnelStageLabels[stage]}</span>
            <Badge variant="secondary">{projects.length} projects</Badge>
          </div>
          <div className="text-xs">
            <span className="text-emerald-300 font-semibold">{activeCount} active</span>
            <span className="opacity-60"> · {projects.length - activeCount} inactive</span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {projects.map(p => {
          const entries = movementMap[p.id] || [];
          const isActive = entries.length > 0;
          const ai = aiMap[p.id];
          const fallback = isActive ? buildSummary(entries, 3) : "";
          return (
            <div key={p.id} className="border border-border/50 rounded-lg p-3 bg-card hover:border-border transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => onOpenProject(p)}
                    className="font-semibold text-sm text-foreground hover:underline flex items-center gap-1.5"
                  >
                    {p.merchantName} <ExternalLink className="h-3 w-3 opacity-50" />
                  </button>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-medium text-foreground/80">ARR:</span> {formatArr(p.arr)}
                    <span className="mx-1.5">|</span>
                    <span className="font-medium text-foreground/80">EGL:</span> {formatEgl(p.dates?.expectedGoLiveDate)}
                    <span className="mx-1.5">|</span>
                    {funnelStageLabels[getProjectFunnelStage(p)]} · {projectStateLabels[p.projectState]}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {isActive && ai ? bucketBadge(ai.bucket) : (
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className={isActive ? "bg-emerald-600 hover:bg-emerald-600" : ""}
                    >
                      {isActive ? "Active" : "Inactive"}
                    </Badge>
                  )}
                </div>
              </div>
              {isActive && (ai || fallback) && (
                <div className="mt-2 text-xs leading-relaxed space-y-0.5">
                  <p className="text-foreground/90">{ai?.line1 || fallback}</p>
                  {ai?.line2 && <p className="text-muted-foreground">{ai.line2}</p>}
                </div>
              )}
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
};

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
