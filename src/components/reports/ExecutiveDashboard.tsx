import { useMemo, useState } from "react";
import { Project, calculateTimeByParty, formatDuration, projectStateLabels, ProjectState } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, TrendingUp, BarChart3, Rocket, DollarSign, Sparkles, Loader2 } from "lucide-react";
import { fetchAiInsights } from "@/utils/aiInsights";

interface Props {
  projects: Project[];
}

const phaseOrder = ["mint", "integration", "ms", "completed"];

export const ExecutiveDashboard = ({ projects }: Props) => {
  const { phaseLabels, getLabel } = useLabels();
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>("revenue");

  // Revenue Realization Forecast
  const revenueForecast = useMemo(() => {
    const nonLive = projects.filter(p => p.projectState !== "live" && p.dates.expectedGoLiveDate);
    const byMonth = new Map<string, { month: string; totalArr: number; count: number; projects: { name: string; arr: number; state: ProjectState; expectedDate: string }[] }>();

    nonLive.forEach(p => {
      const date = new Date(p.dates.expectedGoLiveDate!);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const existing = byMonth.get(monthKey) || { month: label, totalArr: 0, count: 0, projects: [] };
      existing.totalArr += p.arr;
      existing.count++;
      existing.projects.push({ name: p.merchantName, arr: p.arr, state: p.projectState, expectedDate: p.dates.expectedGoLiveDate! });
      byMonth.set(monthKey, existing);
    });

    return Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [projects]);

  const totalPipelineArr = revenueForecast.reduce((s, m) => s + m.totalArr, 0);

  // Pipeline Funnel
  const pipelineFunnel = useMemo(() => {
    return phaseOrder.map(phase => {
      const count = projects.filter(p => p.currentPhase === phase).length;
      return { phase, label: phaseLabels[phase] || phase, count };
    });
  }, [projects, phaseLabels]);

  const maxFunnelCount = Math.max(...pipelineFunnel.map(f => f.count), 1);

  // Go-Live Velocity
  const goLiveVelocity = useMemo(() => {
    const months = new Map<string, { month: string; goLive: number; kickOffs: number }>();

    projects.forEach(p => {
      const koDate = new Date(p.dates.kickOffDate);
      const koKey = `${koDate.getFullYear()}-${String(koDate.getMonth() + 1).padStart(2, "0")}`;
      const koLabel = koDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const koEntry = months.get(koKey) || { month: koLabel, goLive: 0, kickOffs: 0 };
      koEntry.kickOffs++;
      months.set(koKey, koEntry);

      if (p.dates.goLiveDate) {
        const glDate = new Date(p.dates.goLiveDate);
        const glKey = `${glDate.getFullYear()}-${String(glDate.getMonth() + 1).padStart(2, "0")}`;
        const glLabel = glDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        const glEntry = months.get(glKey) || { month: glLabel, goLive: 0, kickOffs: 0 };
        glEntry.goLive++;
        months.set(glKey, glEntry);
      }
    });

    return Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([, v]) => v);
  }, [projects]);

  const fetchAiInsight = async () => {
    setAiLoading(true);
    try {
      const result = await fetchAiInsights({
        type: "insights",
        project: {
          merchantName: `Executive Summary: ${projects.length} projects, ${totalPipelineArr.toFixed(2)} Cr pipeline ${getLabel("field_arr")}, Funnel: ${pipelineFunnel.map(f => `${f.label}: ${f.count}`).join(", ")}`,
          mid: "ALL",
          currentPhase: "overview",
          projectState: "overview",
          arr: totalPipelineArr,
          platform: "All",
          dates: { kickOffDate: "N/A" },
          currentOwnerTeam: "All",
          currentResponsibility: "N/A",
          checklist: [],
          transferHistory: [],
        },
      });
      setAiInsight(result);
    } catch {
      setAiInsight("Failed to generate AI insights.");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Insights */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="portal-heading flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Executive Insights
            </CardTitle>
            <Button size="sm" variant="outline" onClick={fetchAiInsight} disabled={aiLoading} className="gap-2">
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {aiInsight ? "Refresh" : "Generate"}
            </Button>
          </div>
        </CardHeader>
        {aiInsight && (
          <CardContent className="pt-0">
            <div className="text-sm space-y-1 whitespace-pre-line">{aiInsight}</div>
          </CardContent>
        )}
      </Card>

      {/* Revenue Realization Forecast */}
      <Collapsible open={expandedSection === "revenue"} onOpenChange={() => setExpandedSection(expandedSection === "revenue" ? null : "revenue")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                  Revenue Realization Forecast
                  <Badge variant="secondary">{totalPipelineArr.toFixed(2)} Cr in pipeline</Badge>
                </CardTitle>
                {expandedSection === "revenue" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Potential {getLabel("field_arr")} sorted by {getLabel("field_expected_go_live_date")} ({getLabel("field_kick_off_date")} = Start Date)</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {revenueForecast.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No projects with expected go-live dates in pipeline.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead>Projects</TableHead>
                      <TableHead>Pipeline {getLabel("field_arr")} (Cr)</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueForecast.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell>{row.count}</TableCell>
                        <TableCell className="font-semibold text-emerald-600">{row.totalArr.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.projects.map((p, j) => (
                              <Badge key={j} variant="outline" className="text-xs">
                                {p.name} ({p.arr} Cr)
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Pipeline Funnel */}
      <Collapsible open={expandedSection === "funnel"} onOpenChange={() => setExpandedSection(expandedSection === "funnel" ? null : "funnel")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  Project Pipeline Funnel
                </CardTitle>
                {expandedSection === "funnel" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Count of projects in each phase — identify macro-level bottlenecks</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <div className="space-y-4">
                {pipelineFunnel.map((stage) => (
                  <div key={stage.phase} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{stage.label}</span>
                      <span className="font-bold">{stage.count}</span>
                    </div>
                    <div className="h-8 bg-muted rounded-lg overflow-hidden relative">
                      <div
                        className="h-full rounded-lg transition-all bg-gradient-to-r from-primary/80 to-primary flex items-center justify-end pr-2"
                        style={{ width: `${Math.max((stage.count / maxFunnelCount) * 100, 5)}%` }}
                      >
                        <span className="text-xs text-white font-bold">{stage.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Go-Live Velocity */}
      <Collapsible open={expandedSection === "velocity"} onOpenChange={() => setExpandedSection(expandedSection === "velocity" ? null : "velocity")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-amber-500" />
                  Go-Live Velocity
                </CardTitle>
                {expandedSection === "velocity" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Projects going Live per month vs. new {getLabel("field_kick_off_date")}s</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {goLiveVelocity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead>New {getLabel("field_kick_off_date")}s</TableHead>
                      <TableHead>Go-Live</TableHead>
                      <TableHead>Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goLiveVelocity.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell>{row.kickOffs}</TableCell>
                        <TableCell className="text-emerald-600 font-semibold">{row.goLive}</TableCell>
                        <TableCell>
                          <Badge variant={row.goLive >= row.kickOffs ? "default" : "destructive"} className="text-xs">
                            {row.goLive >= row.kickOffs ? "+" : ""}{row.goLive - row.kickOffs}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
};