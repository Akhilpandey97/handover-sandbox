/**
 * Forward-looking Expected Go-Live risk.
 *
 * Deliberately a different question from riskRules.ts. That engine asks "is this
 * project in trouble now?" and its golive_missed rule only fires once the date
 * has passed. This asks "will this upcoming date hold?" — it looks at projects
 * whose go-live falls inside the current week or month and judges whether the
 * remaining work, the project's state and its recent momentum are consistent
 * with hitting it.
 *
 * Pure module, no React, no Supabase.
 */

export type EglWindow = "week" | "month";

/** No checklist comment in this many days reads as stalled. */
const STALL_DAYS = 5;

export interface EglRiskInput {
  projectState: string;
  expectedGoLiveDate?: string | null;
  expectedGoLiveDateIsDerived?: boolean;
  pendingAcceptance?: boolean;
  checklist: { completed: boolean; dueDate?: string | null; isTask?: boolean }[];
  /** Latest checklist comment; null means never commented on. */
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  now?: Date;
}

export interface EglRiskFinding {
  ruleId: string;
  detail: string;
}

export interface EglRiskVerdict {
  atRisk: boolean;
  findings: EglRiskFinding[];
  /** Negative once the date has passed. */
  daysRemaining: number;
}

const startOfDayUtc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDayUtc(to) - startOfDayUtc(from)) / 86_400_000);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Monday-to-Sunday week, or calendar month, containing `now`. */
export const windowBounds = (window: EglWindow, now: Date): { start: Date; end: Date } => {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (window === "month") {
    return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 0)) };
  }
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(y, m, d - daysSinceMonday));
  return { start, end: new Date(Date.UTC(y, m, d - daysSinceMonday + 6)) };
};

/** Weekdays remaining between now and the go-live date, floored at zero. */
const workingDaysUntil = (from: Date, to: Date): number => {
  let count = 0;
  const cursor = new Date(startOfDayUtc(from));
  const target = startOfDayUtc(to);
  while (startOfDayUtc(cursor) < target) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

/** Projects that already shipped can't miss a date. */
export const isEglExempt = (projectState: string): boolean =>
  projectState === "live" || projectState === "completed";

/** True when the go-live date falls inside the given window. */
export const isInWindow = (
  expectedGoLiveDate: string | null | undefined,
  window: EglWindow,
  now: Date,
): boolean => {
  const egl = parseDate(expectedGoLiveDate);
  if (!egl) return false;
  const { start, end } = windowBounds(window, now);
  const day = startOfDayUtc(egl);
  return day >= startOfDayUtc(start) && day <= startOfDayUtc(end);
};

export const evaluateEglRisk = (input: EglRiskInput): EglRiskVerdict => {
  const now = input.now ?? new Date();
  const findings: EglRiskFinding[] = [];
  const egl = parseDate(input.expectedGoLiveDate);
  const daysRemaining = egl ? daysBetween(now, egl) : 0;

  if (!egl || isEglExempt(input.projectState)) {
    return { atRisk: false, findings, daysRemaining };
  }

  const openItems = input.checklist.filter((c) => !c.isTask && !c.completed);

  // The date itself has already slipped.
  if (daysRemaining < 0) {
    findings.push({
      ruleId: "golive_passed",
      detail: `Go-live was ${plural(Math.abs(daysRemaining), "day")} ago and the project is not live`,
    });
  }

  if (input.projectState === "blocked" || input.projectState === "on_hold") {
    const state = input.projectState.replace(/_/g, " ");
    findings.push({
      ruleId: "state",
      detail: daysRemaining >= 0
        ? `Project is ${state} with ${plural(daysRemaining, "day")} to go-live`
        : `Project is ${state}`,
    });
  }

  if (input.pendingAcceptance) {
    findings.push({ ruleId: "pending_acceptance", detail: "Handover has not been accepted yet" });
  }

  // Behind its own plan.
  const overdue = openItems.filter((c) => {
    const due = parseDate(c.dueDate);
    return due !== null && daysBetween(now, due) < 0;
  });
  if (overdue.length > 0) {
    findings.push({
      ruleId: "checklist_overdue",
      detail: `${plural(overdue.length, "checklist item")} already past due`,
    });
  }

  // Its own plan finishes after the go-live date.
  const dueAfterEgl = openItems.filter((c) => {
    const due = parseDate(c.dueDate);
    return due !== null && daysBetween(egl, due) > 0;
  });
  if (dueAfterEgl.length > 0) {
    findings.push({
      ruleId: "work_after_golive",
      detail: `${plural(dueAfterEgl.length, "checklist item")} due after the go-live date`,
    });
  }

  // More open work than working days left to do it in.
  if (daysRemaining >= 0 && openItems.length > 0) {
    const workingDays = workingDaysUntil(now, egl);
    if (openItems.length > workingDays) {
      findings.push({
        ruleId: "work_remaining",
        detail: `${plural(openItems.length, "item")} still open with ${plural(workingDays, "working day")} left`,
      });
    }
  }

  // Momentum. No comments at all falls back to the project's own timestamp so a
  // brand new project isn't flagged for silence it hasn't had time to break.
  const lastTouch = parseDate(input.lastActivityAt ?? input.updatedAt);
  if (lastTouch) {
    const silentFor = Math.abs(daysBetween(lastTouch, now));
    if (silentFor >= STALL_DAYS) {
      findings.push({
        ruleId: "stalled",
        detail: input.lastActivityAt
          ? `No checklist comments for ${plural(silentFor, "day")}`
          : `Nothing has changed for ${plural(silentFor, "day")}`,
      });
    }
  }

  return { atRisk: findings.length > 0, findings, daysRemaining };
};

export const describeEglRisk = (verdict: EglRiskVerdict): string =>
  verdict.findings.map((f) => f.detail).join("; ");
