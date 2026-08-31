import type { Project } from "@/data/projectsData";

export type FunnelMatchType = "project_state" | "all_completed" | "any_completed" | "none_completed";

export interface FunnelStageRule {
  id: string;
  label: string;
  matchType: FunnelMatchType;
  /** used when matchType === "project_state" */
  projectStates?: string[];
  /** checklist item titles (case-insensitive "contains" match) */
  titles?: string[];
}

export const FUNNEL_MATCH_LABELS: Record<FunnelMatchType, string> = {
  project_state: "Project state is one of",
  all_completed: "All these checklist items are completed",
  any_completed: "Any of these checklist items is completed",
  none_completed: "None of these checklist items are completed",
};

export const FUNNEL_SETTINGS_KEY = "funnel_stages_config";

export const DEFAULT_FUNNEL_STAGES: FunnelStageRule[] = [
  {
    id: "live",
    label: "Live",
    matchType: "project_state",
    projectStates: ["live"],
  },
  {
    id: "under_integration",
    label: "Under Integration",
    matchType: "all_completed",
    titles: [
      "requirement gathering",
      "api walkthrough",
      "api build & sdk integration",
      "api validation",
    ],
  },
  {
    id: "pre_integration",
    label: "Pre Integration",
    matchType: "all_completed",
    titles: ["feasibility analysis"],
  },
  {
    id: "sales",
    label: "Sales",
    matchType: "none_completed",
    titles: [
      "feasibility analysis",
      "pg onboarding",
      "requirement gathering",
      "api walkthrough",
      "api build & sdk integration",
      "api validation",
      "under integration",
      "sandbox testing",
      "production testing",
      "dashboard walkthrough",
      "go-live",
    ],
  },
];

const titleCompleted = (project: Project, needle: string) => {
  const items = project.checklist.filter((c) => !c.isTask);
  const item = items.find((i) => i.title.toLowerCase().includes(needle.toLowerCase()));
  return !!item && !!item.completed;
};

export const matchesFunnelRule = (project: Project, rule: FunnelStageRule): boolean => {
  const titles = rule.titles || [];
  switch (rule.matchType) {
    case "project_state":
      return (rule.projectStates || []).includes(project.projectState as string);
    case "all_completed":
      return titles.length > 0 && titles.every((t) => titleCompleted(project, t));
    case "any_completed":
      return titles.some((t) => titleCompleted(project, t));
    case "none_completed":
      return !titles.some((t) => titleCompleted(project, t));
    default:
      return false;
  }
};

/** Evaluates rules in order; first match wins. Returns "none" when nothing matches. */
export const resolveFunnelStage = (
  project: Project,
  stages: FunnelStageRule[] = DEFAULT_FUNNEL_STAGES,
): string => {
  const match = stages.find((s) => matchesFunnelRule(project, s));
  return match ? match.id : "none";
};

export const parseFunnelStages = (raw: string | null | undefined): FunnelStageRule[] => {
  if (!raw) return DEFAULT_FUNNEL_STAGES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as FunnelStageRule[];
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_FUNNEL_STAGES;
};

/**
 * Runtime registry so the (non-hook) helpers in projectsData.ts can resolve
 * stages using the tenant's configuration. Populated by useFunnelConfig().
 */
let ACTIVE_STAGES: FunnelStageRule[] = DEFAULT_FUNNEL_STAGES;

export const setActiveFunnelStages = (stages: FunnelStageRule[]) => {
  if (Array.isArray(stages) && stages.length > 0) ACTIVE_STAGES = stages;
};

export const getActiveFunnelStages = (): FunnelStageRule[] => ACTIVE_STAGES;
