import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest } from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const tenantId = await tenantIdFromRequest(req, body['tenant_id'] as string | undefined);

    if (!tenantId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const creds = await getTenantIntegrations(tenantId);
    const baseUrl = (creds.jira_base_url || "").replace(/\/+$/, "");

    if (!baseUrl) {
      return json({ error: "Jira base URL is not configured. Go to Settings → Integrations." }, 400);
    }

    const projectKey = (creds.jira_project_key || "").trim();
    const merchantName = String(body['merchant_name'] || "").trim();

    const params = new URLSearchParams();
    if (projectKey) params.set("projectKey", projectKey);
    if (merchantName) params.set("summary", merchantName);

    const url = `${baseUrl}/secure/CreateIssue.jspa${params.toString() ? `?${params.toString()}` : ""}`;
    return json({ url });
  } catch (err) {
    console.error("jira-create-url error:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/jira-create-url")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
