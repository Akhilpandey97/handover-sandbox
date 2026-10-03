import { Fragment, useMemo, useState } from "react";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Project,
  FunnelStage,
  funnelStageLabels,
  getProjectFunnelStage,
  projectStateLabels,
} from "@/data/projectsData";
import { useMovementReport, MovementEntry } from "@/hooks/useMovementReport";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";
import { FilterPanel, FilterGroup, FilteredEmptyState } from "@/components/filters/FilterPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, RefreshCw, Filter, Mail, ExternalLink, Loader2, Sparkles, CalendarClock, Columns3, Download, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ProjectDialog } from "@/components/ProjectDialog";
import { EmailReportDialog } from "./EmailReportDialog";
import { ScheduleMovementReportDialog } from "./ScheduleMovementReportDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiAuthHeaders } from "@/lib/api-invoke";

interface Props {
  timeframe: "daily" | "weekly";
}

type Bucket = "wins" | "updates" | "lowlights";

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

/** The optional columns, in the order they sit in the table. */
const COLUMN_KEYS: { key: string; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "arr", label: "ARR" },
  { key: "egl", label: "EGL" },
  { key: "owner", label: "Owner" },
  { key: "progress", label: "Progress" },
  { key: "updated", label: "Last Update" },
];

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";

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
  brandColor: string,
): string => {
  const isActive = (p: Project) => (movementMap[p.id]?.length ?? 0) > 0;

  const renderLine = (p: Project) => {
    const ai = aiMap[p.id];
    const entries = movementMap[p.id] || [];
    const fallback = buildSummary(entries, 2) || "No specific updates captured this period.";
    const funnel = funnelStageLabels[getProjectFunnelStage(p)];
    const line1 = ai?.line1 || fallback;
    const line2 = ai?.line2 || "";
    return `<div style="padding:10px 0;border-bottom:1px solid #eef3f6;font-size:13px;line-height:1.5;color:#11263b;">
      <div><strong style="font-size:14px;">${escapeHtml(p.merchantName)}</strong></div>
      <div style="color:#3b5466;font-size:12px;margin:2px 0 6px;">ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.dates?.expectedGoLiveDate))}</strong> &nbsp;|&nbsp; ${escapeHtml(funnel)} · ${escapeHtml(projectStateLabels[p.projectState])}</div>
      <div>${escapeHtml(line1)}</div>
      ${line2 ? `<div style="color:#3b5466;margin-top:2px;">${escapeHtml(line2)}</div>` : ""}
    </div>`;
  };

  const totalActive = filtered.filter(isActive).length;
  const totalInactive = filtered.length - totalActive;

  let html = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#11263b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 14px;color:#546978;font-size:12px;">${escapeHtml(windowLabel)} · Generated ${format(new Date(), "dd MMM yyyy, HH:mm")}</p>`;
  html += `<div style="background:#eef3f6;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:20px;">
    <strong>${filtered.length}</strong> projects · <strong style="color:#116958;">${totalActive}</strong> Active · <strong style="color:#546978;">${totalInactive}</strong> Inactive
  </div>`;

  for (const stage of funnelOrder) {
    const list = filtered.filter(p => resolveStageKey(p, funnelOrder) === stage);
    if (list.length === 0) continue;
    const active = list.filter(isActive);
    const inactive = list.filter(p => !isActive(p));

    html += `<div style="margin-bottom:26px;">
      <h2 style="font-size:14px;margin:0 0 10px;padding:8px 12px;background:${brandColor};color:#ffffff;border-radius:4px;">
        ${escapeHtml(funnelStageLabels[stage])} · ${list.length} projects · ${active.length} Active / ${inactive.length} Inactive
      </h2>`;
    if (active.length > 0) {
      html += active.map(renderLine).join("");
    } else {
      html += `<p style="color:#546978;font-size:12px;margin:0 0 6px;">No movement this period.</p>`;
    }
    if (inactive.length > 0) {
      html += `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #d5e0e6;font-size:12px;color:#546978;">
        <strong style="color:#546978;">Inactive (${inactive.length}):</strong> ${inactive.map(p => escapeHtml(p.merchantName)).join(", ")}
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
  brandColor: string,
): string => {
  const renderLine = (p: Project) => {
    const ai = aiMap[p.id];
    const entries = movementMap[p.id] || [];
    const fallback = buildSummary(entries, 2) || "No specific updates captured this period.";
    const funnel = funnelStageLabels[getProjectFunnelStage(p)];
    const line1 = ai?.line1 || fallback;
    const line2 = ai?.line2 || "";
    return `<div style="padding:10px 0;border-bottom:1px solid #eef3f6;font-size:13px;line-height:1.5;color:#11263b;">
      <div><strong style="font-size:14px;">${escapeHtml(p.merchantName)}</strong></div>
      <div style="color:#3b5466;font-size:12px;margin:2px 0 6px;">ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.dates?.expectedGoLiveDate))}</strong> &nbsp;|&nbsp; ${escapeHtml(funnel)} · ${escapeHtml(projectStateLabels[p.projectState])}</div>
      <div>${escapeHtml(line1)}</div>
      ${line2 ? `<div style="color:#3b5466;margin-top:2px;">${escapeHtml(line2)}</div>` : ""}
    </div>`;
  };

  const section = (label: string, color: string, list: Project[], emptyText: string) => {
    const body = list.length === 0
      ? `<p style="color:#546978;font-size:12px;margin:0;">${emptyText}</p>`
      : list.map(renderLine).join("");
    return `<div style="margin-bottom:24px;">
      <h2 style="font-size:15px;margin:0 0 8px;padding:6px 10px;background:${color};color:#ffffff;border-radius:4px;display:inline-block;">${label} (${list.length})</h2>
      ${body}
    </div>`;
  };

  let html = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#11263b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 18px;color:#546978;font-size:12px;">${escapeHtml(windowLabel)} · Generated ${format(new Date(), "dd MMM yyyy, HH:mm")}</p>`;
  html += section("Wins", "#116958", activeBuckets.wins, "No new wins this period.");
  html += section("Updates", brandColor, activeBuckets.updates, "No active updates this period.");
  html += section("Lowlights", "#ad1f1f", activeBuckets.lowlights, "No lowlights this period.");
  if (inactive.length > 0) {
    html += `<div style="margin-top:32px;">
      <h2 style="font-size:14px;color:#546978;margin:0 0 8px;border-top:1px solid #d5e0e6;padding-top:14px;">Inactive (${inactive.length})</h2>
      <p style="margin:0;font-size:12px;color:#546978;">${inactive.map(p => escapeHtml(p.merchantName)).join(", ")}</p>
    </div>`;
  }
  html += `</div>`;
  return html;
};

// ---------- Main component ----------

export const MovementReport = ({ timeframe }: Props) => {
  const { projects } = useProjects();
  const { teamLabels, labels } = useLabels();
  const brandColor = labels["color_brand"] || "#0074F8";
  const { currentUser } = useAuth();
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

  // The row of quick filters above the table, composing with the fuller popover.
  const [search, setSearch] = useState("");
  const [quickGroup, setQuickGroup] = useState("all");
  const [quickState, setQuickState] = useState("all");
  const [quickOwner, setQuickOwner] = useState("all");
  const [visibleCols, setVisibleCols] = useState<string[]>(COLUMN_KEYS.map(c => c.key));

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
      if (quickGroup !== "all" && resolveStageKey(p, funnelOrder) !== quickGroup) return false;
      if (quickState !== "all" && p.projectState !== quickState) return false;
      if (quickOwner !== "all" && (p.assignedOwnerName || "Unassigned") !== quickOwner) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!p.merchantName.toLowerCase().includes(q) && !(p.mid || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [projects, movementMap, funnelOrder, funnelFilter, teamFilter, stateFilter, responsibilityFilter, platformFilter, statusFilter, arrMin, arrMax, quickGroup, quickState, quickOwner, search]);

  const ownerOptions = useMemo(
    () => Array.from(new Set(projects.filter(p => !p.archived).map(p => p.assignedOwnerName || "Unassigned"))).sort(),
    [projects],
  );
  const quickFilterCount = [search.trim() !== "", quickGroup !== "all", quickState !== "all", quickOwner !== "all"].filter(Boolean).length;
  const clearQuickFilters = () => { setSearch(""); setQuickGroup("all"); setQuickState("all"); setQuickOwner("all"); };
  const showCol = (key: string) => visibleCols.includes(key);

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
      return buildFunnelEmailHtml(reportTitle, windowLabel, sorted, movementMap, aiMap, funnelOrder, brandColor);
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
    return buildBucketedEmailHtml(reportTitle, windowLabel, activeBuckets, [], movementMap, aiMap, brandColor);
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
            ...(await apiAuthHeaders()),
          },
          body: JSON.stringify({ type: "movement_summary", timeframe, items: chunk, tenant_id: currentUser?.tenantId ?? null }),
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


  const exportCsv = () => {
    const cols = [{ key: "project", label: "Project / Merchant" }, ...COLUMN_KEYS.filter(c => showCol(c.key))];
    const cell = (p: Project, key: string): string => {
      const isActive = (movementMap[p.id]?.length ?? 0) > 0;
      switch (key) {
        case "project": return p.merchantName;
        case "status": return isActive ? "Active" : "Inactive";
        case "arr": return formatArr(p.arr);
        case "egl": return formatEgl(p.dates?.expectedGoLiveDate);
        case "owner": return p.assignedOwnerName || "Unassigned";
        case "progress": return `${p.goLivePercent ?? 0}%`;
        case "updated": return p.updatedAt ? format(new Date(p.updatedAt), "dd MMM yyyy HH:mm") : "—";
        default: return "";
      }
    };
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["Group", ...cols.map(c => c.label)].map(esc).join(",")];
    for (const stage of funnelOrder) {
      for (const p of grouped[stage] || []) {
        lines.push([funnelStageLabels[stage] || stage, ...cols.map(c => cell(p, c.key))].map(esc).join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${timeframe}-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            <FilterPanel count={activeFilterCount} onClear={resetFilters} align="end">
              <FilterGroup
                title="Status"
                options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
                selected={statusFilter}
                onToggle={(v) => toggle(setStatusFilter, v)}
              />
              <FilterGroup
                title="Project Stage"
                options={funnelOrder.map(st => ({ value: st, label: funnelStageLabels[st] || st }))}
                selected={funnelFilter}
                onToggle={(v) => toggle(setFunnelFilter, v)}
              />
              <FilterGroup
                title="Team"
                options={teams.map(t => ({ value: t, label: teamLabels[t] || t }))}
                selected={teamFilter}
                onToggle={(v) => toggle(setTeamFilter, v)}
              />
              <FilterGroup
                title="Project State"
                options={(Object.keys(projectStateLabels) as Array<keyof typeof projectStateLabels>).map(st => ({ value: st, label: projectStateLabels[st] }))}
                selected={stateFilter}
                onToggle={(v) => toggle(setStateFilter, v)}
              />
              <FilterGroup
                title="Responsibility"
                options={["gokwik", "merchant", "neutral"].map(r => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))}
                selected={responsibilityFilter}
                onToggle={(v) => toggle(setResponsibilityFilter, v)}
              />
              <FilterGroup
                title="Platform"
                options={platforms.map(pl => ({ value: pl, label: pl }))}
                selected={platformFilter}
                onToggle={(v) => toggle(setPlatformFilter, v)}
              />
              <div className="space-y-1 px-1.5 pb-1 pt-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">ARR Range</p>
                <div className="flex gap-1.5">
                  <Input placeholder="Min" type="number" value={arrMin} onChange={(e) => setArrMin(e.target.value)} className="h-7 text-xs" />
                  <Input placeholder="Max" type="number" value={arrMax} onChange={(e) => setArrMax(e.target.value)} className="h-7 text-xs" />
                </div>
              </div>
            </FilterPanel>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Columns3 className="h-4 w-4" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2" align="end">
                <p className="px-1 pb-1.5 text-xs font-semibold text-muted-foreground">Show columns</p>
                {COLUMN_KEYS.map(col => (
                  <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      checked={visibleCols.includes(col.key)}
                      onCheckedChange={() =>
                        setVisibleCols(prev => prev.includes(col.key) ? prev.filter(k => k !== col.key) : [...prev, col.key])
                      }
                      className="h-3.5 w-3.5"
                    />
                    {col.label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
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
      {/* Quick filters, as one row above the table. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project or merchant..."
            className="h-9 pl-8"
          />
        </div>
        <Select value={quickGroup} onValueChange={setQuickGroup}>
          <SelectTrigger className="h-9 w-[170px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {funnelOrder.map(s => <SelectItem key={s} value={s}>{funnelStageLabels[s] || s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={quickState} onValueChange={setQuickState}>
          <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {(Object.keys(projectStateLabels) as Array<keyof typeof projectStateLabels>).map(st => (
              <SelectItem key={st} value={st}>{projectStateLabels[st]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={quickOwner} onValueChange={setQuickOwner}>
          <SelectTrigger className="h-9 w-[170px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {ownerOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-9"
          onClick={clearQuickFilters}
          disabled={quickFilterCount === 0}
        >
          Clear
        </Button>
      </div>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" /> Loading report...</div>
        ) : filteredProjects.length === 0 ? (
          <FilteredEmptyState
            onClear={() => { resetFilters(); clearQuickFilters(); }}
            noun="projects"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2.5" aria-label="Select" />
                  <th scope="col" className="w-[24%] px-3 py-2.5 text-left font-medium">Project / Merchant</th>
                  {showCol("status") && <th scope="col" className="w-[11%] px-3 py-2.5 text-left font-medium">Status</th>}
                  {showCol("arr") && <th scope="col" className="w-[12%] px-3 py-2.5 text-left font-medium">ARR</th>}
                  {showCol("egl") && <th scope="col" className="w-[11%] px-3 py-2.5 text-left font-medium">EGL</th>}
                  {showCol("owner") && <th scope="col" className="w-[15%] px-3 py-2.5 text-left font-medium">Owner</th>}
                  {showCol("progress") && <th scope="col" className="w-[13%] px-3 py-2.5 text-left font-medium">Progress</th>}
                  {showCol("updated") && <th scope="col" className="w-[12%] px-3 py-2.5 text-left font-medium">Last Update</th>}
                  <th scope="col" className="w-12 px-3 py-2.5 text-left font-medium">Actions</th>
                </tr>
              </thead>
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
                    showCol={showCol}
                    colCount={3 + COLUMN_KEYS.filter(c => showCol(c.key)).length}
                  />
                );
              })}
            </table>
          </div>
        )}
      </CardContent>

      {selectedProject && (
        <ProjectDialog
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
    wins: { label: "Win", cls: "bg-success hover:bg-success text-success-foreground" },
    updates: { label: "Update", cls: "bg-info hover:bg-info text-info-foreground" },
    lowlights: { label: "Lowlight", cls: "bg-destructive hover:bg-destructive text-destructive-foreground" },
  };
  const m = map[b];
  return <Badge className={m.cls}>{m.label}</Badge>;
};

const FunnelSection = ({
  stage, projects, movementMap, aiMap, activeCount, onOpenProject, showCol, colCount,
}: {
  stage: FunnelStage;
  projects: Project[];
  movementMap: Record<string, MovementEntry[]>;
  aiMap: Record<string, AiSummary>;
  activeCount: number;
  onOpenProject: (p: Project) => void;
  showCol: (key: string) => boolean;
  colCount: number;
}) => {
  // Collapsed by default: the report is a scan of many stages, not a wall of rows.
  const [open, setOpen] = useState(false);
  return (
    <tbody className="border-b border-border last:border-b-0">
      <tr className="bg-muted/20">
        <td colSpan={colCount} className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2">
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open ? "" : "-rotate-90")} />
              <span className="text-sm font-semibold">{funnelStageLabels[stage]}</span>
              <span className="text-xs text-muted-foreground">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-success-strong">{activeCount} active</span>
              {` · ${projects.length - activeCount} inactive`}
            </span>
          </button>
        </td>
      </tr>

      {open && projects.map(p => {
        const entries = movementMap[p.id] || [];
        const isActive = entries.length > 0;
        const ai = aiMap[p.id];
        const fallback = isActive ? buildSummary(entries, 3) : "";
        const percent = Math.max(0, Math.min(100, p.goLivePercent ?? 0));
        const owner = p.assignedOwnerName || "Unassigned";
        return (
          <Fragment key={p.id}>
            <tr className="border-t border-border/40 align-middle transition-colors hover:bg-muted/30">
              <td className="px-3 py-2.5">
                <Checkbox aria-label={`Select ${p.merchantName}`} className="h-4 w-4" />
              </td>
              <td className="px-3 py-2.5">
                <button
                  onClick={() => onOpenProject(p)}
                  className="block max-w-full truncate text-left font-semibold text-foreground hover:underline"
                  title={p.merchantName}
                >
                  {p.merchantName}
                </button>
                <span className="block truncate text-xs text-muted-foreground">{funnelStageLabels[getProjectFunnelStage(p)]}</span>
              </td>
              {showCol("status") && (
                <td className="px-3 py-2.5">
                  {isActive && ai ? bucketBadge(ai.bucket) : (
                    <Badge variant="secondary" className="whitespace-nowrap text-2xs font-medium">
                      {projectStateLabels[p.projectState] || p.projectState}
                    </Badge>
                  )}
                </td>
              )}
              {showCol("arr") && <td className="truncate px-3 py-2.5 text-sm">{formatArr(p.arr)}</td>}
              {showCol("egl") && <td className="truncate px-3 py-2.5 text-sm">{formatEgl(p.dates?.expectedGoLiveDate)}</td>}
              {showCol("owner") && (
                <td className="px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                      {initials(owner)}
                    </span>
                    <span className="truncate text-sm">{owner}</span>
                  </span>
                </td>
              )}
              {showCol("progress") && (
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{percent}%</span>
                  </span>
                </td>
              )}
              {showCol("updated") && (
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {p.updatedAt ? (
                    <>
                      <span className="block">{format(new Date(p.updatedAt), "dd MMM yyyy")}</span>
                      <span className="block">{format(new Date(p.updatedAt), "HH:mm")}</span>
                    </>
                  ) : "—"}
                </td>
              )}
              <td className="px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => onOpenProject(p)}
                  aria-label={`Open ${p.merchantName}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
            {/* What actually moved, under the row it belongs to. */}
            {isActive && (ai || fallback) && (
              <tr className="bg-muted/10">
                <td />
                <td colSpan={colCount - 1} className="px-3 pb-2.5 text-xs leading-relaxed">
                  <span className="block text-foreground/90">{ai?.line1 || fallback}</span>
                  {ai?.line2 && <span className="block text-muted-foreground">{ai.line2}</span>}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </tbody>
  );
};

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
