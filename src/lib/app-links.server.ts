import type { TenantIntegrations } from "./tenant-integrations.server";

type BaseUrlSource = Pick<TenantIntegrations, "app_base_url">;

/**
 * Resolved per tenant by getTenantIntegrations(), which already falls back to
 * APP_BASE_URL then APP_URL. This is the only place emails should get a host.
 */
export const appBaseUrl = (creds: BaseUrlSource): string | null => {
  const raw = creds.app_base_url?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
};

export interface ProjectLinkTarget {
  tab?: "checklists" | "activity" | "jira";
  /** checklist item id */
  item?: string | null;
  /** task id, opens that item's task dialog */
  task?: string | null;
  /** comment id, expands that item's comment thread */
  comment?: string | null;
}

/** Canonical link to a project workspace, optionally deep-linked to one row. */
export const projectUrl = (
  creds: BaseUrlSource,
  projectId: string | null | undefined,
  target: ProjectLinkTarget = {},
): string | null => {
  const base = appBaseUrl(creds);
  if (!base || !projectId) return null;

  const params = new URLSearchParams();
  if (target.tab) params.set("tab", target.tab);
  if (target.item) params.set("item", target.item);
  if (target.task) params.set("task", target.task);
  if (target.comment) params.set("comment", target.comment);

  const qs = params.toString();
  return `${base}/projects/${projectId}${qs ? `?${qs}` : ""}`;
};

export const portalUrl = (creds: BaseUrlSource, token: string, magicLink = false): string | null => {
  const base = appBaseUrl(creds);
  if (!base) return null;
  return `${base}/portal?token=${encodeURIComponent(token)}${magicLink ? "&ml=1" : ""}`;
};

export const brdUrl = (creds: BaseUrlSource, token: string): string | null => {
  const base = appBaseUrl(creds);
  if (!base) return null;
  return `${base}/brd?token=${encodeURIComponent(token)}`;
};
