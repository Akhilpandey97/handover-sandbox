import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { apiCors, apiJson, authenticateApiKey } from "@/lib/api-keys.server";

async function handler({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: apiCors });
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);

  const { data, error } = await adminClient()
    .from("profiles")
    .select("id, name, email, team")
    .eq("tenant_id", auth.tenantId)
    .order("name");
  if (error) return apiJson({ error: error.message }, 500);
  return apiJson({ users: data || [] });
}

export const Route = createFileRoute("/api/public/v1/users")({
  server: { handlers: { GET: handler, OPTIONS: handler } },
});
