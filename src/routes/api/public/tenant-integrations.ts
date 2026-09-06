import { createFileRoute } from "@tanstack/react-router";
import {
  adminClient,
  INTEGRATION_FIELDS,
  SECRET_FIELDS,
  invalidateTenantIntegrations,
  type TenantIntegrations,
} from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MASK = "••••••••";

async function authorize(req: Request): Promise<{
  error?: Response;
  admin?: ReturnType<typeof adminClient>;
  tenantId?: string;
}> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Unauthorized" }, 401) };

  const admin = adminClient();
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData.user;
  if (!user) return { error: json({ error: "Unauthorized" }, 401) };

  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
  if (!tenantId) return { error: json({ error: "No tenant for this user" }, 403) };

  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const isAdmin = (roles || []).some((r: { role: string }) =>
    ["super_admin", "admin"].includes(r.role),
  );
  if (!isAdmin) return { error: json({ error: "Admins only" }, 403) };

  return { admin, tenantId };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const admin = auth.admin!;
  const tenantId = auth.tenantId!;

  try {
    if (req.method === "GET") {
      const { data } = await admin
        .from("tenant_integrations")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const row = (data || {}) as Partial<TenantIntegrations>;
      const out: Record<string, string> = {};
      for (const field of INTEGRATION_FIELDS) {
        const value = row[field];
        if (SECRET_FIELDS.includes(field)) {
          out[field] = value ? MASK : "";
        } else {
          out[field] = (value as string) || "";
        }
      }
      return json({ settings: out, masked: SECRET_FIELDS });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const patch: Record<string, string | null> = {};
      for (const field of INTEGRATION_FIELDS) {
        if (!(field in body)) continue;
        const raw = body[field];
        if (typeof raw !== "string") continue;
        // Unchanged masked secrets are skipped so they are never overwritten.
        if (SECRET_FIELDS.includes(field) && raw === MASK) continue;
        patch[field] = raw.trim() === "" ? null : raw.trim();
      }
      if (Object.keys(patch).length === 0) return json({ success: true, updated: 0 });

      const { error } = await admin
        .from("tenant_integrations")
        .upsert({ tenant_id: tenantId, ...patch }, { onConflict: "tenant_id" });
      if (error) throw error;

      invalidateTenantIntegrations(tenantId);
      return json({ success: true, updated: Object.keys(patch).length });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("tenant-integrations error:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/tenant-integrations")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
