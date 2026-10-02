/**
 * Opening a project leaves the list where it was.
 *
 * People work a list — kanban, the table, the go-live tracker — and dip into projects one
 * after another. Navigating in place lost their scroll position and filters every time, so
 * a project opens in its own tab and the list stays put behind it.
 */
export type ProjectOrigin = "kanban" | "list" | "go-live";

export function projectHref(projectId: string, from?: ProjectOrigin): string {
  return `/projects/${projectId}${from ? `?from=${from}` : ""}`;
}

export function openProjectInNewTab(projectId: string, from?: ProjectOrigin): void {
  if (typeof window === "undefined") return;
  window.open(projectHref(projectId, from), "_blank", "noopener,noreferrer");
}
