import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { calculateTimeFromChecklist, formatDuration, projectStateLabels } from "@/data/projectsData";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationCenter } from "./NotificationCenter";
import {
  BarChart3,
  LogOut,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  ListChecks,
  Rocket,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TaskStats {
  open: number;
  in_progress: number;
  completed: number;
  total: number;
}

export const SalesDashboard = () => {
  const { currentUser, logout } = useAuth();
  const { projects, isLoading } = useProjects();
  const { labels: appLabels, teamLabels, stateLabels } = useLabels();
  const [taskStats, setTaskStats] = useState<TaskStats>({ open: 0, in_progress: 0, completed: 0, total: 0 });
  const [tasksLoading, setTasksLoading] = useState(true);

  // Fetch task stats
  useEffect(() => {
    const fetchTasks = async () => {
      setTasksLoading(true);
      try {
        const { data, error } = await supabase
          .from("checklist_tasks")
          .select("status");
        if (!error && data) {
          const open = data.filter(t => t.status === "open").length;
          const inProgress = data.filter(t => t.status === "in_progress").length;
          const completed = data.filter(t => t.status === "completed").length;
          setTaskStats({ open, in_progress: inProgress, completed, total: data.length });
        }
      } catch {
        // ignore
      } finally {
        setTasksLoading(false);
      }
    };
    fetchTasks();
  }, []);

  if (!currentUser) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const activeP = projects.filter(p => !p.archived);
  const totalProjects = activeP.length;
  const liveProjects = activeP.filter(p => p.projectState === "live").length;
  const activeProjects = activeP.filter(p => p.projectState === "in_progress").length;
  const blockedProjects = activeP.filter(p => p.projectState === "blocked").length;
  const totalArr = activeP.reduce((s, p) => s + p.arr, 0);
  const liveArr = activeP.filter(p => p.projectState === "live").reduce((s, p) => s + p.arr, 0);

  let totalGokwikTime = 0;
  let totalMerchantTime = 0;
  activeP.forEach(p => {
    const time = calculateTimeFromChecklist(p.checklist);
    totalGokwikTime += time.gokwik;
    totalMerchantTime += time.merchant;
  });

  const taskPercent = taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shadow-lg">
              <BarChart3 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-foreground">Sales Dashboard</h1>
              <p className="text-xs text-muted-foreground">Welcome, {currentUser.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationCenter />
              <ThemeToggle />
            <Button variant="outline" size="sm" onClick={logout} className="gap-2">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-lg border-border/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total ARR</span>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">₹{(totalArr / 100000).toFixed(1)}L</p>
              <p className="text-xs text-muted-foreground mt-1">{totalProjects} projects</p>
            </CardContent>
          </Card>
          <Card className="shadow-lg border-border/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live ARR</span>
                <Rocket className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold text-emerald-600">₹{(liveArr / 100000).toFixed(1)}L</p>
              <p className="text-xs text-muted-foreground mt-1">{liveProjects} live</p>
            </CardContent>
          </Card>
          <Card className="shadow-lg border-border/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-foreground">{activeProjects}</p>
              <p className="text-xs text-muted-foreground mt-1">{blockedProjects} blocked</p>
            </CardContent>
          </Card>
          <Card className="shadow-lg border-border/50">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Progress</span>
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">{totalProjects > 0 ? Math.round((liveProjects / totalProjects) * 100) : 0}%</p>
              <Progress value={totalProjects > 0 ? (liveProjects / totalProjects) * 100 : 0} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
        </div>

        {/* Task Status Widget + Time Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="shadow-lg border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="portal-heading flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-primary" />
                Task Status
              </CardTitle>
              <CardDescription>Overview of all checklist tasks across projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {tasksLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Completion</span>
                    <span className="text-sm font-semibold">{taskPercent}%</span>
                  </div>
                  <Progress value={taskPercent} className="h-2" />
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <p className="text-2xl font-bold text-amber-600">{taskStats.open}</p>
                      <p className="text-xs text-amber-600/80 font-medium mt-1">Pending</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                      <p className="text-2xl font-bold text-blue-600">{taskStats.in_progress}</p>
                      <p className="text-xs text-blue-600/80 font-medium mt-1">In Progress</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-2xl font-bold text-emerald-600">{taskStats.completed}</p>
                      <p className="text-xs text-emerald-600/80 font-medium mt-1">Completed</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="portal-heading flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Time Distribution
              </CardTitle>
              <CardDescription>Internal vs External time across all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Internal Time</span>
                    <span className="font-medium">{formatDuration(totalGokwikTime)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${totalGokwikTime + totalMerchantTime > 0 ? (totalGokwikTime / (totalGokwikTime + totalMerchantTime)) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">External Time</span>
                    <span className="font-medium">{formatDuration(totalMerchantTime)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${totalGokwikTime + totalMerchantTime > 0 ? (totalMerchantTime / (totalGokwikTime + totalMerchantTime)) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Time</span>
                  <span className="font-semibold">{formatDuration(totalGokwikTime + totalMerchantTime)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Project State Breakdown */}
        <Card className="shadow-lg border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="portal-heading flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              Project State Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(["not_started", "in_progress", "on_hold", "blocked", "live"] as const).map(state => {
                const count = projects.filter(p => p.projectState === state).length;
                const stateColors: Record<string, string> = {
                  not_started: "bg-muted text-muted-foreground",
                  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
                  on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
                  blocked: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
                  live: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
                };
                return (
                  <div key={state} className={cn("rounded-lg p-4 text-center", stateColors[state])}>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs font-medium mt-1">{stateLabels[state] || projectStateLabels[state]}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};
