import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";
import { portalCaller, userCaller, unauthorized } from "@/lib/api-auth.server";
import { aiText, BUDDY_MODEL } from "@/lib/ai-gateway.server";
import Anthropic from "@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, merchant_name, faqs = [], token } = await req.json();

    // This assistant faces the merchant, so speaking as the wrong company is
    // the most visible leak of all. Resolve the tenant behind the portal token —
    // and refuse to answer at all without a valid one, so the AI budget is not
    // open to anonymous callers.
    const portal = await portalCaller(token);
    const signedIn = portal ? null : await userCaller(req);
    if (!portal && !signedIn) return unauthorized(corsHeaders);

    let tenantId: string | null = portal?.tenantId ?? signedIn?.tenantId ?? null;
    if (portal && !tenantId) {
      const { data: proj } = await adminClient()
        .from("projects")
        .select("tenant_id")
        .eq("id", portal.projectId)
        .maybeSingle();
      tenantId = (proj as { tenant_id: string | null } | null)?.tenant_id ?? null;
    }

    const { orgName } = await getTenantBranding(tenantId);

    const systemPrompt = `You are a helpful integration support assistant for ${orgName}'s merchants. The merchant name is "${merchant_name || "Unknown"}".

You help with:
- API integration questions (checkout, authentication, payments)
- Debugging common API errors (403, 401, checksum issues)
- Validator and configuration guidance
- Setup & configuration help
- OTP/SSO integration steps

Merchant-specific FAQ & Help content maintained by the CE team:
${Array.isArray(faqs) && faqs.length > 0 ? faqs.map((f: any, i: number) => `${i + 1}. Q: ${String(f.question || "").trim()}\nA: ${String(f.answer || "").trim()}`).join("\n\n") : "No merchant-specific FAQs are configured yet."}

Use the merchant-specific FAQ content first when it answers the question. Keep answers concise, practical, and developer-friendly. Use code examples when helpful. If unsure, recommend contacting the SE.`;

    const reply =
      (await aiText({ system: systemPrompt, messages, model: BUDDY_MODEL })) ||
      "Sorry, I couldn't process that.";

    return new Response(JSON.stringify({ reply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    // Keep the rate-limit and billing cases distinct, as the gateway used to.
    if (e instanceof Anthropic.RateLimitError) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return new Response(JSON.stringify({ error: "AI credentials rejected" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

export const Route = createFileRoute("/api/public/kwikassist-ai-chat")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      PATCH: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
