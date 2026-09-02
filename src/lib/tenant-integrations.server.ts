import { createClient } from "@supabase/supabase-js";

export interface TenantIntegrations {
  resend_api_key: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  google_mail_api_key: string | null;
  gmail_monitor_address: string | null;
  jira_base_url: string | null;
  jira_email: string | null;
  jira_api_token: string | null;
  jira_project_key: string | null;
  slack_webhook_url: string | null;
  slack_bot_token: string | null;
  slack_channel: string | null;
  app_base_url: string | null;
}

const EMPTY: TenantIntegrations = {
  resend_api_key: null,
  from_email: null,
  from_name: null,
  reply_to: null,
  google_mail_api_key: null,
  gmail_monitor_address: null,
  jira_base_url: null,
  jira_email: null,
  jira_api_token: null,
  jira_project_key: null,
  slack_webhook_url: null,
  slack_bot_token: null,
  slack_channel: null,
  app_base_url: null,
};

export const INTEGRATION_FIELDS = Object.keys(EMPTY) as (keyof TenantIntegrations)[];

export const SECRET_FIELDS: (keyof TenantIntegrations)[] = [
  "resend_api_key",
  "google_mail_api_key",
  "jira_api_token",
  "slack_bot_token",
  "slack_webhook_url",
];

function envFallbacks(): TenantIntegrations {
  return {
    ...EMPTY,
    resend_api_key: process.env["RESEND_API_KEY"] ?? null,
    google_mail_api_key: process.env["GOOGLE_MAIL_API_KEY"] ?? null,
    jira_base_url: process.env["JIRA_BASE_URL"] ?? null,
    jira_email: process.env["JIRA_EMAIL"] ?? null,
    jira_api_token: process.env["JIRA_API_TOKEN"] ?? null,
    jira_project_key: process.env["JIRA_PROJECT_KEY"] ?? null,
    slack_webhook_url: process.env["SLACK_WEBHOOK_URL"] ?? null,
    slack_bot_token: process.env["SLACK_BOT_TOKEN"] ?? null,
    app_base_url: process.env["APP_BASE_URL"] ?? process.env["APP_URL"] ?? null,
  };
}

export function adminClient() {
  return createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const cache = new Map<string, { at: number; value: TenantIntegrations }>();
const TTL_MS = 30_000;

/**
 * Resolve integration credentials for a tenant. Falls back to platform-level
 * environment variables when a tenant has not configured its own value.
 */
export async function getTenantIntegrations(
  tenantId: string | null | undefined,
): Promise<TenantIntegrations> {
  const fallback = envFallbacks();
  if (!tenantId) return fallback;

  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let row: Partial<TenantIntegrations> = {};
  try {
    const { data } = await adminClient()
      .from("tenant_integrations")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) row = data as Partial<TenantIntegrations>;
  } catch (err) {
    console.error("getTenantIntegrations failed:", (err as Error).message);
  }

  const merged = { ...fallback } as TenantIntegrations;
  for (const key of INTEGRATION_FIELDS) {
    const val = row[key];
    if (typeof val === "string" && val.trim() !== "") {
      (merged[key] as string) = val.trim();
    }
  }
  cache.set(tenantId, { at: Date.now(), value: merged });
  return merged;
}

export function invalidateTenantIntegrations(tenantId: string) {
  cache.delete(tenantId);
}

export class IntegrationNotConfiguredError extends Error {
  constructor(public integration: string) {
    super(
      `${integration} is not configured for this tenant. Ask an admin to add it under Settings → Integrations.`,
    );
  }
}

export function requireCred<K extends keyof TenantIntegrations>(
  creds: TenantIntegrations,
  key: K,
  label: string,
): string {
  const value = creds[key];
  if (!value) throw new IntegrationNotConfiguredError(label);
  return value;
}

/**
 * Best-effort resolution of the calling user's tenant from the request's
 * bearer token, with an optional explicit override (e.g. body.tenant_id).
 */
export async function tenantIdFromRequest(
  req: Request,
  explicit?: string | null,
): Promise<string | null> {
  if (explicit) return explicit;
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.split(".").length !== 3) return null;
  try {
    const admin = adminClient();
    const { data } = await admin.auth.getUser(token);
    const userId = data.user?.id;
    if (!userId) return null;
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    return (profile as { tenant_id: string | null } | null)?.tenant_id ?? null;
  } catch {
    return null;
  }
}
