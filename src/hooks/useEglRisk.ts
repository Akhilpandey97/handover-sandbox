import { useMemo } from "react";
import type { Project } from "@/data/projectsData";
import { EglRiskVerdict, EglWindow, evaluateEglRisk, isInWindow } from "@/data/eglRisk";
import { useProjects } from "@/contexts/ProjectContext";
import { useLastChecklistActivity } from "@/hooks/useLastChecklistActivity";
import { useEglRules } from "@/hooks/useEglRules";

export interface EglRiskRow {
  project: Project;
  verdict: EglRiskVerdict;
}

/**
 * Projects whose go-live falls in the given window and that look unlikely to
 * hit it, worst first. Sourced from context rather than a passed-in array so
 * the memo isn't invalidated by callers rebuilding a filtered list each render.
 */
export const useEglRisk = (window: EglWindow) => {
  const { projects } = useProjects();
  const { lastActivityByProject } = useLastChecklistActivity();
  const { rules } = useEglRules();

  const rows = useMemo<EglRiskRow[]>(() => {
    const now = new Date();
    return projects
      .filter((p) => !p.archived && isInWindow(p.dates?.expectedGoLiveDate, window, now))
      .map((p) => ({
        project: p,
        verdict: evaluateEglRisk({
          projectState: p.projectState,
          expectedGoLiveDate: p.dates?.expectedGoLiveDate ?? null,
          expectedGoLiveDateIsDerived: p.dates?.expectedGoLiveDateIsDerived,
          pendingAcceptance: p.pendingAcceptance,
          checklist: (p.checklist || []).map((c) => ({
            completed: !!c.completed,
            dueDate: c.dueDate ?? null,
            isTask: c.isTask,
          })),
          lastActivityAt: lastActivityByProject[p.id] ?? null,
          updatedAt: p.updatedAt ?? null,
          now,
        }, rules),
      }))
      .filter((r) => r.verdict.atRisk)
      // Soonest (and most overdue) first — that is the order to act in.
      .sort((a, b) => a.verdict.daysRemaining - b.verdict.daysRemaining);
  }, [projects, lastActivityByProject, rules, window]);

  return { rows };
};
