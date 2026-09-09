import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

/**
 * On-demand AI explanation for a single project's attention / EGL risk.
 *
 * The rule engines (riskRules.ts, eglRisk.ts) stay the source of truth for
 * WHETHER a project is flagged — this only writes the prose, grounded in the
 * project's checklist item names, sub-tasks, recent comments and project data.
 *
 * Results are cached in project_risk_insights keyed by (project_id, kind) and
 * invalidated by a hash of the rule reasons, so the same reasons never pay for
 * a second generation.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hashReasons = (kind: string, reasons: string[]): string => {
  const src = `${kind}|${[...reasons].sort().join("|")}`;
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
  return `${h}`;
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const body = await req.json();
    const projectId: string = body.projectId;
    const kind: "risk" | "egl" = body.kind === "egl" ? "egl" : "risk";
    const reasons: string[] = Array.isArray(body.reasons) ? body.reasons.filter(Boolean) : [];
    const force: boolean = body.force === true;

    if (!projectId || reasons.length === 0) return json({ error: "projectId and reasons are required" }, 400);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("LOVABLE_API_KEY not set");

    const supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    );

    const findings_hash = hashReasons(kind, reasons);

    if (!force) {
      const { data: cached } = await supabase
        .from("project_risk_insights")
        .select("why, recommendation, findings_hash, generated_at")
        .eq("project_id", projectId)
        .eq("kind", kind)
        .maybeSingle();
      if (cached && (cached as { findings_hash?: string }).findings_hash === findings_hash) {
        return json({ result: { ...(cached as object), cached: true } });
      }
    }

    // ---- Context: project + checklist names + tasks + comments -------------
    const { data: project } = await supabase
      .from("projects")
      .select(
        "id, tenant_id, merchant_name, mid, platform, category, arr, project_state, current_owner_team, current_responsibility, pending_acceptance, kick_off_date, expected_go_live_date, go_live_date, sales_spoc, integration_type, pg_onboarding, project_notes, mint_notes, current_phase_comment",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (!project) return json({ error: "Project not found" }, 404);

    // Teams are renameable per tenant (Settings → Checklist → Team Management),
    // so the slug stored on a project is not what anyone calls that team. Resolve
    // to the configured label before it reaches the model, or it repeats "mint"
    // back to a tenant who renamed that team months ago.
    const { data: teamRows } = await supabase
      .from("teams")
      .select("slug, name")
      .eq("tenant_id", project.tenant_id);

    const teamLabels = new Map<string, string>(
      ((teamRows || []) as Array<{ slug: string; name: string }>).map((t) => [t.slug, t.name]),
    );
    const teamLabel = (slug: string | null | undefined): string =>
      (slug && (teamLabels.get(slug) || slug.replace(/_/g, " "))) || "unassigned";

    const { data: items } = await supabase
      .from("checklist_items")
      .select("id, title, completed, due_date, owner_team, current_responsibility, is_task, comment")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });

    const itemRows = (items || []) as Array<{
      id: string;
      title: string;
      completed: boolean | null;
      due_date: string | null;
      owner_team: string | null;
      current_responsibility: string | null;
      is_task: boolean | null;
      comment: string | null;
    }>;

    const { data: tasks } = await supabase
      .from("checklist_tasks")
      .select("title, status, priority, due_date, checklist_item_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40);

    const itemIds = itemRows.map((i) => i.id);
    let comments: Array<{ comment: string; user_name: string; created_at: string; checklist_item_id: string }> = [];
    if (itemIds.length > 0) {
      const { data: cRows } = await supabase
        .from("checklist_comments")
        .select("comment, user_name, created_at, checklist_item_id")
        .in("checklist_item_id", itemIds)
        .order("created_at", { ascending: false })
        .limit(25);
      comments = (cRows || []) as typeof comments;
    }

    const titleById = new Map(itemRows.map((i) => [i.id, i.title]));
    const today = new Date().toISOString().slice(0, 10);
    const open = itemRows.filter((i) => !i.is_task && !i.completed);
    const done = itemRows.filter((i) => !i.is_task && i.completed);
    const overdue = open.filter((i) => i.due_date && i.due_date < today);

    const arrCr = Math.abs(Number(project.arr) || 0) >= 100000
      ? (Number(project.arr) || 0) / 1e7
      : Number(project.arr) || 0;

    const context = `Merchant: ${project.merchant_name} (MID: ${project.mid})
Platform: ${project.platform || "N/A"} | Category: ${project.category || "N/A"} | ARR: ${arrCr.toFixed(2)} Cr
State: ${(project.project_state || "not_started").replace(/_/g, " ")} | Owner team: ${teamLabel(project.current_owner_team)} | Pending with: ${project.current_responsibility || "neutral"} | Handover accepted: ${project.pending_acceptance ? "NO" : "yes"}
Kick-off: ${project.kick_off_date || "N/A"} | Expected go-live: ${project.expected_go_live_date || "not set"} | Actual go-live: ${project.go_live_date || "not live"}
Integration type: ${project.integration_type || "N/A"} | PG onboarding: ${project.pg_onboarding || "N/A"} | Sales SPOC: ${project.sales_spoc || "N/A"}
Notes: ${[project.project_notes, project.mint_notes, project.current_phase_comment].filter(Boolean).join(" | ") || "none"}
Today: ${today}

Checklist progress: ${done.length}/${done.length + open.length} complete.
OPEN checklist items (name | due | owner | pending with):
${open.slice(0, 30).map((i) => `- ${i.title} | due ${i.due_date || "no due date"}${i.due_date && i.due_date < today ? " (OVERDUE)" : ""} | ${teamLabel(i.owner_team)} | ${i.current_responsibility || "neutral"}${i.comment ? ` | note: ${i.comment}` : ""}`).join("\n") || "- none"}
Overdue count: ${overdue.length}
Recently completed: ${done.slice(-6).map((i) => i.title).join(", ") || "none"}

Sub-tasks:
${(tasks || []).slice(0, 20).map((t: any) => `- [${t.status}/${t.priority}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""} on "${titleById.get(t.checklist_item_id) || "?"}"`).join("\n") || "- none"}

Latest checklist comments (newest first):
${comments.slice(0, 15).map((c) => `- ${c.created_at.slice(0, 10)} ${c.user_name} on "${titleById.get(c.checklist_item_id) || "?"}": ${c.comment.replace(/\s+/g, " ").slice(0, 240)}`).join("\n") || "- none"}`;

    const systemPrompt = `You are an onboarding delivery analyst for a merchant integration team.

A deterministic rule engine has ALREADY flagged this merchant${kind === "egl" ? " as likely to miss its expected go-live date" : " as needing attention"} and gives you the exact reasons. Do NOT re-assess the flag and do NOT invent reasons that are not listed. Use the checklist item names, sub-tasks, comments and project data only as evidence to make the explanation concrete.

Produce:
1. "why": ONE or TWO sentences explaining what the listed reasons mean for this merchant, naming the actual blocking checklist items, sub-tasks or comment context where they exist.
2. "recommendation": ONE sentence naming the single most useful next action and who should take it (team or merchant). No generic advice like "monitor closely".
3. "evidence": up to 3 very short bullet strings quoting the concrete items/comments you relied on. Empty array if there is nothing concrete.`;

    const userContent = `RULE REASONS:\n${reasons.map((r) => `- ${r}`).join("\n")}\n\nPROJECT CONTEXT:\n${context}`;

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
              name: "submit_attention_reason",
              description: "Return the explanation for this merchant",
              parameters: {
                type: "object",
                properties: {
                  why: { type: "string" },
                  recommendation: { type: "string" },
                  evidence: { type: "array", items: { type: "string" } },
                },
                required: ["why", "recommendation"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_attention_reason" } },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted." }, 402);
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { why?: string; recommendation?: string; evidence?: string[] } = {};
    try { parsed = args ? JSON.parse(args) : {}; } catch { parsed = {}; }
    if (!parsed.why || !parsed.recommendation) throw new Error("AI returned an empty explanation");

    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 3) : [];
    const generated_at = new Date().toISOString();

    await supabase.from("project_risk_insights").upsert(
      {
        project_id: projectId,
        kind,
        tenant_id: project.tenant_id,
        findings_hash,
        why: parsed.why,
        recommendation: parsed.recommendation + (evidence.length ? `\n${evidence.map((e) => `• ${e}`).join("\n")}` : ""),
        model: "google/gemini-2.5-flash",
        generated_at,
      },
      { onConflict: "project_id,kind" },
    );

    return json({
      result: { why: parsed.why, recommendation: parsed.recommendation, evidence, findings_hash, generated_at },
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/ai-attention-reason")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
