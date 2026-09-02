import { useState, useMemo, useEffect } from "react";
import { Project, projectStateLabels, formatDuration, calculateTimeFromChecklist } from "@/data/projectsData";
import { CustomField } from "@/hooks/useCustomFields";
import { useLabels } from "@/contexts/LabelsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Sigma, Save, Trash2, FileText, Plus, X } from "lucide-react";
import { useReportFilters } from "@/hooks/useReportFilters";
import { ReportFilterBar } from "@/components/reports/ReportFilterBar";
import { arrCroreValue } from "@/lib/arr";

const AVAILABLE_COLUMNS: { key: string; label: string; group: string }[] = [
  { key: "merchantName", label: "Merchant Name", group: "Basic" },
  { key: "mid", label: "MID", group: "Basic" },
  { key: "platform", label: "Platform", group: "Basic" },
  { key: "category", label: "Category", group: "Basic" },
  { key: "arr", label: "ARR", group: "Financial" },
  { key: "txnsPerDay", label: "Txns/Day", group: "Financial" },
  { key: "aov", label: "AOV", group: "Financial" },
  { key: "projectState", label: "Project State", group: "Status" },
  { key: "currentPhase", label: "Current Phase", group: "Status" },
  { key: "currentOwnerTeam", label: "Current Team", group: "Status" },
  { key: "assignedOwnerName", label: "Assigned Owner", group: "Status" },
  { key: "currentResponsibility", label: "Responsibility", group: "Status" },
  { key: "goLivePercent", label: "Go Live %", group: "Status" },
];

const BASE_GROUPABLE_COLUMNS = ["projectState", "currentPhase", "currentOwnerTeam", "platform", "category", "assignedOwnerName", "currentResponsibility", "integrationType", "pgOnboarding", "salesSpoc"];
const NUMERIC_COLUMNS = ["arr", "txnsPerDay", "aov", "goLivePercent", "transferCount"];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Marker stored as first element in `columns` to identify pivot reports
const PIVOT_MARKER = "__PIVOT_REPORT__";

type AggType = "sum" | "avg" | "count" | "min" | "max";

interface SavedPivotReport {
  id: string;
  name: string;
  pivotRowField: string;
  pivotColField: string;
  pivotValueField: string;
  pivotAggType: AggType;
  schedule: string;
  recipients: string[];
}

function getCellValue(project: Project, key: string, labels: any): string {
  switch (key) {
    case "merchantName": return project.merchantName;
    case "mid": return project.mid;
    case "platform": return project.platform;
    case "category": return project.category;
    case "arr": return arrCroreValue(project.arr);
    case "txnsPerDay": return String(project.txnsPerDay);
    case "aov": return String(project.aov);
    case "projectState": return labels.stateLabels?.[project.projectState] || projectStateLabels[project.projectState];
    case "currentPhase": return labels.phaseLabels?.[project.currentPhase] || project.currentPhase;
    case "currentOwnerTeam": return labels.teamLabels?.[project.currentOwnerTeam] || project.currentOwnerTeam;
    case "assignedOwnerName": return project.assignedOwnerName || "Unassigned";
    case "currentResponsibility": return labels.responsibilityLabels?.[project.currentResponsibility] || project.currentResponsibility;
    case "goLivePercent": return `${project.goLivePercent || 0}%`;
    default: {
      if (key.startsWith("custom_field_")) {
        const fieldId = key.replace("custom_field_", "");
        return labels.customValuesMap?.[project.id]?.[fieldId] || "—";
      }
      return "—";
    }
  }
}

function getNumericValue(project: Project, key: string): number {
  switch (key) {
    case "arr": return project.arr;
    case "txnsPerDay": return project.txnsPerDay;
    case "aov": return project.aov;
    case "goLivePercent": return project.goLivePercent;
    case "transferCount": return project.transferHistory.length;
    default: return 0;
  }
}

function computeAgg(values: number[], type: AggType): number {
  if (values.length === 0) return 0;
  switch (type) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "count": return values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
  }
}

function formatAggVal(key: string, val: number, aggType: AggType): string {
  if (aggType === "count") return String(Math.round(val));
  if (key === "arr") return val.toFixed(2);
  if (key === "goLivePercent") return `${val.toFixed(0)}%`;
  return val.toFixed(1);
}

export const PivotTableSettings = ({ projects, customFields = [], customValuesMap = {} }: { projects: Project[]; customFields?: CustomField[]; customValuesMap?: Record<string, Record<string, string>> }) => {
  const { teamLabels, responsibilityLabels, phaseLabels, stateLabels } = useLabels();
  const { currentUser } = useAuth();
  const labels = { teamLabels, responsibilityLabels, phaseLabels, stateLabels, customValuesMap };

  const [pivotRowField, setPivotRowField] = useState<string>("none");
  const [pivotColField, setPivotColField] = useState<string>("none");
  const [pivotValueField, setPivotValueField] = useState<string>("arr");
  const [pivotAggType, setPivotAggType] = useState<AggType>("sum");

  const filterState = useReportFilters(projects);
  const { filteredProjects } = filterState;

  // Save & schedule state
  const [savedReports, setSavedReports] = useState<SavedPivotReport[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [reportName, setReportName] = useState("");
  const [scheduleDays, setScheduleDays] = useState<Set<string>>(new Set());
  const [scheduleHour, setScheduleHour] = useState<number>(9);
  const [scheduleMinute, setScheduleMinute] = useState<number>(0);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchReports = async () => {
      const { data } = await supabase
        .from("saved_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) {
        const pivotReports = data
          .filter((r: any) => Array.isArray(r.columns) && r.columns[0] === PIVOT_MARKER)
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            pivotRowField: r.columns[1] || "none",
            pivotColField: r.columns[2] || "none",
            pivotValueField: r.columns[3] || "arr",
            pivotAggType: (r.columns[4] || "sum") as AggType,
            schedule: r.schedule || "none",
            recipients: r.recipients || [],
          }));
        setSavedReports(pivotReports);
      }
    };
    fetchReports();
  }, []);

  const toggleScheduleDay = (day: string) => {
    setScheduleDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const addRecipient = () => {
    const email = recipientInput.trim();
    if (email && email.includes("@") && !recipients.includes(email)) {
      setRecipients(prev => [...prev, email]);
      setRecipientInput("");
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients(prev => prev.filter(e => e !== email));
  };

  const handleSaveReport = async () => {
    if (!reportName.trim()) { toast.error("Please enter a report name"); return; }
    setLoading(true);
    try {
      const scheduleValue = scheduleDays.size > 0
        ? `${Array.from(scheduleDays).join(",")}@${String(scheduleHour).padStart(2, "0")}:${String(scheduleMinute).padStart(2, "0")}`
        : "none";

      // Encode pivot config into the columns array with a marker so we can identify these rows
      const encodedColumns = [PIVOT_MARKER, pivotRowField, pivotColField, pivotValueField, pivotAggType];

      const { data, error } = await supabase.from("saved_reports").insert({
        name: reportName.trim(),
        columns: encodedColumns,
        schedule: scheduleValue,
        recipients,
        tenant_id: currentUser?.tenantId,
        created_by: currentUser?.id,
      }).select().single();
      if (error) throw error;

      setSavedReports(prev => [{
        id: data.id,
        name: data.name,
        pivotRowField,
        pivotColField,
        pivotValueField,
        pivotAggType,
        schedule: data.schedule || "none",
        recipients: data.recipients || [],
      }, ...prev]);
      toast.success(`Pivot report "${reportName}" saved`);
      setSaveDialogOpen(false);
      setReportName("");
      setScheduleDays(new Set());
      setRecipients([]);
    } catch (err: any) {
      toast.error(err.message || "Failed to save report");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteReport = async (id: string) => {
    const { error } = await supabase.from("saved_reports").delete().eq("id", id);
    if (!error) { setSavedReports(prev => prev.filter(r => r.id !== id)); toast.success("Report deleted"); }
  };

  const loadReport = (report: SavedPivotReport) => {
    setPivotRowField(report.pivotRowField);
    setPivotColField(report.pivotColField);
    setPivotValueField(report.pivotValueField);
    setPivotAggType(report.pivotAggType);
    toast.info(`Loaded "${report.name}"`);
  };

  const allColumns = useMemo(() => {
    const customCols = customFields.map(f => ({
      key: `custom_field_${f.id}`,
      label: f.field_label,
      group: "Custom Fields",
    }));
    return [...AVAILABLE_COLUMNS, ...customCols];
  }, [customFields]);

  const groupableColumns = useMemo(() => {
    const customGroupableColumns = customFields.map(f => `custom_field_${f.id}`);
    return [...BASE_GROUPABLE_COLUMNS, ...customGroupableColumns];
  }, [customFields]);

  const excelPivot = useMemo(() => {
    if (pivotRowField === "none") return null;
    const rowValues = new Set<string>();
    const colValues = new Set<string>();
    filteredProjects.forEach(p => {
      rowValues.add(getCellValue(p, pivotRowField, labels));
      if (pivotColField !== "none") colValues.add(getCellValue(p, pivotColField, labels));
    });
    const sortedRows = Array.from(rowValues).sort();
    const sortedCols = pivotColField !== "none" ? Array.from(colValues).sort() : ["Total"];
    const grid: Record<string, Record<string, number[]>> = {};
    sortedRows.forEach(r => { grid[r] = {}; sortedCols.forEach(c => { grid[r][c] = []; }); });
    filteredProjects.forEach(p => {
      const rowVal = getCellValue(p, pivotRowField, labels);
      const colVal = pivotColField !== "none" ? getCellValue(p, pivotColField, labels) : "Total";
      const numVal = getNumericValue(p, pivotValueField);
      if (grid[rowVal]?.[colVal]) grid[rowVal][colVal].push(numVal);
    });
    const result: Record<string, Record<string, number>> = {};
    const colTotals: Record<string, number[]> = {};
    sortedCols.forEach(c => { colTotals[c] = []; });
    sortedRows.forEach(r => {
      result[r] = {};
      sortedCols.forEach(c => {
        result[r][c] = computeAgg(grid[r][c], pivotAggType);
        colTotals[c].push(...grid[r][c]);
      });
    });
    const grandTotals: Record<string, number> = {};
    sortedCols.forEach(c => { grandTotals[c] = computeAgg(colTotals[c], pivotAggType); });
    return { rows: sortedRows, cols: sortedCols, data: result, grandTotals };
  }, [pivotRowField, pivotColField, pivotValueField, pivotAggType, filteredProjects, labels]);

  const formatPivotVal = (val: number) => formatAggVal(pivotValueField, val, pivotAggType);
  const rowLabel = allColumns.find(c => c.key === pivotRowField)?.label || pivotRowField;

  return (
    <div className="space-y-4">
      {/* Saved Pivot Reports */}
      {savedReports.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Saved Pivot Reports</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {savedReports.map(report => (
                <div key={report.id} className="flex items-center gap-1 border rounded-lg px-3 py-1.5 bg-muted/30">
                  <button onClick={() => loadReport(report)} className="text-sm font-medium hover:text-primary transition-colors">{report.name}</button>
                  {report.schedule !== "none" && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">{report.schedule}</Badge>
                  )}
                  <button onClick={() => handleDeleteReport(report.id)} className="ml-1 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sigma className="h-4 w-4" />
              Pivot Table
            </CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows:</Label>
                <Select value={pivotRowField} onValueChange={setPivotRowField}>
                  <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select…</SelectItem>
                    {groupableColumns.map(k => {
                      const col = allColumns.find(c => c.key === k);
                      return <SelectItem key={k} value={k}>{col?.label || k}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Columns:</Label>
                <Select value={pivotColField} onValueChange={setPivotColField}>
                  <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {groupableColumns.filter(k => k !== pivotRowField).map(k => {
                      const col = allColumns.find(c => c.key === k);
                      return <SelectItem key={k} value={k}>{col?.label || k}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Values:</Label>
                <Select value={pivotValueField} onValueChange={setPivotValueField}>
                  <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NUMERIC_COLUMNS.map(k => {
                      const col = allColumns.find(c => c.key === k);
                      return <SelectItem key={k} value={k}>{col?.label || k}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Agg:</Label>
                <Select value={pivotAggType} onValueChange={(v) => setPivotAggType(v as AggType)}>
                  <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Sum</SelectItem>
                    <SelectItem value="avg">Average</SelectItem>
                    <SelectItem value="count">Count</SelectItem>
                    <SelectItem value="min">Min</SelectItem>
                    <SelectItem value="max">Max</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setSaveDialogOpen(true)}>
                <Save className="h-3 w-3" />Save & Schedule
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2 border-t mt-2">
            <ReportFilterBar {...filterState} projectCount={filteredProjects.length} />
            {filteredProjects.length !== projects.length && (
              <span className="text-xs text-muted-foreground">({filteredProjects.length} of {projects.length} projects)</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[60vh]">
            {excelPivot ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold whitespace-nowrap sticky left-0 bg-muted/50 z-10">{rowLabel}</TableHead>
                    {excelPivot.cols.map(col => (
                      <TableHead key={col} className="text-xs font-semibold whitespace-nowrap text-center">{col}</TableHead>
                    ))}
                    {excelPivot.cols.length > 1 && <TableHead className="text-xs font-semibold whitespace-nowrap text-center bg-muted/80">Grand Total</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {excelPivot.rows.map(row => {
                    const rowTotal = excelPivot.cols.reduce((s, c) => s + (excelPivot.data[row]?.[c] || 0), 0);
                    return (
                      <TableRow key={row} className="hover:bg-muted/20">
                        <TableCell className="text-xs font-medium whitespace-nowrap sticky left-0 bg-background z-10">{row}</TableCell>
                        {excelPivot.cols.map(col => (
                          <TableCell key={col} className="text-xs text-center font-mono">
                            {formatPivotVal(excelPivot.data[row]?.[col] || 0)}
                          </TableCell>
                        ))}
                        {excelPivot.cols.length > 1 && (
                          <TableCell className="text-xs text-center font-mono font-semibold bg-muted/30">
                            {formatPivotVal(rowTotal)}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/60 font-semibold">
                    <TableCell className="text-xs font-semibold sticky left-0 bg-muted/60 z-10">Grand Total</TableCell>
                    {excelPivot.cols.map(col => (
                      <TableCell key={col} className="text-xs text-center font-mono font-semibold">
                        {formatPivotVal(excelPivot.grandTotals[col] || 0)}
                      </TableCell>
                    ))}
                    {excelPivot.cols.length > 1 && (
                      <TableCell className="text-xs text-center font-mono font-bold bg-muted/80">
                        {formatPivotVal(Object.values(excelPivot.grandTotals).reduce((s, v) => s + v, 0))}
                      </TableCell>
                    )}
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground p-4">Select a Row field to create a pivot table.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save & Schedule Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Save & Schedule Pivot Report</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Report Name</Label>
              <Input value={reportName} onChange={e => setReportName(e.target.value)} placeholder="e.g. ARR by Platform" className="mt-1" />
            </div>

            <div>
              <Label className="text-sm">Schedule</Label>
              <p className="text-xs text-muted-foreground mb-2">Select days and time for the report to be triggered</p>
              <div className="flex gap-1.5 mb-3">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day}
                    onClick={() => toggleScheduleDay(day)}
                    className={`h-9 w-9 rounded-full text-xs font-medium transition-colors border ${
                      scheduleDays.has(day)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {day.charAt(0)}
                  </button>
                ))}
              </div>
              {scheduleDays.size > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Time:</Label>
                  <Select value={String(scheduleHour)} onValueChange={(v) => setScheduleHour(Number(v))}>
                    <SelectTrigger className="h-8 w-[70px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOURS.map(h => (
                        <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm font-medium">:</span>
                  <Select value={String(scheduleMinute)} onValueChange={(v) => setScheduleMinute(Number(v))}>
                    <SelectTrigger className="h-8 w-[70px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 15, 30, 45].map(m => (
                        <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground ml-1">
                    {Array.from(scheduleDays).join(", ")}
                  </span>
                </div>
              )}
            </div>

            {scheduleDays.size > 0 && (
              <div>
                <Label className="text-sm">Email Recipients</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={recipientInput} onChange={e => setRecipientInput(e.target.value)} placeholder="email@example.com"
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addRecipient())} />
                  <Button size="sm" variant="outline" onClick={addRecipient} className="shrink-0"><Plus className="h-4 w-4" /></Button>
                </div>
                {recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {recipients.map(email => (
                      <Badge key={email} variant="secondary" className="text-xs gap-1 pr-1">
                        {email}
                        <button onClick={() => removeRecipient(email)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveReport} disabled={loading}>{loading ? "Saving..." : "Save Report"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
