import { adminClient } from "@/lib/tenant-integrations.server";
import { bearerToken, resolveUserScope } from "@/lib/api-auth.server";

/** Roles allowed to ask Buddy to change data. Checked on the server for every action. */
export const ACTION_ROLES = new Set(["manager", "admin", "super_admin", "superadmin"]);

/**
 * Roles whose dashboard shows the whole portfolio. Everyone else works from the
 * projects assigned to them, and Buddy must not widen that.
 */
export const PORTFOLIO_ROLES = new Set(["manager", "admin", "super_admin", "superadmin", "gokwik_general"]);

export type BuddyClient = ReturnType<typeof adminClient>;

export interface BuddyCaller {
  client: BuddyClient;
  userId: string;
  name: string;
  email: string;
  /** The workspace being worked in: the customer's during a support session. */
  tenantId: string;
  roles: string[];
  canAct: boolean;
  portfolio: boolean;
}

/**
 * Who is talking to Buddy, resolved entirely on the server from the bearer
 * token. Nothing the browser sends decides the workspace, the scope or whether
 * actions are allowed.
 */
export async function buddyCaller(req: Request): Promise<BuddyCaller | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const client = adminClient();
  const { data } = await client.auth.getUser(token);
  const user = data.user;
  if (!user) return null;

  const [scope, { data: profile }] = await Promise.all([
    resolveUserScope(client, user.id),
    client.from("profiles").select("name, email, team").eq("id", user.id).maybeSingle(),
  ]);
  if (!scope.tenantId) return null;

  const p = profile as { name?: string; email?: string; team?: string } | null;
  const roles = scope.roles.length ? scope.roles : p?.team ? [p.team] : [];

  return {
    client,
    userId: user.id,
    name: p?.name || user.email || "Someone",
    email: p?.email || user.email || "",
    tenantId: scope.tenantId,
    roles,
    canAct: roles.some((r) => ACTION_ROLES.has(r)),
    portfolio: roles.some((r) => PORTFOLIO_ROLES.has(r)),
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Human labels for the values Buddy shows people. Database values never reach the UI. */
export const STATE_LABELS: Record<string, string> = {
  not_started: "Not started",
  on_hold: "On hold",
  in_progress: "In progress",
  live: "Live",
  blocked: "Blocked",
};

export const PHASE_LABELS: Record<string, string> = {
  mint: "Sales",
  integration: "Integration",
  ms: "Merchant Success",
  completed: "Completed",
};

export const RESPONSIBILITY_LABELS: Record<string, string> = {
  gokwik: "Internal team",
  merchant: "Merchant",
  neutral: "Neutral",
};

export const todayIso = () => new Date().toISOString().slice(0, 10);
