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
  AlertTriangle, ShieldAlert, Clock, Plus,
  Zap, Eye, Trash2, Pencil, AlertCircle, ArrowUpDown
} from "lucide-react";
import { Project } from "@/data/projectsData";
import { ProjectActivityHistory } from "./ProjectActivityHistory";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { AttentionReasonBlock } from "@/components/AttentionReason";
import { Sparkles } from "lucide-react";

const CATEGORIES = [
  { value: "merchant_dependency", label: "Merchant Dependency" },
  { value: "external_dependency", label: "External Dependency" },
  { value: "internal_dependency", label: "Internal Dependency" },
  { value: "project_viability", label: "Project Viability" },
];

const SEVERITIES = [
  { value: "low", label: "Low", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  { value: "medium", label: "Medium", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "high", label: "High", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "critical", label: "Critical", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
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
  const [expandedExplanations, setExpandedExplanations] = useState<Set<string>>(new Set());

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

  // KPIs
  const openRisks = risks.filter(r => r.status === "open" || r.status === "mitigating");
  const critHighCount = openRisks.filter(r => r.severity === "critical" || r.severity === "high").length;
  const noMitigationCount = openRisks.filter(r => !r.mitigation_plan).length;
  const slaBreach = openRisks.filter(r => r.mitigation_due_at && new Date(r.mitigation_due_at).getTime() < Date.now() && !r.mitigation_plan).length;

  // Silent delay: active projects with no risk tracked
  const projectsWithRisks = new Set(risks.filter(r => r.status !== "resolved").map(r => r.project_id));
  const silentDelayCount = activeProjects.filter(p =>
    p.projectState !== "live" && p.currentPhase !== "completed" && !projectsWithRisks.has(p.id)
    && p.dates.expectedGoLiveDate && new Date(p.dates.expectedGoLiveDate).getTime() < Date.now()
  ).length;

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
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <ShieldAlert className="h-4 w-4" /> Open Risks
            </div>
            <div className="text-2xl font-bold">{openRisks.length}</div>
          </CardContent>
        </Card>
        <Card className={critHighCount > 0 ? "border-red-300 dark:border-red-800" : ""}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Critical / High
            </div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{critHighCount}</div>
          </CardContent>
        </Card>
        <Card className={slaBreach > 0 ? "border-orange-300 dark:border-orange-800" : ""}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-4 w-4 text-orange-500" /> SLA Breached
            </div>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{slaBreach}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <AlertCircle className="h-4 w-4" /> No Mitigation
            </div>
            <div className="text-2xl font-bold">{noMitigationCount}</div>
          </CardContent>
        </Card>
        <Card className={silentDelayCount > 0 ? "border-yellow-300 dark:border-yellow-800" : ""}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Eye className="h-4 w-4 text-yellow-600" /> Silent Delays
            </div>
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{silentDelayCount}</div>
          </CardContent>
        </Card>
      </div>

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
        <CardContent className="p-4">
          {atRiskProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No projects are currently at risk.
            </p>
          ) : (
            <div className="space-y-2">
              {atRiskProjects.map((p) => {
                const verdict = verdicts[p.id]!;
                const reasons = verdict.findings.map((f) => f.detail);
                const showExplanation = explainAll || expandedExplanations.has(p.id);
                return (
                  <div key={p.id} className="rounded-lg border border-border/60 p-3 bg-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{p.merchantName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{reasons.join(" · ")}</p>
                      </div>
                      <Badge className="bg-red-600 hover:bg-red-600 text-white shrink-0">High Risk</Badge>
                    </div>

                    {showExplanation ? (
                      <div className="mt-2 border-t pt-2">
                        {/* Fetches only once shown, and the endpoint caches by
                            reason hash, so reopening costs nothing. */}
                        <AttentionReasonBlock
                          projectId={p.id}
                          kind="risk"
                          reasons={reasons}
                          enabled={showExplanation}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedExplanations((prev) => new Set(prev).add(p.id))}
                        className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Sparkles className="h-3 w-3" /> Explain with AI
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters + Add */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {SEVERITIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {!isReadOnly && (
          <Button onClick={() => openDialog()} className="gap-2">
            <Plus className="h-4 w-4" /> Add Risk
          </Button>
        )}
      </div>

      {/* Risk Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
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
                    className={sla === "breached" ? "bg-red-50/50 dark:bg-red-950/10" : ""}
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
                        <Badge variant="outline" className="text-[10px] mt-0.5">Auto</Badge>
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
                      {sla === "breached" && <Badge variant="destructive" className="text-[10px]">Breached</Badge>}
                      {sla === "warning" && <Badge className="bg-orange-100 text-orange-800 text-[10px]">Due soon</Badge>}
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
                        <span className="text-xs text-red-500 italic">Missing</span>
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
                              size="icon" variant="ghost" className="h-7 w-7 text-orange-600"
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
