import { createClient } from "@supabase/supabase-js";

/**
 * Shared authentication for the `/api/public/*` routes.
 *
 * These routes are reachable without the site's own auth wrapper, so every
 * handler that touches tenant data, tenant credentials, paid AI capacity or
 * outbound email must identify its caller here first.
 */

export type CallerKind = "cron" | "user" | "api_key" | "portal";

export interface Caller {
  kind: CallerKind;
  userId: string | null;
  tenantId: string | null;
  roles: string[];
  isAdmin: boolean;
}

const ADMIN_ROLES = ["admin", "super_admin", "superadmin", "manager"];

function admin() {
  return createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function bearerToken(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function isJwt(token: string) {
  return token.split(".").length === 3;
}

/** The shared secret used by the scheduler and by internal job fan-out. */
export function cronTokenFromRequest(req: Request): string {
  const url = (() => {
    try {
      return new URL(req.url);
    } catch {
      return null;
    }
  })();
  const bearer = bearerToken(req);
  return (
    req.headers.get("x-cron-token") ||
    req.headers.get("x-cron-secret") ||
    url?.searchParams.get("token") ||
    (bearer && !isJwt(bearer) && !bearer.startsWith("hk_live_") ? bearer : "") ||
    ""
  );
}

export async function isCronCaller(req: Request): Promise<boolean> {
  const provided = cronTokenFromRequest(req);
  if (!provided) return false;

  const envToken = process.env["LOVABLE_CRON_SECRET"];
  if (envToken && provided === envToken) return true;

  try {
    const { data } = await admin().rpc("cron_token_matches", { _token: provided });
    return data === true;
  } catch {
    return false;
  }
}

/** Resolve a signed-in user from the request's bearer JWT. */
export async function userCaller(req: Request): Promise<Caller | null> {
  const token = bearerToken(req);
  if (!token || !isJwt(token)) return null;

  try {
    const client = admin();
    const { data } = await client.auth.getUser(token);
    const user = data.user;
    if (!user) return null;

    const [{ data: profile }, { data: roleRows }] = await Promise.all([
      client.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle(),
      client.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const roles = ((roleRows || []) as { role: string }[]).map((r) => r.role);
    return {
      kind: "user",
      userId: user.id,
      tenantId: (profile as { tenant_id: string | null } | null)?.tenant_id ?? null,
      roles,
      isAdmin: roles.some((r) => ADMIN_ROLES.includes(r)),
    };
  } catch {
    return null;
  }
}

/** Resolve a tenant from a CRM API key (`hk_live_…`). */
export async function apiKeyCaller(req: Request): Promise<Caller | null> {
  const raw = bearerToken(req);
  if (!raw.startsWith("hk_live_")) return null;

  try {
    const bytes = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data } = await admin()
      .from("api_keys")
      .select("id, tenant_id, revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();
    const row = data as { tenant_id: string; revoked_at: string | null } | null;
    if (!row || row.revoked_at) return null;

    return { kind: "api_key", userId: null, tenantId: row.tenant_id, roles: [], isAdmin: false };
  } catch {
    return null;
  }
}

/**
 * Resolve an active merchant portal token to its project's tenant. Used by the
 * merchant-facing endpoints, which have no signed-in user.
 */
export async function portalCaller(
  token: string | null | undefined,
): Promise<(Caller & { projectId: string }) | null> {
  if (!token) return null;
  try {
    const { data } = await admin()
      .from("merchant_portal_tokens")
      .select("project_id, tenant_id, is_active, expires_at")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();
    const row = data as
      | { project_id: string; tenant_id: string | null; expires_at: string | null }
      | null;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return {
      kind: "portal",
      userId: null,
      tenantId: row.tenant_id,
      roles: [],
      isAdmin: false,
      projectId: row.project_id,
    };
  } catch {
    return null;
  }
}

/** Any verified caller: scheduler, signed-in user, or tenant API key. */
export async function authenticateRequest(req: Request): Promise<Caller | null> {
  if (await isCronCaller(req)) {
    return { kind: "cron", userId: null, tenantId: null, roles: [], isAdmin: true };
  }
  return (await userCaller(req)) ?? (await apiKeyCaller(req));
}

export function unauthorized(cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/**
 * Guard helper: returns a 401 Response when the caller cannot be verified.
 *
 * ```ts
 * const denied = await requireCaller(req, corsHeaders);
 * if (denied) return denied;
 * ```
 */
export async function requireCaller(
  req: Request,
  cors: Record<string, string> = {},
): Promise<Response | null> {
  const caller = await authenticateRequest(req);
  return caller ? null : unauthorized(cors);
}

/** Guard for internal jobs: only the scheduler or a signed-in user may run them. */
export async function requireInternalCaller(
  req: Request,
  cors: Record<string, string> = {},
): Promise<Response | null> {
  if (await isCronCaller(req)) return null;
  const user = await userCaller(req);
  return user ? null : unauthorized(cors);
}
