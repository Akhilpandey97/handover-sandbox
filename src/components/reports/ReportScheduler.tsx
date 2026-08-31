import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Calendar, Clock, Mail, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Trash2, Loader2, Send, History, Pencil, X
} from "lucide-react";

interface SavedReport {
  id: string;
  name: string;
  columns: string[];
  schedule: string;
  recipients: string[];
}

interface ReportExecution {
  id: string;
  report_id: string;
  triggered_at: string;
  status: string;
  recipients: string[];
  error_message: string | null;
  email_count: number;
  completed_at: string | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  success: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-green-600", label: "Sent" },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, color: "text-destructive", label: "Failed" },
  partial: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-yellow-600", label: "Partial" },
  sending: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: "text-blue-600", label: "Sending" },
  pending: { icon: <Clock className="h-3.5 w-3.5" />, color: "text-muted-foreground", label: "Pending" },
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseSchedule(schedule: string): string {
  if (!schedule || schedule === "none") return "Not scheduled";
  if (schedule === "daily") return "Daily at 09:00";
  const parts = schedule.split("@");
  if (parts.length === 2) {
    const label = parts[0] === "daily" ? "Daily" : parts[0];
    return `${label} at ${parts[1]}`;
  }
  return schedule;
}

export const ReportScheduler = () => {
  const { currentUser } = useAuth();
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [executions, setExecutions] = useState<ReportExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editReport, setEditReport] = useState<SavedReport | null>(null);
  const [editScheduleType, setEditScheduleType] = useState<"none" | "daily" | "weekly">("none");
  const [editDays, setEditDays] = useState<string[]>([]);
  const [editTime, setEditTime] = useState("09:00");
  const [editRecipients, setEditRecipients] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [reportsRes, execRes] = await Promise.all([
      supabase.from("saved_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("report_executions").select("*").order("triggered_at", { ascending: false }).limit(100),
    ]);
    if (reportsRes.data) {
      setReports(reportsRes.data.map((r: any) => ({
        id: r.id, name: r.name, columns: r.columns || [],
        schedule: r.schedule || "none", recipients: r.recipients || [],
      })));
    }
    if (execRes.data) {
      setExecutions(execRes.data.map((e: any) => ({
        id: e.id, report_id: e.report_id, triggered_at: e.triggered_at,
        status: e.status, recipients: e.recipients || [],
        error_message: e.error_message, email_count: e.email_count,
        completed_at: e.completed_at,
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openEditDialog = (report: SavedReport) => {
    setEditReport(report);
    setEditRecipients(report.recipients.join(", "));

    if (report.schedule === "none" || !report.schedule) {
      setEditScheduleType("none");
      setEditDays([]);
      setEditTime("09:00");
    } else if (report.schedule === "daily" || report.schedule.startsWith("daily@")) {
      setEditScheduleType("daily");
      setEditDays([]);
      const dailyParts = report.schedule.split("@");
      setEditTime(dailyParts.length === 2 ? dailyParts[1] : "09:00");
    } else {
      const parts = report.schedule.split("@");
      if (parts.length === 2) {
        const days = parts[0].split(",").map(d => d.trim()).filter(Boolean);
        setEditScheduleType("weekly");
        setEditDays(days);
        setEditTime(parts[1]);
      } else {
        setEditScheduleType("none");
        setEditDays([]);
        setEditTime("09:00");
      }
    }
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editReport) return;
    setSaving(true);

    let schedule = "none";
    if (editScheduleType === "daily") {
      schedule = `daily@${editTime}`;
    } else if (editScheduleType === "weekly" && editDays.length > 0) {
      schedule = `${editDays.join(",")}@${editTime}`;
    }

    const recipients = editRecipients
      .split(",")
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    const { error } = await supabase
      .from("saved_reports")
      .update({ schedule, recipients })
      .eq("id", editReport.id);

    if (error) {
      toast.error("Failed to update schedule");
    } else {
      toast.success("Schedule updated");
      setEditOpen(false);
      await fetchData();
    }
    setSaving(false);
  };

  const handleTriggerNow = async (reportId: string) => {
    setTriggerLoading(reportId);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-scheduled-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ report_id: reportId, tenant_id: currentUser?.tenantId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to trigger report");

      if (data.success) {
        toast.success(`Report sent to ${data.sent} recipient(s)`);
      } else if (data.sent > 0) {
        toast.warning(`Sent to ${data.sent}, failed for ${data.failed}: ${data.errors?.[0] || ""}`);
      } else {
        toast.error(`Failed: ${data.errors?.[0] || "Unknown error"}`);
      }
      await fetchData();
    } catch (e: any) {
      toast.error(e.message || "Failed to trigger report");
    } finally {
      setTriggerLoading(null);
    }
  };

  const handleDeleteExecution = async (execId: string) => {
    await supabase.from("report_executions").delete().eq("id", execId);
    setExecutions(prev => prev.filter(e => e.id !== execId));
  };

  // FIX: Show reports that have a schedule set (not "none"), regardless of recipients
  const scheduledReports = reports.filter(r => r.schedule && r.schedule !== "none");
  const unscheduledReports = reports.filter(r => !r.schedule || r.schedule === "none");

  const filteredExecutions = selectedReport
    ? executions.filter(e => e.report_id === selectedReport)
    : executions;

  const getReportName = (reportId: string) => reports.find(r => r.id === reportId)?.name || "Unknown";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Scheduled Reports */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Scheduled Reports ({scheduledReports.length})
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={fetchData}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          {scheduledReports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No scheduled reports yet. Go to Report Builder → Save & Schedule to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {scheduledReports.map(report => {
                const lastExec = executions.find(e => e.report_id === report.id);
                const statusCfg = lastExec ? STATUS_CONFIG[lastExec.status] || STATUS_CONFIG.pending : null;
                const hasRecipients = report.recipients.length > 0;
                return (
                  <div key={report.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{report.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          <Clock className="h-3 w-3 mr-0.5 inline" />
                          {parseSchedule(report.schedule)}
                        </Badge>
                        {!hasRecipients && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-300">
                            No recipients
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {hasRecipients && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {report.recipients.join(", ")}
                          </span>
                        )}
                        {lastExec && statusCfg && (
                          <span className={`text-xs flex items-center gap-1 ${statusCfg.color}`}>
                            {statusCfg.icon}
                            {statusCfg.label}
                            <span className="text-muted-foreground ml-1">
                              {new Date(lastExec.triggered_at).toLocaleString()}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => openEditDialog(report)}
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={triggerLoading === report.id || !hasRecipients}
                        onClick={() => handleTriggerNow(report.id)}
                      >
                        {triggerLoading === report.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        Send Now
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedReport === report.id ? "default" : "ghost"}
                        className="h-7 text-xs gap-1"
                        onClick={() => setSelectedReport(prev => prev === report.id ? null : report.id)}
                      >
                        <History className="h-3 w-3" /> History
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unscheduled Reports */}
      {unscheduledReports.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Saved Reports (No Schedule) ({unscheduledReports.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {unscheduledReports.map(report => (
                <div key={report.id} className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-muted/20">
                  <span className="text-sm">{report.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {report.columns.length} cols
                  </Badge>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => openEditDialog(report)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution History */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Execution History
              {selectedReport && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  {getReportName(selectedReport)}
                  <button onClick={() => setSelectedReport(null)} className="hover:text-destructive ml-0.5">✕</button>
                </Badge>
              )}
            </CardTitle>
            <span className="text-xs text-muted-foreground">{filteredExecutions.length} records</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[50vh]">
            {filteredExecutions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No execution history yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Report</TableHead>
                    <TableHead className="text-xs">Triggered</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Recipients</TableHead>
                    <TableHead className="text-xs">Duration</TableHead>
                    <TableHead className="text-xs">Error</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExecutions.map(exec => {
                    const statusCfg = STATUS_CONFIG[exec.status] || STATUS_CONFIG.pending;
                    const duration = exec.completed_at && exec.triggered_at
                      ? Math.round((new Date(exec.completed_at).getTime() - new Date(exec.triggered_at).getTime()) / 1000)
                      : null;
                    return (
                      <TableRow key={exec.id}>
                        <TableCell className="text-xs font-medium">{getReportName(exec.report_id)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(exec.triggered_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs flex items-center gap-1 ${statusCfg.color}`}>
                            {statusCfg.icon} {statusCfg.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {exec.recipients?.length || exec.email_count || 0} email(s)
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {duration !== null ? `${duration}s` : "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate text-destructive">
                          {exec.error_message || "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteExecution(exec.id)}>
                            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Edit Schedule Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Schedule — {editReport?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Schedule Type</Label>
              <Select value={editScheduleType} onValueChange={(v: "none" | "daily" | "weekly") => setEditScheduleType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Schedule</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Specific Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editScheduleType === "weekly" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Days</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map(day => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={editDays.includes(day) ? "default" : "outline"}
                      className="h-7 text-xs px-3"
                      onClick={() => setEditDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      )}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {editScheduleType !== "none" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Time</Label>
                <Input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Recipients (comma-separated emails)</Label>
              <Input
                value={editRecipients}
                onChange={e => setEditRecipients(e.target.value)}
                placeholder="email1@example.com, email2@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
