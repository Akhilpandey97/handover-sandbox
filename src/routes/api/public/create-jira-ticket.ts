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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const summary = String(body['summary'] || "").trim();
    const description = String(body['description'] || "").trim();
    const issueType = String(body['issue_type'] || "Task").trim() || "Task";
    const priority = String(body['priority'] || "").trim();
    const projectKeyInput = String(body['project_key'] || "").trim();

    if (!summary) return json({ error: "Summary is required" }, 400);

    const creds = await getTenantIntegrations(
      await tenantIdFromRequest(req, body['tenant_id'] as string | undefined),
    );
    const baseUrl = (creds.jira_base_url || "").replace(/\/+$/, "");
    const email = creds.jira_email;
    const token = creds.jira_api_token;
    const projectKey = projectKeyInput || (creds as Record<string, any>)['jira_project_key'] || "";

    if (!baseUrl || !email || !token) {
      return json({ error: "Jira credentials are not configured for this workspace." }, 400);
    }
    if (!projectKey) {
      return json({ error: "No Jira project key. Set one in Settings → Integrations or enter it here." }, 400);
    }

    const auth = btoa(`${email}:${token}`);
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType },
    };
    if (description) {
      fields['description'] = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
      };
    }
    if (priority) fields['priority'] = { name: priority };

    const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("Jira create issue failed", res.status, text);
      return json({ error: `Jira error (${res.status}): ${text.slice(0, 500)}` }, 502);
    }

    const created = JSON.parse(text || "{}");
    return json({
      success: true,
      key: created.key,
      url: created.key ? `${baseUrl}/browse/${created.key}` : null,
    });
  } catch (err) {
    console.error("create-jira-ticket error:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/create-jira-ticket")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
