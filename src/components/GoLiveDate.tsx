import { cn } from "@/lib/utils";
import type { Project } from "@/data/projectsData";

/**
 * Renders a project's expected go-live date, marking the ones the app inferred
 * rather than a person committing to.
 *
 * When no date is set, useProjects falls back to the latest checklist due date.
 * That is a useful guess but not a commitment, and nothing on screen used to say
 * which was which. The marker is deliberately quiet — a dotted underline and a
 * tooltip, no badge or colour.
 */
/**
 * String form, for the places that build plain-text rows rather than JSX.
 * Same intent as the component, minus the tooltip.
 */
export const formatGoLiveDate = (
  project: Pick<Project, "dates">,
  format?: (value: string) => string,
  fallback = "—",
): string => {
  const value = project.dates?.expectedGoLiveDate;
  if (!value) return fallback;
  const text = format ? format(value) : value;
  return project.dates?.expectedGoLiveDateIsDerived ? `${text} (est.)` : text;
};

export const GoLiveDate = ({
  project,
  format,
  fallback = "—",
  className,
}: {
  project: Pick<Project, "dates">;
  /** Optional formatter; the raw stored string is used otherwise. */
  format?: (value: string) => string;
  fallback?: string;
  className?: string;
}) => {
  const value = project.dates?.expectedGoLiveDate;
  if (!value) return <span className={className}>{fallback}</span>;

  const text = format ? format(value) : value;
  if (!project.dates?.expectedGoLiveDateIsDerived) return <span className={className}>{text}</span>;

  return (
    <span
      className={cn("underline decoration-dotted decoration-muted-foreground/50 underline-offset-2", className)}
      title="Estimated from the latest checklist due date — no go-live date has been set on this project"
    >
      {text}
    </span>
  );
};
