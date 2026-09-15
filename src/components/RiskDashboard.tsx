import { useState, useMemo, useCallback } from "react";
import { useProjectRisks, ProjectRisk } from "@/hooks/useProjectRisks";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ShieldAlert, Plus,
  Zap, Trash2, Pencil, ArrowUpDown
} from "lucide-react";
import { Project, projectStateLabels } from "@/data/projectsData";
import { ProjectActivityHistory } from "./ProjectActivityHistory";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { AttentionReasonBlock } from "@/components/AttentionReason";
import { Sparkles } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useLabels } from "@/contexts/LabelsContext";
import { GoLiveDate } from "./GoLiveDate";
import { arrCroreValue } from "@/lib/arr";

const CATEGORIES = [
  { value: "merchant_dependency", label: "Merchant Dependency" },
  { value: "external_dependency", label: "External Dependency" },
  { value: "internal_dependency", label: "Internal Dependency" },
  { value: "project_viability", label: "Project Viability" },
];

const SEVERITIES = [
  { value: "low", label: "Low", color: "bg-info-soft text-info-strong" },
  { value: "medium", label: "Medium", color: "bg-warning-soft text-warning-strong" },
  { value: "high", label: "High", color: "bg-warning-soft text-warning-strong" },
  { value: "critical", label: "Critical", color: "bg-destructive-soft text-destructive-strong" },
];

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "mitigating", label: "Mitigating" },
  { value: "resolved", label: "Resolved" },
  { value: "accepted", label: "Accepted" },
];

const severityColor = (s: string) => SEVERITIES.find(x => x.value === s)?.color ?? "";
const categoryLabel = (c: string) => CATEGORIES.find(x => x.value === c)?.label ?? c;

export const RiskDashboard = () => {
  const { risks, isLoading, createRisk, updateRisk, deleteRisk } = useProjectRisks();
  const { projects } = useProjects();
  const { currentUser } = useAuth();
  const isReadOnly = currentUser?.team === "gokwik_general";
  const navigate = useNavigate();
  const { getLabel, stateLabels } = useLabels();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<ProjectRisk | null>(null);
  const [activityProject, setActivityProject] = useState<{ id: string; name: string } | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<"severity" | "created_at" | "mitigation_due_at">("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Form state
  const [formProjectId, setFormProjectId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("merchant_dependency");
  const [formSeverity, setFormSeverity] = useState("medium");
  const [formMitigation, setFormMitigation] = useState("");
  const [formAssignedTo, setFormAssignedTo] = useState("");

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);
  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  // Verdicts come from the tenant's configured rules (Settings → Risk Rules), so
  // this tab, the project workspace and the at-risk lists cannot disagree.
  const { verdicts } = useProjectRiskVerdicts();
  // AI prose is fetched per row, only once shown — the page can list many
  // projects and explaining them all on load would be a request each.
  const [explainAll, setExplainAll] = useState(false);
  

  const atRiskProjects = useMemo(
    () => activeProjects
      .filter((p) => verdicts[p.id]?.level === "high")
      .sort((a, b) => (verdicts[b.id]?.score ?? 0) - (verdicts[a.id]?.score ?? 0)),
    [activeProjects, verdicts],
  );

  // Filtered & sorted risks
  const filteredRisks = useMemo(() => {
    let list = [...risks];
    if (filterCategory !== "all") list = list.filter(r => r.category === filterCategory);
    if (filterSeverity !== "all") list = list.filter(r => r.severity === filterSeverity);
    if (filterStatus !== "all") list = list.filter(r => r.status === filterStatus);

    const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "severity") cmp = (sevOrder[a.severity] || 0) - (sevOrder[b.severity] || 0);
      else if (sortField === "created_at") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortField === "mitigation_due_at") {
        const aT = a.mitigation_due_at ? new Date(a.mitigation_due_at).getTime() : Infinity;
        const bT = b.mitigation_due_at ? new Date(b.mitigation_due_at).getTime() : Infinity;
        cmp = aT - bT;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [risks, filterCategory, filterSeverity, filterStatus, sortField, sortDir]);


  const openDialog = (risk?: ProjectRisk) => {
    if (risk) {
      setEditingRisk(risk);
      setFormProjectId(risk.project_id);
      setFormTitle(risk.title);
      setFormDescription(risk.description ?? "");
      setFormCategory(risk.category);
      setFormSeverity(risk.severity);
      setFormMitigation(risk.mitigation_plan ?? "");
      setFormAssignedTo(risk.assigned_to ?? "");
    } else {
      setEditingRisk(null);
      setFormProjectId("");
      setFormTitle("");
      setFormDescription("");
      setFormCategory("merchant_dependency");
      setFormSeverity("medium");
      setFormMitigation("");
      setFormAssignedTo("");
    }
    setDialogOpen(true);
  };

  const handleSave = () => {
    const mitigationDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (editingRisk) {
      updateRisk.mutate({
        id: editingRisk.id,
        title: formTitle,
        description: formDescription || null,
        category: formCategory,
        severity: formSeverity,
        mitigation_plan: formMitigation || null,
        assigned_to: formAssignedTo || null,
      });
    } else {
      createRisk.mutate({
        project_id: formProjectId,
        title: formTitle,
        description: formDescription || null,
        category: formCategory,
        severity: formSeverity,
        trigger_type: "manual",
        mitigation_plan: formMitigation || null,
        mitigation_due_at: mitigationDue,
        assigned_to: formAssignedTo || null,
        status: "open",
        escalated: false,
        tenant_id: currentUser?.tenantId ?? null,
        trigger_rule: null,
        resolved_at: null,
        created_by: currentUser?.name ?? null,
      });
    }
    setDialogOpen(false);
  };

  const ageStr = (dateStr: string) => {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    return days === 0 ? "Today" : `${days}d ago`;
  };

  const slaStatus = (risk: ProjectRisk) => {
    if (!risk.mitigation_due_at) return null;
    const due = new Date(risk.mitigation_due_at).getTime();
    const diff = due - Date.now();
    if (risk.mitigation_plan && risk.status !== "open") return "ok";
    if (diff < 0) return "breached";
    if (diff < 6 * 60 * 60 * 1000) return "warning";
    return "ok";
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      {/* Risk engine verdicts — deterministic, with AI prose layered on top */}
      <Card className="shadow-sm border-border">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="portal-heading flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                At Risk
                <Badge variant="secondary" className="text-xs">{atRiskProjects.length}</Badge>
              </CardTitle>
              <CardDescription>
                Evaluated from Settings → Risk Rules. A project is High Risk when any enabled rule matches.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setExplainAll((v) => !v)}
              disabled={atRiskProjects.length === 0}
            >
              <Sparkles className="h-4 w-4" />
              {explainAll ? "Hide AI explanations" : "Explain with AI"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {atRiskProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No projects are currently at risk.
            </p>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
              <TableHeader className="table-header-tint">
                <TableRow className="hover:bg-navy/5 border-b">
                  <TableHead className="text-navy font-semibold">{getLabel("field_merchant_name")}</TableHead>
                  <TableHead className="text-navy font-semibold">Risk</TableHead>
                  <TableHead className="text-navy font-semibold whitespace-nowrap">Why</TableHead>
                  <TableHead className="text-navy font-semibold whitespace-nowrap">{getLabel("field_expected_go_live_date")}</TableHead>
                  <TableHead className="text-navy font-semibold whitespace-nowrap">{getLabel("field_project_state")}</TableHead>
                  <TableHead className="text-navy font-semibold whitespace-nowrap">{getLabel("field_assigned_owner")}</TableHead>
                  <TableHead className="text-navy font-semibold whitespace-nowrap text-right">{getLabel("field_arr")} (Cr)</TableHead>
                  <TableHead className="text-navy font-semibold text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atRiskProjects.map((p) => {
                  const verdict = verdicts[p.id]!;
                  const reasons = verdict.findings.map((f) => f.detail);
                  const overdue = Math.max(0, ...verdict.findings.map((f) => f.magnitude ?? 0));
                  return (
                    <>
                      <TableRow key={p.id} className="align-top">
                        <TableCell className="font-medium text-sm py-2">{p.merchantName}</TableCell>
                        <TableCell className="py-2">
                          <Badge className="bg-destructive hover:bg-destructive text-destructive-foreground text-2xs px-2 py-0">High Risk</Badge>
                          {overdue > 0 && (
                            <span className="ml-1.5 text-2xs font-medium text-destructive-strong">{overdue}d</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground max-w-[22rem]">
                          {reasons.join(" · ")}
                        </TableCell>
                        <TableCell className="py-2 text-sm whitespace-nowrap">
                          <GoLiveDate project={p} />
                        </TableCell>
                        <TableCell className="py-2 text-sm whitespace-nowrap">
                          {stateLabels[p.projectState] || projectStateLabels[p.projectState] || p.projectState}
                        </TableCell>
                        <TableCell className="py-2 text-sm whitespace-nowrap">
                          {p.assignedOwnerName || "Unassigned"}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-right whitespace-nowrap">
                          {arrCroreValue(p.arr)}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: p.id } })}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                      {/* Explanations are toggled once from the header button, and
                          the endpoint caches by reason hash, so reopening costs nothing. */}
                      {explainAll && (
                        <TableRow key={`${p.id}-ai`} className="hover:bg-transparent">
                          <TableCell colSpan={8} className="py-2 bg-muted/20">
                            <AttentionReasonBlock projectId={p.id} kind="risk" reasons={reasons} enabled compact />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Filters + Add */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {!isReadOnly && (
          <Button onClick={() => openDialog()} size="sm" className="h-8 gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add Risk
          </Button>
        )}
      </div>

      {/* Risk Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table wrapperClassName="rounded-none border-0 bg-transparent shadow-none">
            <TableHeader className="table-header-tint">
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("severity")}>
                  <span className="flex items-center gap-1">Severity <ArrowUpDown className="h-3 w-3" /></span>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("created_at")}>
                  <span className="flex items-center gap-1">Age <ArrowUpDown className="h-3 w-3" /></span>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("mitigation_due_at")}>
                  <span className="flex items-center gap-1">SLA <ArrowUpDown className="h-3 w-3" /></span>
                </TableHead>
                <TableHead>Mitigation</TableHead>
                {!isReadOnly && <TableHead className="w-28">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRisks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isReadOnly ? 8 : 9} className="text-center py-8 text-muted-foreground">
                    {isLoading ? "Loading..." : "No risks found"}
                  </TableCell>
                </TableRow>
              )}
              {filteredRisks.map(risk => {
                const proj = projectMap.get(risk.project_id);
                const sla = slaStatus(risk);
                return (
                  <TableRow
                    key={risk.id}
                    className={sla === "breached" ? "bg-destructive/50" : ""}
                  >
                    <TableCell className="font-medium max-w-[140px] truncate">
                      <button
                        className="hover:text-primary hover:underline cursor-pointer transition-colors text-left truncate w-full"
                        onClick={() => setActivityProject({ id: risk.project_id, name: proj?.merchantName ?? risk.project_id.slice(0, 8) })}
                      >
                        {proj?.merchantName ?? risk.project_id.slice(0, 8)}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate font-medium">{risk.title}</div>
                      {risk.trigger_type === "auto" && (
                        <Badge variant="outline" className="text-2xs mt-0.5">Auto</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{categoryLabel(risk.category)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${severityColor(risk.severity)}`}>{risk.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      {!isReadOnly ? (
                        <Select
                          value={risk.status}
                          onValueChange={(v) => updateRisk.mutate({
                            id: risk.id,
                            status: v,
                            ...(v === "resolved" ? { resolved_at: new Date().toISOString() } : {}),
                          })}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{risk.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ageStr(risk.created_at)}</TableCell>
                    <TableCell>
                      {sla === "breached" && <Badge variant="destructive" className="text-2xs">Breached</Badge>}
                      {sla === "warning" && <Badge className="bg-warning-soft text-warning-strong text-2xs">Due soon</Badge>}
                      {sla === "ok" && risk.mitigation_due_at && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(risk.mitigation_due_at).toLocaleDateString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[160px]">
                      {risk.mitigation_plan ? (
                        <span className="text-xs truncate block">{risk.mitigation_plan}</span>
                      ) : (
                        <span className="text-xs text-destructive-strong italic">Missing</span>
                      )}
                    </TableCell>
                    {!isReadOnly && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openDialog(risk)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {!risk.escalated && (
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-warning-strong"
                              onClick={() => updateRisk.mutate({ id: risk.id, escalated: true })}
                              title="Escalate"
                            >
                              <Zap className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => deleteRisk.mutate(risk.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>


      {/* Add/Edit Risk Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRisk ? "Edit Risk" : "Add Risk"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editingRisk && (
              <div>
                <Label>Project</Label>
                <Select value={formProjectId} onValueChange={setFormProjectId}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {activeProjects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.merchantName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Title</Label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Short risk description" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Detailed context" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={formSeverity} onValueChange={setFormSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Mitigation Plan</Label>
              <Textarea value={formMitigation} onChange={e => setFormMitigation(e.target.value)} placeholder="Define mitigation steps" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formTitle || (!editingRisk && !formProjectId)}>
              {editingRisk ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activityProject && (
        <ProjectActivityHistory
          projectId={activityProject.id}
          projectName={activityProject.name}
          open={!!activityProject}
          onOpenChange={(open) => { if (!open) setActivityProject(null); }}
        />
      )}
    </div>
  );
};
