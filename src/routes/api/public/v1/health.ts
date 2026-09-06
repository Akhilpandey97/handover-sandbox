import { createFileRoute } from "@tanstack/react-router";
import { apiCors, apiJson, authenticateApiKey } from "@/lib/api-keys.server";

async function handler({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: apiCors });
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);
  return apiJson({ ok: true, tenant_id: auth.tenantId, time: new Date().toISOString() });
}

export const Route = createFileRoute("/api/public/v1/health")({
  server: { handlers: { GET: handler, OPTIONS: handler } },
});
