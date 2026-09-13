import { useState, useEffect, useMemo, useCallback } from "react";
import { Project, projectStateLabels, formatDuration, calculateTimeFromChecklist } from "@/data/projectsData";
import { CustomField } from "@/hooks/useCustomFields";
import { useLabels } from "@/contexts/LabelsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { tenantScope } from "@/lib/tenant-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Trash2, Play, Plus, Clock, Calendar, FileText, X, ChevronRight, ChevronDown, Sigma, GripVertical } from "lucide-react";
import { useReportFilters } from "@/hooks/useReportFilters";
import { ReportFilterBar } from "@/components/reports/ReportFilterBar";

// All available columns for report builder
const AVAILABLE_COLUMNS: { key: string; label: string; group: string }[] = [
  { key: "merchantName", label: "Merchant Name", group: "Basic" },
  { key: "mid", label: "MID", group: "Basic" },
  { key: "platform", label: "Platform", group: "Basic" },
  { key: "category", label: "Category", group: "Basic" },
  { key: "arr", label: "ARR", group: "Financial" },
  { key: "txnsPerDay", label: "Txns/Day", group: "Financial" },
  { key: "aov", label: "AOV", group: "Financial" },
  { key: "projectState", label: "Project State", group: "Status" },
  { key: "currentOwnerTeam", label: "Current Team", group: "Status" },
  { key: "assignedOwnerName", label: "Assigned Owner", group: "Status" },
  { key: "currentResponsibility", label: "Responsibility", group: "Status" },
  { key: "goLivePercent", label: "Go Live %", group: "Status" },
  { key: "pendingAcceptance", label: "Pending Acceptance", group: "Status" },
  { key: "kickOffDate", label: "Kick-Off Date", group: "Dates" },
  { key: "expectedGoLiveDate", label: "Expected Go-Live", group: "Dates" },
  { key: "goLiveDate", label: "Go-Live Date", group: "Dates" },
  { key: "salesSpoc", label: "Sales SPOC", group: "Details" },
  { key: "integrationType", label: "Integration Type", group: "Details" },
  { key: "pgOnboarding", label: "PG Onboarding", group: "Details" },
  { key: "brandUrl", label: "Brand URL", group: "Links" },
  { key: "jiraLink", label: "JIRA Link", group: "Links" },
  { key: "brdLink", label: "BRD Link", group: "Links" },
  { key: "mintNotes", label: "MINT Notes", group: "Notes" },
  { key: "projectNotes", label: "Project Notes", group: "Notes" },
  { key: "currentPhaseComment", label: "Phase Comment", group: "Notes" },
  { key: "checklistProgress", label: "Checklist Progress", group: "Metrics" },
  { key: "gokwikTime", label: "GoKwik Time", group: "Metrics" },
  { key: "merchantTime", label: "Merchant Time", group: "Metrics" },
  { key: "transferCount", label: "Transfer Count", group: "Metrics" },
];

const BASE_GROUPABLE_COLUMNS = ["projectState", "currentOwnerTeam", "platform", "category", "assignedOwnerName", "currentResponsibility", "integrationType", "pgOnboarding", "salesSpoc"];
const NUMERIC_COLUMNS = ["arr", "txnsPerDay", "aov", "goLivePercent", "transferCount"];

const DEFAULT_GROUP_ORDER = ["Basic", "Financial", "Status", "Dates", "Details", "Links", "Notes", "Metrics", "Custom Fields"];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface SavedReport {
  id: string;
  name: string;
  columns: string[];
  schedule: string;
  recipients: string[];
}

type AggType = "sum" | "avg" | "count" | "min" | "max";

function getCellValue(project: Project, key: string, labels: any): string {
  switch (key) {
    case "merchantName": return project.merchantName;
    case "mid": return project.mid;
    case "platform": return project.platform;
    case "category": return project.category;
    case "arr": return project.arr.toFixed(2);
    case "txnsPerDay": return String(project.txnsPerDay);
    case "aov": return String(project.aov);
    case "projectState": return labels.stateLabels[project.projectState] || project.projectState;
    case "currentPhase": return labels.phaseLabels[project.currentPhase] || project.currentPhase;
    case "currentOwnerTeam": return labels.teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam;
    case "assignedOwnerName": return project.assignedOwnerName || "Unassigned";
    case "currentResponsibility": return labels.responsibilityLabels[project.currentResponsibility] || project.currentResponsibility;
    case "goLivePercent": return `${project.goLivePercent}%`;
    case "pendingAcceptance": return project.pendingAcceptance ? "Yes" : "No";
    case "kickOffDate": return project.dates.kickOffDate;
    case "expectedGoLiveDate": return project.dates.expectedGoLiveDate || "";
    case "goLiveDate": return project.dates.goLiveDate || "";
    case "salesSpoc": return project.salesSpoc;
    case "integrationType": return project.integrationType;
    case "pgOnboarding": return project.pgOnboarding;
    case "brandUrl": return project.links.brandUrl;
    case "jiraLink": return project.links.jiraLink || "";
    case "brdLink": return project.links.brdLink || "";
    case "mintNotes": return project.notes.mintNotes || "";
    case "projectNotes": return project.notes.projectNotes || "";
    case "currentPhaseComment": return project.notes.currentPhaseComment || "";
    case "checklistProgress": {
      const done = project.checklist.filter(c => c.completed).length;
      return `${done}/${project.checklist.length}`;
    }
    case "gokwikTime": return formatDuration(calculateTimeFromChecklist(project.checklist).gokwik);
    case "merchantTime": return formatDuration(calculateTimeFromChecklist(project.checklist).merchant);
    case "transferCount": return String(project.transferHistory.length);
    default: {
      // Check for custom field values
      if (key.startsWith("custom_field_") && labels.customValuesMap) {
        const fieldId = key.replace("custom_field_", "");
        return labels.customValuesMap[project.id]?.[fieldId] || "";
      }
      return "";
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

interface PivotGroup {
  key: string;
  label: string;
  projects: Project[];
  aggregates: Record<string, number>;
}

export const ReportsBuilder = ({ projects, customFields = [], customValuesMap = {}, initialPivot = false }: { projects: Project[]; customFields?: CustomField[]; customValuesMap?: Record<string, Record<string, string>>; initialPivot?: boolean }) => {
  const { teamLabels, responsibilityLabels, phaseLabels, stateLabels } = useLabels();
  const { currentUser } = useAuth();
  const labels = { teamLabels, responsibilityLabels, phaseLabels, stateLabels, customValuesMap };

  const [selectedColumns, setSelectedColumns] = useState<string[]>(["merchantName", "projectState", "arr", "goLivePercent"]);
  const [reportAggType, setReportAggType] = useState<AggType>("sum");

  // Pivot
  const [pivotRowField, setPivotRowField] = useState<string>("none");
  const [pivotColField, setPivotColField] = useState<string>("none");
  const [pivotValueField, setPivotValueField] = useState<string>("arr");
  const [pivotAggType, setPivotAggType] = useState<AggType>("sum");
  const [showPivot, setShowPivot] = useState(initialPivot);

  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [reportName, setReportName] = useState("");
  const [scheduleDays, setScheduleDays] = useState<Set<string>>(new Set());
  const [scheduleHour, setScheduleHour] = useState<number>(9);
  const [scheduleMinute, setScheduleMinute] = useState<number>(0);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);

  const filterState = useReportFilters(projects);
  const { filteredProjects } = filterState;

  const [groupByColumn, setGroupByColumn] = useState<string>("none");

  // Draggable column groups
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("report_group_order");
      return saved ? JSON.parse(saved) : DEFAULT_GROUP_ORDER;
    } catch { return DEFAULT_GROUP_ORDER; }
  });
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      const { data } = await supabase
        .from("saved_reports")
        .select("*")
        .eq("tenant_id", tenantScope(currentUser?.tenantId))
        .order("created_at", { ascending: false });
      if (data) {
        setSavedReports(data.map((r: any) => ({
          id: r.id, name: r.name, columns: r.columns || [], schedule: r.schedule || "none", recipients: r.recipients || [],
        })));
      }
    };
    fetchReports();
  }, [currentUser?.tenantId]);

  const toggleColumn = (key: string) => {
    setSelectedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
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

  const columnGroups = useMemo(() => {
    const groups: Record<string, { key: string; label: string; group: string }[]> = {};
    allColumns.forEach(col => {
      if (!groups[col.group]) groups[col.group] = [];
      groups[col.group].push(col);
    });
    return groups;
  }, [allColumns]);

  const handleGroupDragStart = (group: string) => setDraggedGroup(group);
  const handleGroupDragOver = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    if (!draggedGroup || draggedGroup === targetGroup) return;
    setGroupOrder(prev => {
      const newOrder = [...prev];
      const fromIdx = newOrder.indexOf(draggedGroup);
      const toIdx = newOrder.indexOf(targetGroup);
      if (fromIdx === -1 || toIdx === -1) return prev;
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, draggedGroup);
      return newOrder;
    });
  };
  const handleGroupDragEnd = () => {
    setDraggedGroup(null);
    localStorage.setItem("report_group_order", JSON.stringify(groupOrder));
  };

  // Selected numeric columns for agg footer
  const selectedNumericCols = useMemo(() => selectedColumns.filter(k => NUMERIC_COLUMNS.includes(k)), [selectedColumns]);

  // Grouped table data
  const pivotGroups = useMemo<PivotGroup[]>(() => {
    if (groupByColumn === "none") return [];
    const groupMap = new Map<string, Project[]>();
    filteredProjects.forEach(p => {
      const val = getCellValue(p, groupByColumn, labels);
      const existing = groupMap.get(val) || [];
      existing.push(p);
      groupMap.set(val, existing);
    });
    return Array.from(groupMap.entries()).map(([key, groupProjects]) => {
      const aggregates: Record<string, number> = {};
      selectedNumericCols.forEach(col => {
        const values = groupProjects.map(p => getNumericValue(p, col));
        aggregates[col] = computeAgg(values, reportAggType);
      });
      return { key, label: key || "—", projects: groupProjects, aggregates };
    });
  }, [groupByColumn, filteredProjects, selectedColumns, labels, reportAggType, selectedNumericCols]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Excel-style pivot table computation
  const excelPivot = useMemo(() => {
    if (!showPivot || pivotRowField === "none") return null;
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
  }, [showPivot, pivotRowField, pivotColField, pivotValueField, pivotAggType, filteredProjects, labels]);

  const formatPivotVal = (val: number) => formatAggVal(pivotValueField, val, pivotAggType);

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

      // Encode active filters + sort into columns so they're persisted and applied in scheduled emails
      const filterSnapshot = {
        teamFilter: filterState.teamFilter,
        ownerFilter: filterState.ownerFilter,
        stateFilter: filterState.stateFilter,
        platformFilter: filterState.platformFilter,
        categoryFilter: filterState.categoryFilter,
        responsibilityFilter: filterState.responsibilityFilter,
        arrMin: filterState.arrMin,
        arrMax: filterState.arrMax,
        kickOffFrom: filterState.kickOffFrom,
        kickOffTo: filterState.kickOffTo,
        goLiveFrom: filterState.goLiveFrom,
        goLiveTo: filterState.goLiveTo,
        expectedGoLiveFrom: filterState.expectedGoLiveFrom,
        expectedGoLiveTo: filterState.expectedGoLiveTo,
        expectedGoLiveNone: filterState.expectedGoLiveNone,
        sortField: filterState.sortField,
        sortDir: filterState.sortDir,
      };
      const hasState = filterState.activeFilterCount > 0 || filterState.sortField !== "none";
      const columnsToSave = hasState
        ? [...selectedColumns, `__FILTER_STATE__:${JSON.stringify(filterSnapshot)}`]
        : selectedColumns;

      const { data, error } = await supabase.from("saved_reports").insert({
        name: reportName.trim(), columns: columnsToSave, schedule: scheduleValue, recipients,
        tenant_id: currentUser?.tenantId, created_by: currentUser?.id,
      }).select().single();
      if (error) throw error;
      setSavedReports(prev => [{ id: data.id, name: data.name, columns: data.columns || [], schedule: data.schedule || "none", recipients: data.recipients || [] }, ...prev]);
      toast.success(`Report "${reportName}" saved`);
      setSaveDialogOpen(false); setReportName(""); setScheduleDays(new Set()); setRecipients([]);
    } catch (err: any) { toast.error(err.message || "Failed to save report"); }
    finally { setLoading(false); }
  };

  const handleDeleteReport = async (id: string) => {
    const { error } = await supabase.from("saved_reports").delete().eq("id", id);
    if (!error) { setSavedReports(prev => prev.filter(r => r.id !== id)); toast.success("Report deleted"); }
  };

  const loadReport = (report: SavedReport) => {
    const filterEl = report.columns.find(c => c.startsWith("__FILTER_STATE__:"));
    const actualCols = report.columns.filter(c => !c.startsWith("__FILTER_STATE__:"));
    setSelectedColumns(actualCols);
    if (filterEl) {
      try {
        const fs = JSON.parse(filterEl.slice("__FILTER_STATE__:".length));
        if (fs.teamFilter) filterState.setTeamFilter(fs.teamFilter);
        if (fs.ownerFilter) filterState.setOwnerFilter(fs.ownerFilter);
        if (fs.stateFilter) filterState.setStateFilter(fs.stateFilter);
        if (fs.platformFilter) filterState.setPlatformFilter(fs.platformFilter);
        if (fs.categoryFilter) filterState.setCategoryFilter(fs.categoryFilter);
        if (fs.responsibilityFilter) filterState.setResponsibilityFilter(fs.responsibilityFilter);
        if (fs.arrMin !== undefined) filterState.setArrMin(fs.arrMin);
        if (fs.arrMax !== undefined) filterState.setArrMax(fs.arrMax);
        if (fs.kickOffFrom !== undefined) filterState.setKickOffFrom(fs.kickOffFrom);
        if (fs.kickOffTo !== undefined) filterState.setKickOffTo(fs.kickOffTo);
        if (fs.goLiveFrom !== undefined) filterState.setGoLiveFrom(fs.goLiveFrom);
        if (fs.goLiveTo !== undefined) filterState.setGoLiveTo(fs.goLiveTo);
        if (fs.expectedGoLiveFrom !== undefined) filterState.setExpectedGoLiveFrom(fs.expectedGoLiveFrom);
        if (fs.expectedGoLiveTo !== undefined) filterState.setExpectedGoLiveTo(fs.expectedGoLiveTo);
        if (fs.expectedGoLiveNone !== undefined) filterState.setExpectedGoLiveNone(fs.expectedGoLiveNone);
        if (fs.sortField) filterState.setSortField(fs.sortField);
        if (fs.sortDir) filterState.setSortDir(fs.sortDir);
      } catch { /* ignore malformed filter state */ }
    }
    toast.info(`Loaded "${report.name}"`);
  };

  const exportReportCSV = () => {
    const headers = selectedColumns.map(k => allColumns.find(c => c.key === k)?.label || k);
    const rows = filteredProjects.map(p => selectedColumns.map(k => {
      const val = getCellValue(p, k, labels);
      return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    }));
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `custom-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  // Compute footer aggregates for flat table
  const footerAggregates = useMemo(() => {
    const agg: Record<string, number> = {};
    selectedNumericCols.forEach(col => {
      const values = filteredProjects.map(p => getNumericValue(p, col));
      agg[col] = computeAgg(values, reportAggType);
    });
    return agg;
  }, [filteredProjects, selectedNumericCols, reportAggType]);

  const renderGroupedTable = () => {
    const displayCols = selectedColumns.filter(k => k !== groupByColumn);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-8"></TableHead>
            {displayCols.map(key => {
              const col = allColumns.find(c => c.key === key);
              return <TableHead key={key} className="text-xs whitespace-nowrap">{col?.label || key}</TableHead>;
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pivotGroups.map(group => {
            const isExpanded = expandedGroups.has(group.key);
            const groupLabel = allColumns.find(c => c.key === groupByColumn)?.label || groupByColumn;
            return (
              <> 
                <TableRow
                  key={`group-${group.key}`}
                  className="bg-muted/60 hover:bg-muted/80 cursor-pointer font-medium"
                  onClick={() => toggleGroup(group.key)}
                >
                  <TableCell className="py-2 px-2">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </TableCell>
                  <TableCell colSpan={1} className="text-xs font-semibold py-2">
                    <span className="text-muted-foreground mr-1">{groupLabel}:</span>
                    {group.label}
                    <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{group.projects.length}</Badge>
                  </TableCell>
                  {displayCols.slice(1).map(col => {
                    const agg = group.aggregates[col];
                    if (agg !== undefined) {
                      return (
                        <TableCell key={col} className="text-xs py-2">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Sigma className="h-3 w-3" />
                            <span className="font-mono font-semibold text-foreground">{formatAggVal(col, agg, reportAggType)}</span>
                          </div>
                        </TableCell>
                      );
                    }
                    return <TableCell key={col} className="text-xs py-2 text-muted-foreground">—</TableCell>;
                  })}
                </TableRow>
                {isExpanded && group.projects.map(project => (
                  <TableRow key={project.id} className="bg-background">
                    <TableCell></TableCell>
                    {displayCols.map(key => (
                      <TableCell key={key} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                        {getCellValue(project, key, labels)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  const renderFlatTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          {selectedColumns.map(key => {
            const col = allColumns.find(c => c.key === key);
            return <TableHead key={key} className="text-xs whitespace-nowrap">{col?.label || key}</TableHead>;
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredProjects.map(project => (
          <TableRow key={project.id}>
            {selectedColumns.map(key => (
              <TableCell key={key} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                {getCellValue(project, key, labels)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {/* Aggregate footer row */}
        {selectedNumericCols.length > 0 && (
          <TableRow className="bg-muted/60 font-semibold border-t-2">
            {selectedColumns.map(key => {
              const agg = footerAggregates[key];
              if (agg !== undefined) {
                return (
                  <TableCell key={key} className="text-xs py-2">
                    <div className="flex items-center gap-1">
                      <Sigma className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono font-semibold">{formatAggVal(key, agg, reportAggType)}</span>
                    </div>
                  </TableCell>
                );
              }
              return <TableCell key={key} className="text-xs py-2 text-muted-foreground">{key === selectedColumns[0] ? `${reportAggType.toUpperCase()}` : ""}</TableCell>;
            })}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const renderExcelPivot = () => {
    if (!excelPivot) return <p className="text-sm text-muted-foreground p-4">Select a Row field to create a pivot table.</p>;
    const { rows, cols, data, grandTotals } = excelPivot;
    const rowLabel = allColumns.find(c => c.key === pivotRowField)?.label || pivotRowField;

    return (
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-semibold whitespace-nowrap sticky left-0 bg-muted/50 z-10">{rowLabel}</TableHead>
              {cols.map(col => (
                <TableHead key={col} className="text-xs font-semibold whitespace-nowrap text-center">{col}</TableHead>
              ))}
              {cols.length > 1 && <TableHead className="text-xs font-semibold whitespace-nowrap text-center bg-muted/80">Grand Total</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => {
              const rowTotal = cols.reduce((s, c) => s + (data[row]?.[c] || 0), 0);
              return (
                <TableRow key={row} className="hover:bg-muted/20">
                  <TableCell className="text-xs font-medium whitespace-nowrap sticky left-0 bg-background z-10">{row}</TableCell>
                  {cols.map(col => (
                    <TableCell key={col} className="text-xs text-center font-mono">
                      {formatPivotVal(data[row]?.[col] || 0)}
                    </TableCell>
                  ))}
                  {cols.length > 1 && (
                    <TableCell className="text-xs text-center font-mono font-semibold bg-muted/30">
                      {formatPivotVal(rowTotal)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/60 font-semibold">
              <TableCell className="text-xs font-semibold sticky left-0 bg-muted/60 z-10">Grand Total</TableCell>
              {cols.map(col => (
                <TableCell key={col} className="text-xs text-center font-mono font-semibold">
                  {formatPivotVal(grandTotals[col] || 0)}
                </TableCell>
              ))}
              {cols.length > 1 && (
                <TableCell className="text-xs text-center font-mono font-bold bg-muted/80">
                  {formatPivotVal(Object.values(grandTotals).reduce((s, v) => s + v, 0))}
                </TableCell>
              )}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      {savedReports.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="portal-heading flex items-center gap-2"><FileText className="h-4 w-4 text-primary" />Saved Reports</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {savedReports.map(report => (
                <div key={report.id} className="flex items-center gap-1 border rounded-lg px-3 py-1.5 bg-muted/30">
                  <button onClick={() => loadReport(report)} className="text-sm font-medium hover:text-primary transition-colors">{report.name}</button>
                  {report.schedule !== "none" && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      <Calendar className="h-3 w-3 mr-0.5 inline" />
                      scheduled
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-5 w-5 ml-1" onClick={() => handleDeleteReport(report.id)}>
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-7 justify-start gap-1.5 px-1"
              onClick={() => setColumnsOpen((open) => !open)}
              aria-expanded={columnsOpen}
              aria-controls="report-column-selector"
              title={columnsOpen ? "Collapse column selector" : "Expand column selector"}
            >
              {columnsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="portal-heading">Select Columns ({selectedColumns.length} selected) <span className="text-[10px] text-muted-foreground font-normal ml-1">— drag groups to reorder</span></CardTitle>
            </Button>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Agg:</Label>
                <Select value={reportAggType} onValueChange={(v) => setReportAggType(v as AggType)}>
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
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Group By:</Label>
                <Select value={groupByColumn} onValueChange={setGroupByColumn}>
                  <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Grouping</SelectItem>
                    {groupableColumns.filter(k => selectedColumns.includes(k)).map(k => {
                      const col = allColumns.find(c => c.key === k);
                      return <SelectItem key={k} value={k}>{col?.label || k}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportReportCSV}>
                <Play className="h-3 w-3" />Export CSV
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setSaveDialogOpen(true)}>
                <Save className="h-3 w-3" />Save & Schedule
              </Button>
            </div>
          </div>
        </CardHeader>
        {columnsOpen && (
          <CardContent id="report-column-selector" className="px-4 pb-3 pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-1">
              {groupOrder.filter(g => columnGroups[g]).map(group => (
                <div
                  key={group}
                  draggable
                  onDragStart={() => handleGroupDragStart(group)}
                  onDragOver={(e) => handleGroupDragOver(e, group)}
                  onDragEnd={handleGroupDragEnd}
                  className={`cursor-grab active:cursor-grabbing rounded-md p-1.5 transition-opacity ${draggedGroup === group ? "opacity-50 bg-primary/10" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <GripVertical className="h-3 w-3 text-muted-foreground/50" />
                    <p className="text-[10px] font-semibold text-muted-foreground tracking-normal">{group}</p>
                  </div>
                  {columnGroups[group].map(col => (
                    <label key={col.key} className="flex items-center gap-1.5 py-0.5 cursor-pointer text-xs hover:text-primary transition-colors">
                      <Checkbox checked={selectedColumns.includes(col.key)} onCheckedChange={() => toggleColumn(col.key)} className="h-3.5 w-3.5" />
                      {col.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Report Preview */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="portal-heading">
                Report Preview ({filteredProjects.length}{filteredProjects.length !== projects.length ? ` of ${projects.length}` : ""} projects)
                {groupByColumn !== "none" && (
                  <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">
                    Grouped by {allColumns.find(c => c.key === groupByColumn)?.label}
                  </Badge>
                )}
              </CardTitle>
              <ReportFilterBar {...filterState} projectCount={filteredProjects.length} />
            </div>
            {groupByColumn !== "none" && (
              <Button variant="ghost" size="sm" className="h-6 text-[11px]"
                onClick={() => {
                  if (expandedGroups.size === pivotGroups.length) setExpandedGroups(new Set());
                  else setExpandedGroups(new Set(pivotGroups.map(g => g.key)));
                }}
              >
                {expandedGroups.size === pivotGroups.length ? "Collapse All" : "Expand All"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[70vh]">
            {groupByColumn !== "none" ? renderGroupedTable() : renderFlatTable()}
          </div>
        </CardContent>
      </Card>


      {/* Save & Schedule Dialog - Google Calendar style */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Save & Schedule Report</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Report Name</Label>
              <Input value={reportName} onChange={e => setReportName(e.target.value)} placeholder="e.g. Weekly ARR Summary" className="mt-1" />
            </div>

            {/* Calendar-style day + time picker */}
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
