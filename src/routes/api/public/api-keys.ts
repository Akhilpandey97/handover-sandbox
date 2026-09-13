import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { resolveUserScope } from "@/lib/api-auth.server";
import { apiCors, apiJson, generateApiKey, sha256Hex } from "@/lib/api-keys.server";

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: apiJson({ error: "Unauthorized" }, 401) };

  const admin = adminClient();
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData.user;
  if (!user) return { error: apiJson({ error: "Unauthorized" }, 401) };

  // Follows a support session into the customer's workspace, with the grant's role.
  const scope = await resolveUserScope(admin, user.id);
  const tenantId = scope.tenantId;
  if (!tenantId) return { error: apiJson({ error: "No workspace for this user" }, 403) };

  const isAdmin = scope.roles.some((r) => ["super_admin", "admin"].includes(r));
  if (!isAdmin) return { error: apiJson({ error: "Admins only" }, 403) };

  return { admin, tenantId, userId: user.id };
}

async function handler({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: apiCors });

  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const admin = auth.admin!;
  const tenantId = auth.tenantId!;

  try {
    if (request.method === "GET") {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, name, key_prefix, last_used_at, revoked_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return apiJson({ keys: data || [] });
    }

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { name?: string; id?: string; action?: string };

      if (body.action === "revoke") {
        if (!body.id) return apiJson({ error: "id is required" }, 400);
        const { error } = await admin
          .from("api_keys")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", body.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        return apiJson({ revoked: true });
      }

      const name = (body.name || "").trim();
      if (!name) return apiJson({ error: "name is required" }, 400);

      const key = generateApiKey();
      const { data, error } = await admin
        .from("api_keys")
        .insert({
          tenant_id: tenantId,
          name,
          key_prefix: key.slice(0, 16),
          key_hash: await sha256Hex(key),
          created_by: auth.userId,
        })
        .select("id, name, key_prefix, created_at")
        .single();
      if (error) throw error;

      // The full key is returned exactly once.
      return apiJson({ ...data, key });
    }

    return apiJson({ error: "Method not allowed" }, 405);
  } catch (err) {
    return apiJson({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/api-keys")({
  server: { handlers: { GET: handler, POST: handler, OPTIONS: handler } },
});
