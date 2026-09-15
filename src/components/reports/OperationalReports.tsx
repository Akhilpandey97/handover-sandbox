import { useMemo, useState } from "react";
import { Project, calculateTimeByParty, formatDuration, projectStateLabels } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Clock, AlertTriangle, Users } from "lucide-react";

interface Props {
  projects: Project[];
}

export const OperationalReports = ({ projects }: Props) => {
  const { teamLabels, getLabel, stateLabels } = useLabels();
  const [expandedSection, setExpandedSection] = useState<string | null>("stage");

  // Stage Duration Analysis
  const stageDuration = useMemo(() => {
    const stageMap = new Map<string, { title: string; phase: string; totalTime: number; count: number }>();

    projects.forEach(p => {
      p.checklist.forEach(item => {
        const time = calculateTimeByParty(item.responsibilityLog);
        const totalMs = time.gokwik + time.merchant;
        if (totalMs > 0) {
          const key = `${item.phase}|${item.title}`;
          const existing = stageMap.get(key) || { title: item.title, phase: item.phase, totalTime: 0, count: 0 };
          existing.totalTime += totalMs;
          existing.count++;
          stageMap.set(key, existing);
        }
      });
    });

    return Array.from(stageMap.values())
      .map(s => ({ ...s, avgTime: s.totalTime / s.count }))
      .sort((a, b) => b.avgTime - a.avgTime);
  }, [projects]);

  // Aging Report
  const agingReport = useMemo(() => {
    const now = Date.now();
    return projects
      .filter(p => p.projectState !== "live" && p.currentPhase !== "completed")
      .map(p => {
        const kickOff = new Date(p.dates.kickOffDate).getTime();
        const daysSinceStart = Math.floor((now - kickOff) / (1000 * 60 * 60 * 24));
        return { ...p, daysSinceStart };
      })
      .sort((a, b) => b.daysSinceStart - a.daysSinceStart);
  }, [projects]);

  // Resource Load
  const resourceLoad = useMemo(() => {
    const ownerMap = new Map<string, {
      name: string; team: string; activeCount: number; totalArr: number;
      projects: { name: string; arr: number; state: string }[];
    }>();

    projects.filter(p => p.projectState !== "live" && p.currentPhase !== "completed").forEach(p => {
      const key = p.assignedOwner || "unassigned";
      const name = p.assignedOwnerName || "Unassigned";
      const existing = ownerMap.get(key) || { name, team: p.currentOwnerTeam, activeCount: 0, totalArr: 0, projects: [] };
      existing.activeCount++;
      existing.totalArr += p.arr;
      existing.projects.push({ name: p.merchantName, arr: p.arr, state: p.projectState });
      ownerMap.set(key, existing);
    });

    return Array.from(ownerMap.values()).sort((a, b) => b.activeCount - a.activeCount);
  }, [projects]);


  return (
    <div className="space-y-6">

      {/* Stage Duration Analysis */}
      <Collapsible open={expandedSection === "stage"} onOpenChange={() => setExpandedSection(expandedSection === "stage" ? null : "stage")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <Clock className="h-4 w-4 text-info-strong" />
                  Stage Duration Analysis (Bottleneck Detector)
                </CardTitle>
                {expandedSection === "stage" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Average time spent in each sub-stage across all projects</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {stageDuration.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No time data available yet.</p>
              ) : (
                <div className="space-y-3">
                  {stageDuration.map((stage, i) => {
                    const maxTime = stageDuration[0]?.avgTime || 1;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{stage.title}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground">{stage.count} projects</span>
                            <span className="font-semibold">{formatDuration(stage.avgTime)}</span>
                          </div>
                        </div>
                        <Progress value={(stage.avgTime / maxTime) * 100} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Aging Report */}
      <Collapsible open={expandedSection === "aging"} onOpenChange={() => setExpandedSection(expandedSection === "aging" ? null : "aging")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-strong" />
                  Aging Report (Stalled Projects)
                  {agingReport.filter(p => p.daysSinceStart > 60).length > 0 && (
                    <Badge variant="destructive" className="text-xs">{agingReport.filter(p => p.daysSinceStart > 60).length} zombie</Badge>
                  )}
                </CardTitle>
                {expandedSection === "aging" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Projects sorted by days since {getLabel("field_kick_off_date")} — highlights zombie projects</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {agingReport.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">All projects are live or completed!</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{getLabel("field_merchant_name")}</TableHead>
                      <TableHead>{getLabel("field_kick_off_date")}</TableHead>
                      <TableHead>Days Since Start</TableHead>
                      <TableHead>Current Team</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>{getLabel("field_assigned_owner")}</TableHead>
                      <TableHead>{getLabel("field_arr")} (Cr)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agingReport.map(p => (
                      <TableRow key={p.id} className={p.daysSinceStart > 90 ? "bg-destructive-soft" : p.daysSinceStart > 60 ? "bg-warning-soft" : ""}>
                        <TableCell className="font-medium">{p.merchantName}</TableCell>
                        <TableCell>{p.dates.kickOffDate}</TableCell>
                        <TableCell>
                          <Badge variant={p.daysSinceStart > 90 ? "destructive" : p.daysSinceStart > 60 ? "secondary" : "outline"}>
                            {p.daysSinceStart}d
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant="outline">{teamLabels[p.currentOwnerTeam] || p.currentOwnerTeam}</Badge></TableCell>
                        <TableCell className="capitalize">{stateLabels[p.projectState] || projectStateLabels[p.projectState]}</TableCell>
                        <TableCell>{p.assignedOwnerName || "Unassigned"}</TableCell>
                        <TableCell>{p.arr}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Resource Load */}
      <Collapsible open={expandedSection === "resource"} onOpenChange={() => setExpandedSection(expandedSection === "resource" ? null : "resource")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-500" />
                  Resource Load / Team Capacity
                </CardTitle>
                {expandedSection === "resource" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Active projects per owner — prevents burnout and ensures balanced distribution</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{getLabel("field_assigned_owner")}</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Active Projects</TableHead>
                    <TableHead>Total {getLabel("field_arr")} (Cr)</TableHead>
                    <TableHead>Projects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resourceLoad.map((r, i) => (
                    <TableRow key={i} className={r.activeCount > 5 ? "bg-warning-soft" : ""}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell><Badge variant="outline">{teamLabels[r.team] || r.team}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={r.activeCount > 5 ? "destructive" : "secondary"}>{r.activeCount}</Badge>
                      </TableCell>
                      <TableCell>{r.totalArr.toFixed(2)}</TableCell>
                      <TableCell className="max-w-[250px]">
                        <div className="flex flex-wrap gap-1">
                          {r.projects.map((p, j) => (
                            <Badge key={j} variant="outline" className="text-xs">{p.name}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
};