import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, merchant_name, faqs = [] } = await req.json();
    const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are KwikAssist AI, a helpful integration support assistant for GoKwik merchants. The merchant name is "${merchant_name || "Unknown"}".

You help with:
- GoKwik API integration questions (checkout, KwikPass, KwikCOD)
- Debugging common API errors (403, 401, checksum issues)
- Merchant Validator guidance
- Setup & configuration help
- KwikPass OTP/SSO integration steps

Merchant-specific FAQ & Help content maintained by the CE team:
${Array.isArray(faqs) && faqs.length > 0 ? faqs.map((f: any, i: number) => `${i + 1}. Q: ${String(f.question || "").trim()}\nA: ${String(f.answer || "").trim()}`).join("\n\n") : "No merchant-specific FAQs are configured yet."}

Use the merchant-specific FAQ content first when it answers the question. Keep answers concise, practical, and developer-friendly. Use code examples when helpful. If unsure, recommend contacting the SE.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (res.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (res.status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`AI error: ${res.status}`);

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";

    return new Response(JSON.stringify({ reply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
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
