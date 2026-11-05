import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Project } from "@/data/projectsData";
import { useAuth } from "@/contexts/AuthContext";
import { ChecklistDialog } from "@/components/ChecklistDialog";
import { ChecklistKanbanView } from "./ChecklistKanbanView";
import { ChecklistGanttView } from "./ChecklistGanttView";
import { ChecklistCsvImportDialog } from "./ChecklistCsvImportDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
} from "lucide-react";
import { format } from "date-fns";

type ViewMode = "list" | "kanban" | "gantt";

interface Props {
  project: Project;
  onEditProject?: () => void;
  onAssignOwner?: () => void;
}

function kpiStats(project: Project) {
  const all = project.checklist.filter((i) => !i.isTask);
  const done = all.filter((i) => i.completed).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const blocked = all.filter((i) => i.status === "blocked").length;
  const inProgress = all.filter((i) => i.status === "in_progress").length;
  return { total: all.length, done, pct, blocked, inProgress };
}

function exportCsv(project: Project) {
  const headers = ["Title", "Stage", "Team", "Responsibility", "Status", "Start Date", "Due Date", "Completed", "Completed By", "Completed At", "Comment"];
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
  const itemRows = items.map((i) => ({
    Title: i.title,
    Stage: i.stage,
    Team: i.ownerTeam,
    Responsibility: i.currentResponsibility,
    Status: i.status ?? "todo",
    "Start Date": i.startDate ?? "",
    "Due Date": i.dueDate ?? "",
    Completed: i.completed ? "Yes" : "No",
    "Completed By": i.completedBy ?? "",
    "Completed At": i.completedAt ? format(new Date(i.completedAt), "yyyy-MM-dd HH:mm") : "",
    Comment: i.comment ?? "",
  }));
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
    { Metric: "Total Items", Value: stats.total },
    { Metric: "Completed", Value: stats.done },
    { Metric: "Completion %", Value: `${stats.pct}%` },
    { Metric: "In Progress", Value: stats.inProgress },
    { Metric: "Blocked", Value: stats.blocked },
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

export function WorkspaceChecklistTab({ project, onEditProject, onAssignOwner }: Props) {
  const { currentUser } = useAuth();
  const storageKey = `checklist_view_${project.id}`;
  const [view, setView] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(storageKey) as ViewMode) || "list"; } catch { return "list"; }
  });
  const [csvOpen, setCsvOpen] = useState(false);

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
    </div>
  );
}
