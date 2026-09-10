/**
 * Tenant-configurable risk rules.
 *
 * Pure module — no React, no Supabase — because the cron evaluates the same
 * rules server-side. It deliberately takes a narrow RiskInput rather than a
 * Project so server routes don't have to import the client transform layer.
 *
 * There is no module-level "active rules" registry (unlike funnelConfig): the
 * cron loops tenants in one process, so shared module state would leak one
 * tenant's rules into another. Callers always pass rules explicitly.
 */

export type RiskRuleType =
  | "checklist_overdue"
  | "golive_missed"
  | "no_activity"
  | "project_state"
  | "pending_acceptance"
  | "unassigned_owner";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface RiskRule {
  /** Immutable once created — it is persisted as project_risks.trigger_rule. */
  id: string;
  /** Display only; renaming must never change `id`. */
  label: string;
  type: RiskRuleType;
  enabled: boolean;
  /** Grace period for the date rules; threshold for no_activity. */
  days?: number;
  /** Which project states count, for project_state rules. */
  states?: string[];
  severity: RiskSeverity;
}

export const RISK_SETTINGS_KEY = "risk_rules_config";

export const RISK_RULE_TYPE_LABELS: Record<RiskRuleType, string> = {
  checklist_overdue: "A checklist item is past its due date",
  golive_missed: "The expected go-live date has passed",
  no_activity: "No checklist comments for N days",
  project_state: "Project state is one of",
  pending_acceptance: "A handover is waiting to be accepted",
  unassigned_owner: "No owner is assigned",
};

export const DEFAULT_RISK_RULES: RiskRule[] = [
  { id: "checklist_overdue", label: "Checklist date missed", type: "checklist_overdue", enabled: true, days: 0, severity: "high" },
  { id: "golive_missed", label: "Go-live date missed", type: "golive_missed", enabled: true, days: 0, severity: "critical" },
  { id: "no_activity", label: "No activity", type: "no_activity", enabled: true, days: 3, severity: "medium" },
  { id: "blocked", label: "Project blocked", type: "project_state", enabled: true, states: ["blocked"], severity: "high" },
  { id: "pending_acceptance", label: "Handover not accepted", type: "pending_acceptance", enabled: true, severity: "medium" },
  { id: "unassigned_owner", label: "Owner not assigned", type: "unassigned_owner", enabled: true, severity: "medium" },
];

export interface RiskInput {
  projectState: string;
  expectedGoLiveDate?: string | null;
  /**
   * useProjects derives expectedGoLiveDate from the latest checklist due date
   * when unset, so a derived date would make golive_missed restate whatever
   * checklist_overdue already said.
   */
  expectedGoLiveDateIsDerived?: boolean;
  checklist: { completed: boolean; dueDate?: string | null; isTask?: boolean }[];
  /** Latest checklist comment; null means no comments ever, not "stale forever". */
  lastActivityAt?: string | null;
  /** Fallback freshness signal when a project has no comments at all. */
  updatedAt?: string | null;
  /** A transfer nobody has picked up yet. */
  pendingAcceptance?: boolean;
  assignedOwner?: string | null;
  now?: Date;
}

export interface RiskFinding {
  ruleId: string;
  label: string;
  /** "manual_risk" covers risks a person logged on the Risks tab. */
  type: RiskRuleType | "manual_risk";
  severity: RiskSeverity;
  /** Human-readable reason, safe to show without AI. */
  detail: string;
  /** Days overdue / days silent, for cache bucketing and sorting. */
  magnitude?: number;
}

export interface RiskVerdict {
  level: "high" | "low";
  score: number;
  findings: RiskFinding[];
}

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  low: 15,
  medium: 30,
  high: 45,
  critical: 60,
};

const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days elapsed since `value`; null when unparseable. */
const daysSince = (value: string | null | undefined, now: Date): number | null => {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((startOfDay(now) - startOfDay(then)) / 86_400_000);
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Projects that have shipped are not "at risk" — matches the previous behaviour. */
export const isRiskExempt = (projectState: string): boolean =>
  projectState === "live" || projectState === "completed";

export const evaluateRisk = (input: RiskInput, rules: RiskRule[]): RiskVerdict => {
  const now = input.now ?? new Date();
  const findings: RiskFinding[] = [];

  if (isRiskExempt(input.projectState)) return { level: "low", score: 0, findings };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const grace = rule.days ?? 0;

    if (rule.type === "checklist_overdue") {
      let worst: number | null = null;
      for (const item of input.checklist) {
        if (item.completed || !item.dueDate) continue;
        const overdue = daysSince(item.dueDate, now);
        if (overdue !== null && overdue > grace && (worst === null || overdue > worst)) worst = overdue;
      }
      if (worst !== null) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: `A checklist item is ${plural(worst, "day")} past its due date`,
          magnitude: worst,
        });
      }
      continue;
    }

    if (rule.type === "golive_missed") {
      if (input.expectedGoLiveDateIsDerived) continue;
      const overdue = daysSince(input.expectedGoLiveDate, now);
      if (overdue !== null && overdue > grace) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: `Expected go-live was ${plural(overdue, "day")} ago`,
          magnitude: overdue,
        });
      }
      continue;
    }

    if (rule.type === "no_activity") {
      const threshold = rule.days ?? 3;
      // No comments ever is no signal, not infinite staleness — fall back to the
      // project row's own timestamp so a fresh project isn't flagged on day one.
      const silent = daysSince(input.lastActivityAt ?? input.updatedAt, now);
      if (silent !== null && silent >= threshold) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: input.lastActivityAt
            ? `No checklist comments for ${plural(silent, "day")}`
            : `No checklist comments, and nothing changed for ${plural(silent, "day")}`,
          magnitude: silent,
        });
      }
      continue;
    }

    if (rule.type === "pending_acceptance") {
      if (input.pendingAcceptance) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: "Handover has not been accepted",
        });
      }
      continue;
    }

    if (rule.type === "unassigned_owner") {
      if (!input.assignedOwner) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: "No owner is assigned",
        });
      }
      continue;
    }

    if (rule.type === "project_state") {
      if ((rule.states || []).includes(input.projectState)) {
        findings.push({
          ruleId: rule.id, label: rule.label, type: rule.type, severity: rule.severity,
          detail: `Project state is ${input.projectState.replace(/_/g, " ")}`,
        });
      }
    }
  }

  const score = Math.min(100, findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0));
  return { level: findings.length > 0 ? "high" : "low", score, findings };
};

/**
 * Folds manually logged risks into a rule-based verdict, so a hand-entered risk
 * makes a project High Risk everywhere exactly like a rule match does.
 */
export const withManualRisks = (
  verdict: RiskVerdict,
  manual: { id: string; title: string; severity: string }[],
): RiskVerdict => {
  if (manual.length === 0) return verdict;
  const findings: RiskFinding[] = [
    ...verdict.findings,
    ...manual.map((m) => ({
      ruleId: `manual:${m.id}`,
      label: "Manually logged risk",
      type: "manual_risk" as const,
      severity: (["low", "medium", "high", "critical"].includes(m.severity)
        ? m.severity
        : "medium") as RiskSeverity,
      detail: m.title,
    })),
  ];
  const score = Math.min(100, findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0));
  return { level: "high", score, findings };
};

/** One-line deterministic reason, shown whether or not AI is available. */
export const describeVerdict = (verdict: RiskVerdict): string =>
  verdict.findings.map((f) => f.detail).join("; ");

/**
 * Cache key for AI explanations. Magnitudes are bucketed so a project doesn't
 * invalidate its explanation every single day.
 */
export const findingsHash = (verdict: RiskVerdict): string => {
  const bucket = (n?: number) => (n === undefined ? "" : n <= 1 ? "1" : n <= 3 ? "3" : n <= 7 ? "7" : n <= 14 ? "14" : "30+");
  return [
    verdict.level,
    ...verdict.findings.map((f) => `${f.ruleId}:${bucket(f.magnitude)}`).sort(),
  ].join("|");
};

export const parseRiskRules = (raw: string | null | undefined): RiskRule[] => {
  if (!raw) return DEFAULT_RISK_RULES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as RiskRule[];
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_RISK_RULES;
};

/** Ids must be stable for the lifetime of a rule — never derive one from a label. */
export const newRiskRuleId = (): string =>
  `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
