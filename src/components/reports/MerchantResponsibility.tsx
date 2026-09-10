import { useMemo, useState } from "react";
import { Project, calculateTimeByParty, calculateTimeFromChecklist, formatDuration } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Building2, Users, Sparkles, Loader2, Layers } from "lucide-react";

interface Props {
  projects: Project[];
}

export const MerchantResponsibility = ({ projects }: Props) => {
  const { responsibilityLabels, getLabel } = useLabels();
  const [expandedSection, setExpandedSection] = useState<string | null>("blocker");

  const blockerAnalysis = useMemo(() => {
    return projects.map(p => {
      const time = calculateTimeFromChecklist(p.checklist);
      const total = time.gokwik + time.merchant;
      return {
        id: p.id,
        name: p.merchantName,
        gokwikTime: time.gokwik,
        merchantTime: time.merchant,
        total,
        gokwikPct: total > 0 ? Math.round((time.gokwik / total) * 100) : 0,
        merchantPct: total > 0 ? Math.round((time.merchant / total) * 100) : 0,
        state: p.projectState,
      };
    }).filter(p => p.total > 0).sort((a, b) => b.merchantPct - a.merchantPct);
  }, [projects]);

  const totalGokwik = blockerAnalysis.reduce((s, p) => s + p.gokwikTime, 0);
  const totalMerchant = blockerAnalysis.reduce((s, p) => s + p.merchantTime, 0);
  const totalAll = totalGokwik + totalMerchant;

  const complexityMatrix = useMemo(() => {
    const matrix = new Map<string, { platform: string; intType: string; count: number; totalTime: number; avgGoLivePercent: number }>();

    projects.forEach(p => {
      const key = `${p.platform}|${p.integrationType}`;
      const time = calculateTimeFromChecklist(p.checklist);
      const totalMs = time.gokwik + time.merchant;
      const existing = matrix.get(key) || { platform: p.platform, intType: p.integrationType, count: 0, totalTime: 0, avgGoLivePercent: 0 };
      existing.count++;
      existing.totalTime += totalMs;
      existing.avgGoLivePercent += p.goLivePercent;
      matrix.set(key, existing);
    });

    return Array.from(matrix.values())
      .map(m => ({ ...m, avgTime: m.totalTime / m.count, avgGoLivePercent: Math.round(m.avgGoLivePercent / m.count) }))
      .sort((a, b) => b.avgTime - a.avgTime);
  }, [projects]);


  return (
    <div className="space-y-6">

      {/* Overall distribution */}
      {totalAll > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-6 mb-4">
              <div className="bg-gradient-to-br from-primary/10 to-blue-500/5 rounded-xl p-4 text-center">
                <Building2 className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-2xl font-bold text-primary">{formatDuration(totalGokwik)}</p>
                <p className="text-xs text-muted-foreground">{responsibilityLabels.gokwik} (Internal) — {Math.round((totalGokwik / totalAll) * 100)}%</p>
              </div>
              <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-xl p-4 text-center">
                <Users className="h-6 w-6 mx-auto text-amber-500 mb-2" />
                <p className="text-2xl font-bold text-amber-500">{formatDuration(totalMerchant)}</p>
                <p className="text-xs text-muted-foreground">{responsibilityLabels.merchant} (External) — {Math.round((totalMerchant / totalAll) * 100)}%</p>
              </div>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden">
              <div className="bg-primary transition-all" style={{ width: `${(totalGokwik / totalAll) * 100}%` }} />
              <div className="bg-amber-500 transition-all" style={{ width: `${(totalMerchant / totalAll) * 100}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-project Blocker Analysis */}
      <Collapsible open={expandedSection === "blocker"} onOpenChange={() => setExpandedSection(expandedSection === "blocker" ? null : "blocker")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-red-500" />
                  Blocker Analysis (Internal vs External)
                </CardTitle>
                {expandedSection === "blocker" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Per-project comparison of {responsibilityLabels.gokwik} vs {responsibilityLabels.merchant} time (from checklist items)</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{getLabel("field_merchant_name")}</TableHead>
                    <TableHead>{responsibilityLabels.gokwik} Time</TableHead>
                    <TableHead>{responsibilityLabels.merchant} Time</TableHead>
                    <TableHead>Distribution</TableHead>
                    <TableHead>Primary Blocker</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockerAnalysis.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-primary">{formatDuration(p.gokwikTime)}</TableCell>
                      <TableCell className="text-amber-500">{formatDuration(p.merchantTime)}</TableCell>
                      <TableCell>
                        <div className="flex h-2 w-24 rounded-full overflow-hidden">
                          <div className="bg-primary" style={{ width: `${p.gokwikPct}%` }} />
                          <div className="bg-amber-500" style={{ width: `${p.merchantPct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.merchantPct > 60 ? "destructive" : p.gokwikPct > 60 ? "secondary" : "outline"}>
                          {p.merchantPct > 60 ? responsibilityLabels.merchant : p.gokwikPct > 60 ? "Internal" : "Balanced"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Integration Complexity Matrix */}
      <Collapsible open={expandedSection === "complexity"} onOpenChange={() => setExpandedSection(expandedSection === "complexity" ? null : "complexity")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="portal-heading flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  {getLabel("field_integration_type")} Complexity Matrix
                </CardTitle>
                {expandedSection === "complexity" ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <CardDescription>Average completion time by {getLabel("field_platform")} × {getLabel("field_integration_type")} — set realistic expectations</CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{getLabel("field_platform")}</TableHead>
                    <TableHead>{getLabel("field_integration_type")}</TableHead>
                    <TableHead>Projects</TableHead>
                    <TableHead>Avg Time</TableHead>
                    <TableHead>Avg {getLabel("field_go_live_percent")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complexityMatrix.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{m.platform}</TableCell>
                      <TableCell>{m.intType}</TableCell>
                      <TableCell>{m.count}</TableCell>
                      <TableCell className="font-semibold">{formatDuration(m.avgTime)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={m.avgGoLivePercent} className="h-2 w-16" />
                          <span className="text-xs">{m.avgGoLivePercent}%</span>
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