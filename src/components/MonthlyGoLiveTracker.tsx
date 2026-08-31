import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Download, Plus, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EditProjectDialog } from "./EditProjectDialog";
import { useProjects } from "@/contexts/ProjectContext";

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

const PHASE_LABEL: Record<string, string> = {
  sales: "Sales",
  pre_integration: "Pre Integration",
  mint: "Under Integration",
  ms: "Live",
};

const FUNNEL_LABEL: Record<string, string> = {
  live: "Live",
  under_integration: "Under Integration",
  pre_integration: "Pre Integration",
  sales: "Sales",
  none: "—",
};

const FUNNEL_BADGE: Record<string, string> = {
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

const MINT_REQ = ["requirement gathering", "api walkthrough", "api build & sdk integration", "api validation"];
const FUNNEL_ANY_TITLES = [
  "feasibility analysis", "pg onboarding", "requirement gathering", "api walkthrough",
  "api build & sdk integration", "api validation", "under integration", "sandbox testing",
  "production testing", "dashboard walkthrough", "go-live",
];

function computeFunnelStage(projectState: string | null, items: { title: string; completed: boolean; is_task: boolean }[]): string {
  if (projectState === "live") return "live";
  const nonTasks = items.filter(i => !i.is_task);
  const titleCompleted = (needle: string) => {
    const it = nonTasks.find(i => i.title.toLowerCase().includes(needle));
    return !!it && it.completed;
  };
  if (MINT_REQ.every(t => titleCompleted(t))) return "under_integration";
  const feasibilityDone = titleCompleted("feasibility analysis");
  if (feasibilityDone && MINT_REQ.some(t => !titleCompleted(t))) return "pre_integration";
  const anyFunnelDone = FUNNEL_ANY_TITLES.some(t => titleCompleted(t));
  if (!anyFunnelDone) return "sales";
  return "none";
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ymToLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS[parseInt(m,10)-1]} ${y}`;
}
function dateToYm(d: string | null | undefined) {
  if (!d) return null;
  return d.slice(0, 7);
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

export const MonthlyGoLiveTracker = () => {
  const { currentUser } = useAuth();
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultYm);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insights, setInsights] = useState<Record<string, Insight>>({});
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [platformCsm, setPlatformCsm] = useState<Record<string, string>>({}); // merchant_name -> CSM name
  const [funnelStages, setFunnelStages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelected, setPickerSelected] = useState<Record<string, boolean>>({});
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const { projects: fullProjects, updateProject } = useProjects();
  const editingProject = editProjectId ? fullProjects.find(p => p.id === editProjectId) : null;

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
        const [{ data: iData }, { data: profData }, { data: pmData }, { data: ciData }] = await Promise.all([
          supabase.from("project_ai_insights").select("*").eq("month", month).in("project_id", ids),
          supabase.from("profiles").select("id, name").in("id", list.map(p => p.assigned_owner).filter(Boolean) as string[]),
          supabase.from("platform_merchants").select("merchant_name, csm_id"),
          supabase.from("checklist_items").select("project_id, title, completed, is_task").in("project_id", ids),
        ]);
        const iMap: Record<string, Insight> = {};
        (iData || []).forEach((r: any) => { iMap[r.project_id] = r; });
        setInsights(iMap);
        const oMap: Record<string, string> = {};
        (profData || []).forEach((p: any) => { oMap[p.id] = p.name; });
        setOwners(oMap);

        // Compute funnel stage per project from checklist items + project_state
        const itemsByProject: Record<string, { title: string; completed: boolean; is_task: boolean }[]> = {};
        (ciData || []).forEach((c: any) => {
          (itemsByProject[c.project_id] ||= []).push({ title: c.title, completed: !!c.completed, is_task: !!c.is_task });
        });
        const fMap: Record<string, string> = {};
        list.forEach(p => { fMap[p.id] = computeFunnelStage(p.project_state, itemsByProject[p.id] || []); });
        setFunnelStages(fMap);

        // Map merchant_name -> CSM name via profiles
        const csmIds = (pmData || []).map((p: any) => p.csm_id).filter(Boolean);
        let csmNames: Record<string, string> = {};
        if (csmIds.length) {
          const { data: csmProf } = await supabase.from("profiles").select("id, name").in("id", csmIds);
          (csmProf || []).forEach((p: any) => { csmNames[p.id] = p.name; });
        }
        const pmMap: Record<string, string> = {};
        (pmData || []).forEach((pm: any) => {
          if (pm.csm_id && csmNames[pm.csm_id]) pmMap[pm.merchant_name.toLowerCase()] = csmNames[pm.csm_id];
        });
        setPlatformCsm(pmMap);
      } else {
        setInsights({});
        setOwners({});
        setFunnelStages({});
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

  const exportCsv = () => {
    const rows = [["Opportunity Name","ARR Cr.","Pipe Stage","Blocker","Blocked On","Deadline","Confidence","Owner","Expected Go live","PG Creds","DB Walkthrough","CSM Alignment"]];
    sortedRows.forEach(p => {
      const i = insights[p.id];
      rows.push([
        p.merchant_name,
        String(p.arr ?? ""),
        FUNNEL_LABEL[funnelStages[p.id] || "none"] || "",
        i?.blocker || "",
        i?.blocked_on || "",
        i?.deadline || "",
        i?.confidence || "",
        owners[p.assigned_owner || ""] || "",
        p.expected_go_live_date ? `${p.expected_go_live_date} ${weekOfMonth(p.expected_go_live_date)}` : "",
        i?.pg_creds || "",
        i?.db_walkthrough || "",
        i?.csm_alignment || platformCsm[p.merchant_name.toLowerCase()] || "",
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `golive-tracker-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const sortedRows = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aBlocked = a.project_state === "blocked" ? 0 : 1;
      const bBlocked = b.project_state === "blocked" ? 0 : 1;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return (a.expected_go_live_date || "").localeCompare(b.expected_go_live_date || "");
    });
  }, [projects]);

  const openPicker = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, merchant_name, arr, current_phase, project_state, assigned_owner, expected_go_live_date, tracker_month, platform")
      .eq("archived", false)
      .order("merchant_name");
    setAllProjects((data || []) as Project[]);
    const sel: Record<string, boolean> = {};
    projects.forEach(p => { sel[p.id] = true; });
    setPickerSelected(sel);
    setPickerOpen(true);
  };

  const savePicker = async () => {
    // Tag any selected project not already in this month with tracker_month = month
    const ops: Promise<any>[] = [];
    for (const id of Object.keys(pickerSelected)) {
      if (!pickerSelected[id]) continue;
      const p = allProjects.find(x => x.id === id);
      if (!p) continue;
      const inMonth = dateToYm(p.expected_go_live_date) === month;
      if (!inMonth && p.tracker_month !== month) {
        ops.push(Promise.resolve(supabase.from("projects").update({ tracker_month: month } as any).eq("id", id)));
      }
    }
    // Untag any current rows that were deselected and only present via tracker_month
    for (const p of projects) {
      if (!pickerSelected[p.id] && p.tracker_month === month) {
        ops.push(Promise.resolve(supabase.from("projects").update({ tracker_month: null } as any).eq("id", p.id)));
      }
    }
    await Promise.all(ops);
    toast.success("Tracker updated");
    setPickerOpen(false);
    load();
  };

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">Go-Live Tracker</h2>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map(m => <SelectItem key={m} value={m}>{ymToLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openPicker}><Plus className="h-4 w-4 mr-1" />Manage projects</Button>
          <Button variant="outline" size="sm" onClick={runAiRefresh} disabled={aiLoading}>
            {aiLoading ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Refresh AI
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
        </div>
      </div>

      <Card className="w-full">
        <CardContent className="p-0 overflow-auto">
          <Table className="text-sm w-full [&_td]:py-2 [&_th]:py-2 [&_td]:align-middle">
            <TableHeader className="sticky top-0 bg-muted/50 z-10">
              <TableRow>
                <TableHead className="font-semibold whitespace-nowrap min-w-[180px]">Opportunity</TableHead>
                <TableHead className="font-semibold text-right whitespace-nowrap">ARR Cr.</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">Stage</TableHead>
                <TableHead className="font-semibold min-w-[200px]">Blocker</TableHead>
                <TableHead className="font-semibold min-w-[120px]">Blocked On</TableHead>
                <TableHead className="font-semibold min-w-[100px]">Deadline</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">Confidence</TableHead>
                <TableHead className="font-semibold whitespace-nowrap min-w-[140px]">Owner</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">Expected Go-live</TableHead>
                <TableHead className="font-semibold text-center whitespace-nowrap">PG Creds</TableHead>
                <TableHead className="font-semibold text-center whitespace-nowrap">DB Walk</TableHead>
                <TableHead className="font-semibold whitespace-nowrap min-w-[140px]">CSM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && sortedRows.length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No projects for {ymToLabel(month)}. Use "Manage projects" to tag projects.</TableCell></TableRow>}
              {sortedRows.map(p => {
                const i = insights[p.id];
                const isBlocked = p.project_state === "blocked" || (i?.confidence?.toLowerCase() === "low");
                const conf = i?.confidence || "";
                const blockerText = i?.blocker || "";
                const isUrl = /^https?:\/\//i.test(blockerText);
                const stage = funnelStages[p.id] || "none";
                return (
                  <TableRow key={p.id} className={cn("hover:bg-muted/40", isBlocked && "bg-red-50/40 dark:bg-red-500/5")}>
                    <TableCell className={cn("font-medium whitespace-nowrap", isBlocked && "text-red-600 dark:text-red-400")} title={p.merchant_name}>
                      <button
                        type="button"
                        onClick={() => setEditProjectId(p.id)}
                        className="max-w-[220px] truncate text-left hover:text-primary hover:underline cursor-pointer"
                      >
                        {p.merchant_name}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{p.arr != null ? Number(p.arr).toFixed(2) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", FUNNEL_BADGE[stage])}>{FUNNEL_LABEL[stage]}</span>
                    </TableCell>
                    <TableCell className="align-top">
                      {isUrl ? (
                        <a href={blockerText.split(" ")[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline break-all">
                          <span>{blockerText.split(" — ")[0].replace(/^https?:\/\/[^/]+\/browse\//, "")}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <textarea
                          value={blockerText}
                          onChange={e => {
                            setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), blocker: e.target.value } }));
                            e.currentTarget.style.height = "auto";
                            e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                          }}
                          onBlur={e => updateInsight(p.id, "blocker", e.target.value)}
                          className="w-full min-h-[28px] resize-none border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                          placeholder="—"
                          rows={1}
                        />
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <textarea
                        value={i?.blocked_on || ""}
                        onChange={e => {
                          setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), blocked_on: e.target.value } }));
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                        }}
                        onBlur={e => updateInsight(p.id, "blocked_on", e.target.value)}
                        className="w-full min-h-[28px] resize-none border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                        placeholder="—"
                        rows={1}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <textarea
                        value={i?.deadline || ""}
                        onChange={e => {
                          setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), deadline: e.target.value } }));
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                        }}
                        onBlur={e => updateInsight(p.id, "deadline", e.target.value)}
                        className="w-full min-h-[28px] resize-none border-0 bg-transparent focus-visible:ring-1 px-2 py-1 text-sm leading-5 rounded-sm overflow-hidden"
                        placeholder="—"
                        rows={1}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Select value={conf} onValueChange={v => updateInsight(p.id, "confidence", v)}>
                        <SelectTrigger className={cn("h-7 border-0 bg-transparent w-[100px] px-2", conf && CONF_BADGE[conf], conf && "rounded-md font-medium")}><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="High">High</SelectItem>
                          <SelectItem value="Medium">Medium</SelectItem>
                          <SelectItem value="Low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="whitespace-nowrap" title={owners[p.assigned_owner || ""] || ""}>
                      <div className="max-w-[160px] truncate">{owners[p.assigned_owner || ""] || "—"}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{dateLabel(p.expected_go_live_date)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Select value={i?.pg_creds || ""} onValueChange={v => updateInsight(p.id, "pg_creds", v)}>
                        <SelectTrigger className="h-7 border-0 bg-transparent w-[70px] px-2"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Select value={i?.db_walkthrough || ""} onValueChange={v => updateInsight(p.id, "db_walkthrough", v)}>
                        <SelectTrigger className="h-7 border-0 bg-transparent w-[70px] px-2"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={i?.csm_alignment ?? platformCsm[p.merchant_name.toLowerCase()] ?? ""}
                        onChange={e => setInsights(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {} as any), csm_alignment: e.target.value } }))}
                        onBlur={e => updateInsight(p.id, "csm_alignment", e.target.value)}
                        className="h-8 border-0 bg-transparent focus-visible:ring-1 px-2" placeholder="—"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Projects in {ymToLabel(month)} tracker</DialogTitle></DialogHeader>
          <Input placeholder="Search…" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
          <div className="max-h-[50vh] overflow-auto border rounded">
            <Table>
              <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Merchant</TableHead><TableHead>Phase</TableHead><TableHead>Expected</TableHead></TableRow></TableHeader>
              <TableBody>
                {allProjects.filter(p => p.merchant_name.toLowerCase().includes(pickerSearch.toLowerCase())).map(p => (
                  <TableRow key={p.id}>
                    <TableCell><Checkbox checked={!!pickerSelected[p.id]} onCheckedChange={v => setPickerSelected(s => ({ ...s, [p.id]: !!v }))} /></TableCell>
                    <TableCell>{p.merchant_name}</TableCell>
                    <TableCell>{FUNNEL_LABEL[funnelStages[p.id] || "none"]}</TableCell>
                    <TableCell>{p.expected_go_live_date || (p.tracker_month ? `tag: ${p.tracker_month}` : "—")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button onClick={savePicker}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
