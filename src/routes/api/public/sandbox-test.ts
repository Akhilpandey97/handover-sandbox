import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'] || "";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { config, test } = await req.json();

    const prompt = `You are a GoKwik QA automation expert. Analyze whether the following test is likely to pass or fail based on the configuration provided.

Sandbox Configuration:
- Website: ${config.websiteUrl}
- Environment: ${config.environment}
- OTP Method: ${config.otpMethod}
- Merchant ID: ${config.merchantId || "not provided"}
- Context: ${config.additionalContext || "none"}

Test Case: ${test.testCase}
Category: ${test.category}
Steps: ${test.steps}
Expected Result: ${test.expectedResult}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "status": "pass" | "fail" | "skip",
  "notes": "brief 1-sentence observation about this test in this environment",
  "recommendation": "one actionable recommendation if fail/skip, else empty string"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Gateway error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "{}";

    // Extract JSON even if wrapped in markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sandbox test error:", error);
    return new Response(JSON.stringify({ 
      status: "skip", 
      notes: `Error: ${(error as Error).message}`, 
      recommendation: "" 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/sandbox-test")({
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
