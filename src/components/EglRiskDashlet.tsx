import { useState } from "react";
import { tableHeaderClass, tableHeaderRowClass } from "@/components/TableSurface";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLabels } from "@/contexts/LabelsContext";
import { useEglRisk } from "@/hooks/useEglRisk";
import type { EglWindow } from "@/data/eglRisk";
import { GoLiveDate } from "./GoLiveDate";
import { cn } from "@/lib/utils";

const WINDOWS: { key: EglWindow; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

export const EglRiskDashlet = () => {
  const navigate = useNavigate();
  const { getLabel } = useLabels();
  const [window, setWindow] = useState<EglWindow>("month");
  const { rows } = useEglRisk(window);

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Projects at Risk of Missing EGL</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Go-live falls {window === "week" ? "this week" : "this month"} and the project is not on track
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindow(w.key)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  window === w.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          <CalendarClock className="h-5 w-5 text-primary" />
        </div>
      </div>

      <div className="max-h-[22rem] overflow-y-auto">
        <Table>
          <TableHeader className={cn("sticky top-0 z-10", tableHeaderClass)}>
            <TableRow className={tableHeaderRowClass}>
              <TableHead className="text-navy font-semibold">Project</TableHead>
              <TableHead className="text-navy font-semibold whitespace-nowrap">
                {getLabel("field_expected_go_live_date")}
              </TableHead>
              <TableHead className="text-navy font-semibold">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-sm">
                  No projects are at risk of missing their go-live {window === "week" ? "this week" : "this month"}.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ project, verdict }) => (
                <TableRow
                  key={project.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                >
                  <TableCell className="font-medium text-sm">{project.merchantName}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    <GoLiveDate project={project} />
                    {verdict.daysRemaining < 0 && (
                      <span className="ml-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                        {Math.abs(verdict.daysRemaining)}d late
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {verdict.findings.map((f) => f.detail).join(" · ")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
};
