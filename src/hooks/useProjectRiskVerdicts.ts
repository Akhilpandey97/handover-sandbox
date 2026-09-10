import { useMemo } from "react";
import type { Project } from "@/data/projectsData";
import { RiskInput, RiskRule, RiskVerdict, evaluateRisk, withManualRisks } from "@/data/riskRules";
import { useRiskRules } from "@/hooks/useRiskRules";
import { useLastChecklistActivity } from "@/hooks/useLastChecklistActivity";
import { useProjects } from "@/contexts/ProjectContext";
import { useProjectRisks } from "@/hooks/useProjectRisks";

/** Client adapter. The cron builds the same shape from raw rows server-side. */
export const projectToRiskInput = (
  project: Project,
  lastActivityAt: string | null | undefined,
): RiskInput => ({
  projectState: project.projectState,
  expectedGoLiveDate: project.dates?.expectedGoLiveDate ?? null,
  expectedGoLiveDateIsDerived: project.dates?.expectedGoLiveDateIsDerived,
  checklist: (project.checklist || []).map((c) => ({
    completed: !!c.completed,
    dueDate: c.dueDate ?? null,
    isTask: c.isTask,
  })),
  lastActivityAt: lastActivityAt ?? null,
  updatedAt: project.updatedAt ?? null,
  pendingAcceptance: project.pendingAcceptance,
  assignedOwner: project.assignedOwner ?? null,
});

export const evaluateProject = (
  project: Project,
  lastActivityAt: string | null | undefined,
  rules: RiskRule[],
): RiskVerdict => evaluateRisk(projectToRiskInput(project, lastActivityAt), rules);

/**
 * One verdict per project id, from the tenant's configured rules. Every screen
 * reads this so a project cannot say "low risk" in one place and appear on an
 * at-risk list in another.
 *
 * Sources the project list from context rather than taking it as an argument:
 * callers hold filtered arrays rebuilt on every render, and memoising on that
 * identity would re-evaluate every project on every keystroke.
 */
export const useProjectRiskVerdicts = () => {
  const { projects } = useProjects();
  const { rules, isLoading: rulesLoading } = useRiskRules();
  const { lastActivityByProject, isLoading: activityLoading } = useLastChecklistActivity();

  const verdicts = useMemo(() => {
    const map: Record<string, RiskVerdict> = {};
    for (const p of projects) {
      map[p.id] = evaluateProject(p, lastActivityByProject[p.id], rules);
    }
    return map;
  }, [projects, lastActivityByProject, rules]);

  return { verdicts, rules, isLoading: rulesLoading || activityLoading };
};
