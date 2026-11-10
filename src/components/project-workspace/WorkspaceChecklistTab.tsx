import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Project } from "@/data/projectsData";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectDeepLink } from "@/hooks/useProjectDeepLink";
import { supabase } from "@/integrations/supabase/client";
import { ChecklistDialog } from "@/components/ChecklistDialog";
import { ChecklistKanbanView } from "./ChecklistKanbanView";
import { ChecklistGanttView } from "./ChecklistGanttView";
import { ChecklistCsvImportDialog } from "./ChecklistCsvImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  List,
  LayoutGrid,
  GanttChartSquare,
  Upload,
  Download,
  ChevronDown,
  BookTemplate,
  FileBarChart2,
} from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";

type ViewMode = "list" | "kanban" | "gantt";

interface Props {
  project: Project;
  onEditProject?: () => void;
  onAssignOwner?: () => void;
  onTransferProject?: () => void;
}

function kpiStats(project: Project) {
  const all = project.checklist.filter((i) => !i.isTask);
  const done = all.filter((i) => i.completed).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const blocked = all.filter((i) => i.status === "blocked").length;
  const inProgress = all.filter((i) => i.status === "in_progress").length;
  const now = new Date();
  const overdue = all.filter((i) => !i.completed && i.dueDate && new Date(i.dueDate) < now).length;
  return { total: all.length, done, pct, blocked, inProgress, overdue };
}

function exportCsv(project: Project) {
  const headers = ["Title", "Stage", "Team", "Responsibility", "Status", "Start Date", "Due Date", "SLA Days", "Completed", "Completed By", "Completed At", "Comment"];
  const rows = project.checklist
    .filter((i) => !i.isTask)
    .map((i) => [
      i.title,
      i.stage,
      i.ownerTeam,
      i.currentResponsibility,
      i.status ?? "todo",
      i.startDate ?? "",
      i.dueDate ?? "",
      i.slaDays ?? "",
      i.completed ? "Yes" : "No",
      i.completedBy ?? "",
      i.completedAt ? format(new Date(i.completedAt), "yyyy-MM-dd HH:mm") : "",
      i.comment ?? "",
    ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.merchantName}-checklist-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(project: Project) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Checklist items
  const items = project.checklist.filter((i) => !i.isTask);
  const now = new Date();
  const itemRows = items.map((i) => {
    const actualDays =
      i.completed && i.startDate && i.completedAt
        ? differenceInCalendarDays(new Date(i.completedAt), new Date(i.startDate))
        : null;
    const slaVariance = i.slaDays != null && actualDays != null ? actualDays - i.slaDays : null;
    return {
      Title: i.title,
      Stage: i.stage,
      Team: i.ownerTeam,
      Responsibility: i.currentResponsibility,
      Status: i.status ?? "todo",
      "Start Date": i.startDate ?? "",
      "Due Date": i.dueDate ?? "",
      "SLA Days": i.slaDays ?? "",
      "Actual Days": actualDays ?? "",
      "SLA Performance": slaVariance != null
        ? slaVariance <= 0
          ? `${Math.abs(slaVariance)}d early`
          : `${slaVariance}d late`
        : "",
      Overdue: !i.completed && i.dueDate && new Date(i.dueDate) < now ? "Yes" : "No",
      Completed: i.completed ? "Yes" : "No",
      "Completed By": i.completedBy ?? "",
      "Completed At": i.completedAt ? format(new Date(i.completedAt), "yyyy-MM-dd HH:mm") : "",
      Comment: i.comment ?? "",
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "Checklist Items");

  // Sheet 2: Tasks
  const tasks = project.checklist.filter((i) => i.isTask);
  const taskRows = tasks.map((t) => ({
    Title: t.title,
    "Parent Stage": t.stage,
    Status: t.status ?? "todo",
    Completed: t.completed ? "Yes" : "No",
    "Completed By": t.completedBy ?? "",
    "Completed At": t.completedAt ? format(new Date(t.completedAt), "yyyy-MM-dd HH:mm") : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskRows.length ? taskRows : [{ Note: "No tasks" }]), "Tasks");

  // Sheet 3: Summary
  const stats = kpiStats(project);
  const summaryRows = [
    { Metric: "Project", Value: project.merchantName },
    { Metric: "Total Items", Value: stats.total },
    { Metric: "Completed", Value: stats.done },
    { Metric: "Completion %", Value: `${stats.pct}%` },
    { Metric: "In Progress", Value: stats.inProgress },
    { Metric: "Blocked", Value: stats.blocked },
    { Metric: "Overdue", Value: stats.overdue },
    { Metric: "Exported At", Value: format(new Date(), "yyyy-MM-dd HH:mm") },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

  XLSX.writeFile(wb, `${project.merchantName}-checklist-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}

function printChecklist(project: Project) {
  const items = project.checklist.filter((i) => !i.isTask);
  const html = `<!DOCTYPE html><html><head><title>${project.merchantName} Checklist</title>
<style>body{font-family:sans-serif;font-size:12px;padding:20px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#f4f4f4}h1{font-size:18px;margin-bottom:16px}
</style></head><body>
<h1>${project.merchantName} — Checklist</h1>
<table><thead><tr><th>#</th><th>Title</th><th>Stage</th><th>Status</th><th>Start</th><th>Due</th><th>Done</th></tr></thead>
<tbody>${items.map((i, n) => `<tr>
<td>${n + 1}</td><td>${i.title}</td><td>${i.stage}</td><td>${i.status ?? "todo"}</td>
<td>${i.startDate ?? ""}</td><td>${i.dueDate ?? ""}</td><td>${i.completed ? "✓" : ""}</td>
</tr>`).join("")}</tbody></table></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

/** §5.4 Go-Live Completion Report */
function generateGoLiveReport(project: Project) {
  const items = project.checklist.filter((i) => !i.isTask);
  const stats = kpiStats(project);
  const now = new Date();
  const goLiveDate = project.dates.goLiveDate || project.dates.expectedGoLiveDate || "";

  const overdueItems = items.filter(
    (i) => !i.completed && i.dueDate && new Date(i.dueDate) < now,
  );
  const completedItems = items.filter((i) => i.completed).sort((a, b) =>
    (a.completedAt || "").localeCompare(b.completedAt || ""),
  );

  const slaRows = completedItems
    .filter((i) => i.slaDays != null && i.startDate && i.completedAt)
    .map((i) => {
      const actual = differenceInCalendarDays(new Date(i.completedAt!), new Date(i.startDate!));
      const variance = actual - i.slaDays!;
      return { title: i.title, stage: i.stage, sla: i.slaDays!, actual, variance };
    });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${project.merchantName} — Go-Live Report</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;padding:32px;color:#181818;background:#fff}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:#666;font-size:13px;margin-bottom:28px}
  .kpi-row{display:flex;gap:20px;margin-bottom:28px;flex-wrap:wrap}
  .kpi{background:#f8f8f6;border-radius:8px;padding:14px 20px;min-width:110px;text-align:center}
  .kpi-num{font-size:28px;font-weight:700;line-height:1}
  .kpi-label{font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
  .kpi-num.green{color:#15803d}.kpi-num.red{color:#b91c1c}.kpi-num.blue{color:#1d4ed8}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:28px}
  th{background:#f0f0ec;padding:7px 10px;border:1px solid #e2e2da;font-weight:600;text-align:left}
  td{padding:6px 10px;border:1px solid #e2e2da}
  .early{color:#15803d;font-weight:600}.late{color:#b91c1c;font-weight:600}
  h2{font-size:15px;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e2da}
  .bar-wrap{background:#e5e7eb;border-radius:999px;height:12px;margin-bottom:4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:999px;background:#15803d}
  @media print{body{padding:16px}}
</style>
</head><body>
<h1>${project.merchantName} — Go-Live Completion Report</h1>
<p class="sub">Generated ${format(now, "d MMMM yyyy, HH:mm")}${goLiveDate ? ` · Go-Live: ${format(new Date(goLiveDate), "d MMMM yyyy")}` : ""}</p>

<div class="kpi-row">
  <div class="kpi"><div class="kpi-num">${stats.total}</div><div class="kpi-label">Total items</div></div>
  <div class="kpi"><div class="kpi-num green">${stats.done}</div><div class="kpi-label">Completed</div></div>
  <div class="kpi"><div class="kpi-num blue">${stats.pct}%</div><div class="kpi-label">Completion</div></div>
  <div class="kpi"><div class="kpi-num ${stats.overdue > 0 ? "red" : ""}">${stats.overdue}</div><div class="kpi-label">Overdue</div></div>
  <div class="kpi"><div class="kpi-num ${stats.blocked > 0 ? "red" : ""}">${stats.blocked}</div><div class="kpi-label">Blocked</div></div>
</div>

<div class="bar-wrap"><div class="bar-fill" style="width:${stats.pct}%"></div></div>
<p style="font-size:11px;color:#888;margin-bottom:28px">${stats.done} of ${stats.total} items completed</p>

${completedItems.length > 0 ? `
<h2>Completion Timeline</h2>
<table>
  <thead><tr><th>Item</th><th>Stage</th><th>Completed By</th><th>Completed At</th></tr></thead>
  <tbody>${completedItems.map(i => `<tr>
    <td>${i.title}</td><td>${i.stage}</td><td>${i.completedBy || "—"}</td>
    <td>${i.completedAt ? format(new Date(i.completedAt), "d MMM yyyy") : "—"}</td>
  </tr>`).join("")}</tbody>
</table>` : ""}

${overdueItems.length > 0 ? `
<h2 style="color:#b91c1c">⚠ Overdue Items (${overdueItems.length})</h2>
<table>
  <thead><tr><th>Item</th><th>Stage</th><th>Due Date</th><th>Days Overdue</th></tr></thead>
  <tbody>${overdueItems.map(i => {
    const days = i.dueDate ? differenceInCalendarDays(now, new Date(i.dueDate)) : 0;
    return `<tr>
    <td>${i.title}</td><td>${i.stage}</td>
    <td>${i.dueDate ? format(new Date(i.dueDate), "d MMM yyyy") : "—"}</td>
    <td class="late">+${days}d</td>
  </tr>`;
  }).join("")}</tbody>
</table>` : ""}

${slaRows.length > 0 ? `
<h2>SLA Performance</h2>
<table>
  <thead><tr><th>Item</th><th>Stage</th><th>SLA (days)</th><th>Actual (days)</th><th>Variance</th></tr></thead>
  <tbody>${slaRows.map(r => `<tr>
    <td>${r.title}</td><td>${r.stage}</td><td>${r.sla}</td><td>${r.actual}</td>
    <td class="${r.variance <= 0 ? "early" : "late"}">${r.variance <= 0 ? `${Math.abs(r.variance)}d early` : `${r.variance}d late`}</td>
  </tr>`).join("")}</tbody>
</table>` : ""}

</body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

/** §8.2 Save as Template dialog */
function SaveAsTemplateDialog({
  open,
  onOpenChange,
  project,
  tenantId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: Project;
  tenantId: string | null;
}) {
  const [name, setName] = useState(`${project.merchantName} Checklist`);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // 1. Create a new checklist_set
      const { data: setData, error: setError } = await supabase
        .from("checklist_sets")
        .insert({ name: name.trim(), tenant_id: tenantId, is_default: false, sort_order: 0 })
        .select("id")
        .single();
      if (setError) throw setError;

      const setId = setData.id;

      // 2. Copy checklist items as templates
      const items = project.checklist.filter((i) => !i.isTask);
      const templates = items.map((item, idx) => {
        const slaDays =
          item.slaDays ??
          (item.startDate && item.dueDate
            ? differenceInCalendarDays(new Date(item.dueDate), new Date(item.startDate))
            : null);
        return {
          checklist_set_id: setId,
          tenant_id: tenantId,
          title: item.title,
          stage: item.stage as string,
          owner_team: item.ownerTeam as string,
          sort_order: idx,
          standard_duration: slaDays,
        };
      });

      const { error: tmplError } = await supabase.from("checklist_templates").insert(templates);
      if (tmplError) throw tmplError;

      toast.success(`Template "${name.trim()}" saved with ${items.length} items.`);
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BookTemplate className="h-4 w-4 text-muted-foreground" />
            Save as Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Creates a new reusable checklist set from {project.checklist.filter(i => !i.isTask).length} items in this project.
          </p>
          <Input
            autoFocus
            placeholder="Template name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            className="h-8 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Saving…" : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceChecklistTab({ project, onEditProject, onAssignOwner, onTransferProject }: Props) {
  const { currentUser } = useAuth();
  const deepLink = useProjectDeepLink();
  const storageKey = `checklist_view_${project.id}`;
  const [view, setView] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(storageKey) as ViewMode) || "list"; } catch { return "list"; }
  });
  const [csvOpen, setCsvOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  function changeView(v: ViewMode) {
    setView(v);
    try { localStorage.setItem(storageKey, v); } catch { /* ignore */ }
  }

  const stats = useMemo(() => kpiStats(project), [project]);

  return (
    <div className="flex flex-col h-full">
      {/* KPI bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-background/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Progress value={stats.pct} className="h-2 w-32" />
          <span className="text-xs font-semibold text-foreground">{stats.pct}%</span>
          <span className="text-xs text-muted-foreground">
            {stats.done}/{stats.total} done
          </span>
        </div>
        {stats.inProgress > 0 && (
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium hidden sm:block">
            {stats.inProgress} in&nbsp;progress
          </span>
        )}
        {stats.blocked > 0 && (
          <span className="text-xs text-red-600 dark:text-red-400 font-medium hidden sm:block">
            {stats.blocked} blocked
          </span>
        )}
        {stats.overdue > 0 && (
          <span className="text-xs text-orange-600 dark:text-orange-400 font-medium hidden sm:block">
            {stats.overdue} overdue
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Toolbar */}
        <div className="flex items-center gap-1.5">
          {/* View toggle */}
          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={view === "list" ? "default" : "ghost"}
              size="sm"
              className="h-7 rounded-none px-2 text-xs border-0"
              onClick={() => changeView("list")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "kanban" ? "default" : "ghost"}
              size="sm"
              className="h-7 rounded-none px-2 text-xs border-0 border-l"
              onClick={() => changeView("kanban")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "gantt" ? "default" : "ghost"}
              size="sm"
              className="h-7 rounded-none px-2 text-xs border-0 border-l"
              onClick={() => changeView("gantt")}
            >
              <GanttChartSquare className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Import */}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setCsvOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportCsv(project)}>
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportExcel(project)}>
                Download Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => printChecklist(project)}>
                Print / PDF
              </DropdownMenuItem>
              {/* §5.4 Go-Live Report */}
              <DropdownMenuItem onClick={() => generateGoLiveReport(project)}>
                <FileBarChart2 className="mr-2 h-3.5 w-3.5" />
                Go-Live Report
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* §8.2 Save as Template */}
              <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
                <BookTemplate className="mr-2 h-3.5 w-3.5" />
                Save as Template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "list" && (
          <ChecklistDialog
            project={project}
            open={true}
            onOpenChange={() => undefined}
            variant="inline"
            onEditProject={onEditProject}
            onAssignOwner={onAssignOwner}
            onTransferProject={onTransferProject}
            initialExpandedItemId={deepLink.item ?? undefined}
          />
        )}
        {view === "kanban" && <ChecklistKanbanView project={project} />}
        {view === "gantt" && <ChecklistGanttView project={project} />}
      </div>

      {/* CSV Import dialog */}
      <ChecklistCsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        projectId={project.id}
        tenantId={currentUser?.tenantId ?? null}
      />

      {/* §8.2 Save as Template dialog */}
      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        project={project}
        tenantId={currentUser?.tenantId ?? null}
      />
    </div>
  );
}
