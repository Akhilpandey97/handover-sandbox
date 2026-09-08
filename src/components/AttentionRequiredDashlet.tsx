import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProjects } from "@/contexts/ProjectContext";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { GoLiveDate } from "./GoLiveDate";
import { AttentionReasonPopover } from "./AttentionReason";


/**
 * Project health from the Risk Rules engine — the same verdict behind the risk
 * badges, listed with its reasons so a manager can act without opening each
 * project. Distinct from the EGL dashlet, which asks whether an upcoming
 * go-live date will hold.
 */
export const AttentionRequiredDashlet = () => {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const { verdicts } = useProjectRiskVerdicts();

  const rows = useMemo(
    () =>
      projects
        .filter((p) => !p.archived && verdicts[p.id]?.level === "high")
        .map((p) => ({ project: p, verdict: verdicts[p.id]! }))
        .sort((a, b) => b.verdict.score - a.verdict.score),
    [projects, verdicts],
  );

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Attention Required
            {rows.length > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                {rows.length}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Projects needing attention — from Settings → Risk Rules
          </p>
        </div>
        <AlertTriangle className="h-5 w-5 text-primary shrink-0" />
      </div>

      <div className="max-h-[22rem] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-navy/5 z-10">
            <TableRow className="hover:bg-navy/5 border-b">
              <TableHead className="text-navy font-semibold">Project</TableHead>
              <TableHead className="text-navy font-semibold whitespace-nowrap">Go-Live</TableHead>
              <TableHead className="text-navy font-semibold">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-sm">
                  No projects need attention right now.
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
                  <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                    <GoLiveDate project={project} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <AttentionReasonPopover
                      projectId={project.id}
                      kind="risk"
                      reasons={verdict.findings.map((f) => f.detail)}
                      title="Why this needs attention"
                    >
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="text-left hover:text-foreground underline decoration-dotted underline-offset-2"
                      >
                        {verdict.findings.map((f) => f.detail).join(" · ")}
                      </button>
                    </AttentionReasonPopover>
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
