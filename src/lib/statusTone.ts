/**
 * One status vocabulary for the whole app.
 *
 * Statuses used to be coloured by a private map in each component — parallel
 * definitions of the same idea, in raw palette values, each with its own
 * opacities and border treatment. Meanwhile the semantic success/warning/info/
 * destructive tokens (which have proper dark-mode values) went unused.
 *
 * Map a domain value to a tone here, and the treatment follows from the tokens.
 * Categorical colour — team identity, platform, chart series — is NOT a tone and
 * does not belong here.
 */

export type Tone = "success" | "warning" | "danger" | "info" | "pending" | "neutral";

/** Badge and pill treatment: tinted background, readable text, matching border. */
export const toneBadge: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  pending: "bg-pending/12 text-pending border-pending/25",
  neutral: "bg-muted text-muted-foreground border-border",
};

/** Solid treatment, for the few places that need emphasis over subtlety. */
export const toneSolid: Record<Tone, string> = {
  success: "bg-success text-success-foreground border-transparent",
  warning: "bg-warning text-warning-foreground border-transparent",
  danger: "bg-destructive text-destructive-foreground border-transparent",
  info: "bg-info text-info-foreground border-transparent",
  pending: "bg-pending text-pending-foreground border-transparent",
  neutral: "bg-muted text-muted-foreground border-transparent",
};

/** Text-only, for inline emphasis inside a row. */
export const toneText: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  pending: "text-pending",
  neutral: "text-muted-foreground",
};

/** Project state — the vocabulary most screens key off. */
export const projectStateTone: Record<string, Tone> = {
  live: "success",
  in_progress: "info",
  not_started: "neutral",
  on_hold: "warning",
  blocked: "danger",
};

/** Low / medium / high, used for priority and severity alike. */
export const priorityTone: Record<string, Tone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

/** Confidence that a date will hold. */
export const confidenceTone: Record<string, Tone> = {
  High: "success",
  Medium: "warning",
  Low: "danger",
};

export const toneFor = (
  value: string | null | undefined,
  map: Record<string, Tone>,
  fallback: Tone = "neutral",
): Tone => (value && map[value]) || fallback;
