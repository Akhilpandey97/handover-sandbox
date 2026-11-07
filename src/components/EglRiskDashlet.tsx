import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLabels } from "@/contexts/LabelsContext";
import { useEglRisk } from "@/hooks/useEglRisk";
import type { EglWindow } from "@/data/eglRisk";
import { GoLiveDate } from "./GoLiveDate";
import { AttentionReasonBlock } from "./AttentionReason";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import type { Project } from "@/data/projectsData";
import { openProjectInNewTab } from "@/lib/open-project";
import { formatCr, sumArrCrore } from "@/lib/arr";

const WINDOWS: { key: EglWindow; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

export const EglRiskDashlet = ({ projects }: { projects?: Project[] } = {}) => {
  const navigate = useNavigate();
  const { getLabel } = useLabels();
  const [window, setWindow] = useState<EglWindow>("month");
  const [showAi, setShowAi] = useState(false);
  const { rows } = useEglRisk(window, projects);

  const totalArr = sumArrCrore(rows.map((r) => r.project.arr));
  const totalMrr = totalArr / 12;

  return (
    <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Projects at Risk of Missing Go-Live
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
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowAi((v) => !v)}
            disabled={rows.length === 0}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {showAi ? "Hide AI" : "AI insights"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Flush with the card: the Table primitive draws its own
            rounded, bordered surface, which reads as a table inside a card. */}
        <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card table-header-tint">
            <TableRow className="hover:bg-muted/40 border-b">
              <TableHead className="font-semibold text-foreground">Project</TableHead>
              <TableHead className="font-semibold text-foreground whitespace-nowrap">
                {getLabel("field_expected_go_live_date")}
              </TableHead>
              <TableHead className="font-semibold text-foreground whitespace-nowrap">
                ARR / MRR
              </TableHead>
              <TableHead className="font-semibold text-foreground">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                  No projects need attention before go-live{" "}
                  {window === "week" ? "this week" : "this month"}.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ project, verdict }) => {
                const projectArr = sumArrCrore([project.arr]);
                const projectMrr = projectArr / 12;
                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openProjectInNewTab(project.id)}
                  >
                    <TableCell className="font-medium text-xs">{project.merchantName}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <GoLiveDate project={project} />
                      {verdict.daysRemaining < 0 && (
                        <span className="ml-1.5 text-xs font-medium text-destructive-strong">
                          {Math.abs(verdict.daysRemaining)}d late
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">{formatCr(projectArr)}</span>
                      <span className="ml-1 text-2xs">/ {formatCr(projectMrr)} MRR</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground align-top">
                      {showAi ? (
                        <AttentionReasonBlock
                          projectId={project.id}
                          kind="egl"
                          reasons={verdict.findings.map((f) => f.detail)}
                          enabled={showAi}
                          compact
                        />
                      ) : (
                        <p>{verdict.findings.map((f) => f.detail).join(" · ")}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {rows.length > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-2xs text-muted-foreground">
          <span className="font-medium text-foreground">{rows.length} projects</span>
          <span>·</span>
          <span>
            ARR <span className="font-medium text-foreground">{formatCr(totalArr)}</span>
          </span>
          <span>·</span>
          <span>
            MRR <span className="font-medium text-foreground">{formatCr(totalMrr)}</span>
          </span>
        </div>
      )}
    </section>
  );
};
