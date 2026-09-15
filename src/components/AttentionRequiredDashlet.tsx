import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { GoLiveDate } from "./GoLiveDate";
import { AttentionReasonBlock } from "./AttentionReason";
import { Button } from "@/components/ui/button";
import type { Project } from "@/data/projectsData";


/**
 * Project health from the Risk Rules engine — the same verdict behind the risk
 * badges, listed with its reasons so a manager can act without opening each
 * project. Distinct from the EGL dashlet, which asks whether an upcoming
 * go-live date will hold.
 */
export const AttentionRequiredDashlet = ({ projects: projectsOverride }: { projects?: Project[] } = {}) => {
  const navigate = useNavigate();
  const [showAi, setShowAi] = useState(false);
  const { getLabel } = useLabels();
  const { projects: allProjects } = useProjects();
  const projects = projectsOverride ?? allProjects;
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
    <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Projects Needing Attention
            {rows.length > 0 && (
              <span className="ml-2 rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-semibold text-destructive-strong">
                {rows.length}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
            <TableRow className="hover:bg-navy/5 border-b">
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
                  <TableCell className="text-xs text-muted-foreground align-top">
                    {/* The AI explanation replaces the rule reason rather than
                        stacking on top of it — it already restates the reason. */}
                    {showAi ? (
                      <AttentionReasonBlock
                        projectId={project.id}
                        kind="risk"
                        reasons={verdict.findings.map((f) => f.detail)}
                        enabled={showAi}
                        compact
                      />
                    ) : (
                      <p>{verdict.findings.map((f) => f.detail).join(" · ")}</p>
                    )}
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
