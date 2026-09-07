import { createFileRoute } from "@tanstack/react-router";

// AI Project Insights Edge Function
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { project, projects, type } = body;

    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error("LOVABLE_API_KEY not set");

    // Movement report summarizer (Daily/Weekly): classify and 2-line summary per project
    if (type === "movement_summary" && Array.isArray(body.items)) {
      const items = body.items as Array<{
        id: string;
        merchantName: string;
        funnel: string;
        projectState: string;
        arr: string;
        egl: string;
        bucket?: "wins" | "updates" | "lowlights";
        entries: Array<{ ts: string; category: string; description: string }>;
      }>;
      const timeframe = body.timeframe || "weekly";

      const systemPrompt = `You are a project status analyst for GoKwik's merchant integration team. You receive recent project activity (MINT notes, checklist updates, comments, state/phase changes) over the last ${timeframe === "daily" ? "24 hours" : "7 days"} for multiple merchants.

The bucket (wins/updates/lowlights) has ALREADY been deterministically classified for you — do NOT re-classify. Just echo back the provided bucket and write the 2-line prose summary.

For EACH merchant, produce:
1. "bucket": echo the bucket value provided in the input (do not change it).
2. "line1": ONE sentence describing the current state / what happened this period (project-context only — no names of who did what).
3. "line2": ONE sentence on what is next OR what is blocking (with ETA/owner if known).

Rules:
- Be specific and substantive. Mention actual things: APIs, sandbox, PG, UI customization, dashboards, etc. NEVER write generic phrases like "work is ongoing".
- Do NOT mention user names, "updated by", "commented by" — just the project context.
- If the bucket is "lowlights" and there is no activity, line1 should say "No activity recorded this period." and line2 should suggest a nudge or escalation.
- Keep each line under 160 characters.

Return ONLY a JSON object via the tool call.`;

      const userContent = items.map((it) => {
        const entriesTxt = (it.entries || []).slice(0, 25)
          .map(e => `- [${e.category}] ${e.description}`).join("\n") || "- (no activity captured)";
        return `### ${it.merchantName} (id:${it.id}) [bucket:${it.bucket || "updates"}]
Funnel: ${it.funnel} | State: ${it.projectState} | ARR: ${it.arr} | EGL: ${it.egl}
Recent activity:
${entriesTxt}`;
      }).join("\n\n");

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          tools: [{
            type: "function",
            function: {
              name: "submit_movement_summary",
              description: "Return per-project bucket and 2-line summary",
              parameters: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        bucket: { type: "string", enum: ["wins", "updates", "lowlights"] },
                        line1: { type: "string" },
                        line2: { type: "string" },
                      },
                      required: ["id", "bucket", "line1", "line2"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["results"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_movement_summary" } },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      let results: any[] = [];
      if (toolCall?.function?.arguments) {
        try { results = (JSON.parse(toolCall.function.arguments).results) || []; } catch { results = []; }
      }
      return new Response(JSON.stringify({ result: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // Risk explanations. The rule engine has already decided high/low; the model
    // only writes prose, exactly as movement_summary does.
    if (type === "risk_explanation" && Array.isArray(body.items)) {
      const items = body.items as Array<{
        id: string;
        merchantName: string;
        projectState: string;
        funnel?: string;
        reasons: string[];
      }>;

      const systemPrompt = `You are an onboarding delivery analyst for a merchant integration team. Each merchant below has ALREADY been deterministically flagged as at risk by a rule engine, and the exact reasons are given to you. Do NOT re-assess whether the project is at risk, and do NOT invent reasons that are not listed.

For EACH merchant, produce:
1. "why": ONE sentence explaining, in plain business language, what the listed reasons mean for this merchant's go-live. Reference the concrete numbers you are given.
2. "recommendation": ONE sentence naming the single most useful next action, and who should take it. Be specific and practical — no generic advice like "monitor closely".`;

      const userContent = items
        .map((it) =>
          `Merchant: ${it.merchantName}\nState: ${it.projectState}${it.funnel ? `\nStage: ${it.funnel}` : ""}\nRisk reasons:\n${it.reasons.map((r) => `- ${r}`).join("\n")}\nid: ${it.id}`,
        )
        .join("\n\n");

      // cron.ts calls jobs sequentially per tenant, so a hung gateway call would
      // stall the whole loop and risk the platform function timeout.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let response: Response;
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            tools: [{
              type: "function",
              function: {
                name: "submit_risk_explanations",
                description: "Return one explanation and recommendation per merchant",
                parameters: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          why: { type: "string" },
                          recommendation: { type: "string" },
                        },
                        required: ["id", "why", "recommendation"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["results"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "submit_risk_explanations" } },
          }),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      let results: Array<{ id: string; why: string; recommendation: string }> = [];
      if (toolCall?.function?.arguments) {
        try { results = JSON.parse(toolCall.function.arguments).results || []; } catch { results = []; }
      }
      // Match by id and drop anything unrecognised — the model occasionally
      // returns fewer items than asked, so index alignment would mis-attribute.
      const known = new Set(items.map((i) => i.id));
      results = results.filter((r) => r && known.has(r.id) && r.why && r.recommendation);

      return new Response(JSON.stringify({ result: results, model: "google/gemini-2.5-flash" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Email context: generate summary, test cases, and go-live checklist context from email threads
    if (type === "email_context") {
      const { project_id, tenant_id, threads } = body;

      const supabase = createClient(
        process.env['SUPABASE_URL']!,
        process.env['SUPABASE_SERVICE_ROLE_KEY']!
      );

      // Fetch project details for context
      const { data: project } = await supabase
        .from("projects")
        .select("merchant_name, mid, platform, current_phase, project_notes")
        .eq("id", project_id)
        .single();

      const threadsSummary = (threads || []).map((t: any, i: number) =>
        `Thread ${i + 1}: "${t.subject}" | Date: ${t.threadDate?.split("T")[0] || "unknown"} | Messages: ${t.messageCount} | Participants: ${(t.participants || []).slice(0, 4).join(", ")} | Preview: ${t.snippet}`
      ).join("\n");

      // Also pull cached Jira tickets for this project to enrich action items
      const { data: jiraRows } = await supabase
        .from("project_jira_tickets")
        .select("jira_key, summary, status, status_category, priority, assignee_name, due_date, updated")
        .eq("project_id", project_id)
        .order("updated", { ascending: false, nullsFirst: false })
        .limit(30);

      const openJira = (jiraRows || []).filter((j: any) => (j.status_category || "").toLowerCase() !== "done");
      const jiraSummary = openJira.length
        ? openJira.map((j: any, i: number) =>
            `${i + 1}. [${j.jira_key}] ${j.summary || ""} | Status: ${j.status || "?"} | Priority: ${j.priority || "?"} | Assignee: ${j.assignee_name || "Unassigned"}${j.due_date ? ` | Due: ${j.due_date}` : ""}`
          ).join("\n")
        : "No open Jira tickets.";

      const systemPrompt = `You are a technical project management AI for an e-commerce payment integration company (GoKwik). Given email threads and Jira tickets for a merchant integration project, extract concrete pending ACTION ITEMS that the team or merchant must complete to move the project forward.

Return ONLY valid JSON in this exact format:
{
  "summary": "2-3 sentence summary of where the project stands based on emails + Jira",
  "action_items": [
    {
      "title": "Short imperative action (e.g. 'Share production API keys')",
      "description": "1-2 sentence detail explaining what needs to be done and why",
      "owner": "GoKwik" | "Merchant" | "Unknown",
      "priority": "high" | "medium" | "low",
      "source": "email" | "jira" | "both",
      "reference": "Optional: Jira key or short email subject this came from"
    }
  ],
  "test_cases": [{"title": "Test case title", "description": "What to test and expected outcome"}],
  "checklist_context": "Go-live readiness insights — what is pending, what has been confirmed, any blockers"
}

Rules:
- Only include items that are still PENDING (not already done/resolved).
- De-duplicate similar items across emails and Jira.
- Prefer concrete, verb-led actions over vague observations.
- If nothing is pending, return an empty action_items array.`;

      const userContent = `Project: ${project?.merchant_name || "Unknown"} (MID: ${project?.mid || "N/A"})
Platform: ${project?.platform || "N/A"} | Phase: ${project?.current_phase || "N/A"}

Email threads (${(threads || []).length} total):
${threadsSummary || "No threads available."}

Open Jira tickets (${openJira.length} of ${(jiraRows || []).length} total):
${jiraSummary}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let parsed: any = { summary: "", test_cases: [], checklist_context: "", action_items: [] };
      try { parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : parsed; } catch { /* use defaults */ }

      // Upsert into project_email_context (one row per project)
      await supabase.from("project_email_context").upsert({
        project_id,
        tenant_id,
        summary: parsed.summary || "",
        test_cases: Array.isArray(parsed.test_cases) ? parsed.test_cases : [],
        checklist_context: parsed.checklist_context || "",
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
        generated_at: new Date().toISOString(),
        email_count: (threads || []).length,
      }, { onConflict: "project_id" });

      return new Response(JSON.stringify({ result: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI-powered email field mapping
    if (type === "map_email_fields") {
      const { emailFields, projectFields } = body;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You map email fields to project fields. Return ONLY a JSON object whose keys are the email field IDs (field_0, field_1, ...) and values are the best matching project field key from the provided list. Use "skip" only if truly no field matches. No prose, no markdown, no code fences.`,
            },
            {
              role: "user",
              content: `EMAIL FIELDS:\n${emailFields}\n\nPROJECT FIELDS (key: label):\n${projectFields}\n\nExample output: {"field_0":"merchantName","field_1":"arr","field_2":"skip"}\n\nReturn the JSON now.`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      let result: Record<string, string> = {};
      try {
        const parsed = JSON.parse(content);
        result = parsed && typeof parsed.mapping === "object" ? parsed.mapping : parsed;
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      }

      console.log("map_email_fields result:", result);
      return new Response(JSON.stringify({ result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch mode: generate next actions for multiple projects
    if (type === "next_actions" && projects) {
      const projectsSummary = projects.map((p: any) => {
        const completed = p.checklist?.filter((c: any) => c.completed).length || 0;
        const total = p.checklist?.length || 0;
        const pending = p.checklist?.filter((c: any) => !c.completed).map((c: any) => c.title).slice(0, 3).join(", ") || "None";
        return `- ${p.merchantName} (${p.currentPhase}/${p.projectState || "not_started"}): ${completed}/${total} done. Next: ${pending}`;
      }).join("\n");

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: `You are a project management AI. For each project listed, provide exactly ONE critical next action and flag any blockers. Format as JSON array: [{"project":"name","action":"next action","priority":"high|medium|low","alert":"optional critical alert or empty string"}]. Only output the JSON array, nothing else.` },
            { role: "user", content: projectsSummary },
          ],
          max_tokens: 800,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "[]";
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      return new Response(JSON.stringify({ result: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let systemPrompt: string;
    if (type === "insights") {
      systemPrompt = `You are a project management AI analyst. Given a project's data, provide 3-4 concise, actionable insights about the project's health, risks, and recommendations. Be specific and data-driven. Keep each insight to 1-2 sentences. Format as bullet points. Note: "Kick Off Date" means the project start date.`;
    } else {
      systemPrompt = `You are a project management AI summarizer. Given a project's checklist and status data, provide a brief task summary: what's done, what's pending, blockers, and next priority action. Keep it concise (4-5 bullet points max). Note: "Kick Off Date" means the project start date.`;
    }

    const projectSummary = `
Project: ${project.merchantName} (MID: ${project.mid})
Phase: ${project.currentPhase}
State: ${project.projectState || "not_started"}
ARR: ${(Math.abs(Number(project.arr) || 0) >= 100000 ? (Number(project.arr) || 0) / 1e7 : Number(project.arr) || 0).toFixed(2)} Cr
Platform: ${project.platform}
Start Date (Kick Off): ${project.dates?.kickOffDate || "N/A"}
Go Live: ${project.dates?.goLiveDate || project.dates?.expectedGoLiveDate || "Not set"}
Owner Team: ${project.currentOwnerTeam}
Pending With: ${project.currentResponsibility}
Assigned Owner: ${project.assignedOwnerName || "Unassigned"}
Checklist: ${project.checklist?.filter((c: any) => c.completed).length}/${project.checklist?.length || 0} completed
Pending Items: ${project.checklist?.filter((c: any) => !c.completed).map((c: any) => c.title).join(", ") || "None"}
Transfer History: ${project.transferHistory?.length || 0} transfers
`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: projectSummary },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "Unable to generate insights.";

    return new Response(JSON.stringify({ result: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/ai-project-insights")({
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
