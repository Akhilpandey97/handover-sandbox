import React, { useMemo } from "react";
import { Project } from "@/data/projectsData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Timer } from "lucide-react";

const diffDays = (from: string, to: string) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
};

interface Props { projects: Project[] }

export const TATDashlet = ({ projects }: Props) => {
  const rows = useMemo(() => {
    return projects
      .filter(p => p.dates?.kickOffDate && p.dates?.goLiveDate)
      .map(p => ({ id: p.id, merchant: p.merchantName, arr: p.arr || 0, kick: p.dates.kickOffDate!, live: p.dates.goLiveDate!, tat: diffDays(p.dates.kickOffDate!, p.dates.goLiveDate!) }))
      .sort((a, b) => b.tat - a.tat);
  }, [projects]);

  const overall = useMemo(() => {
    const n = rows.length;
    return {
      count: n,
      totalArr: rows.reduce((s, r) => s + (r.arr || 0), 0),
      avgTat: n ? rows.reduce((s, r) => s + r.tat, 0) / n : 0,
    };
  }, [rows]);

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="border-b bg-muted/10">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="h-4 w-4 text-muted-foreground" />
              TAT Summary
            </CardTitle>
            <CardDescription className="text-xs">Turn-around time summary for live merchants</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Merchants</div>
              <div className="text-lg font-semibold">{overall.count}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total ARR (Cr)</div>
              <div className="text-lg font-semibold">{overall.totalArr.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Avg TAT (days)</div>
              <div className="text-lg font-semibold">{overall.avgTat.toFixed(1)}</div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No projects with both Kickoff and Actual Go-Live dates.</div>
        ) : (
          <div className="space-y-1 p-3">
            {rows.slice(0, 8).map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{r.merchant}</div>
                  <div className="text-xs text-muted-foreground">ARR: {r.arr.toFixed(2)} Cr</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{r.tat}d</div>
                  <Badge variant="outline" className="text-[10px]">TAT</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TATDashlet;
