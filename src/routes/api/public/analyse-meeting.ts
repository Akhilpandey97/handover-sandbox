import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { requireInternalCaller } from "@/lib/api-auth.server";

/**
 * The AI layer behind a checklist meeting.
 *
 * Takes the call transcript, writes the minutes back as a "Meeting AI" comment
 * on the checklist item the meeting belongs to, and raises a project risk for
 * anything the model judges worth flagging. Risks land in the same
 * project_risks table the rule engine uses, tagged trigger_type 'ai' so they
 * are distinguishable from rule-generated and hand-raised rows.
 *
 * Reached three ways: the "Analyse" button, the transcript intake endpoint a
 * provider webhook posts to, and the transcript poller.
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

export const MEETING_AI_AUTHOR = "Meeting AI";

const MODEL = "google/gemini-2.5-flash";

/** Keeps a very long call inside the model's context without silently truncating the end. */
const clipTranscript = (text: string, limit = 60_000): string => {
  if (text.length <= limit) return text;
  const head = text.slice(0, Math.floor(limit * 0.6));
  const tail = text.slice(-Math.floor(limit * 0.35));
  return `${head}\n\n[... middle of the transcript omitted for length ...]\n\n${tail}`;
};

interface AnalysisRisk {
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
}

interface Analysis {
  summary: string;
  decisions: string[];
  action_items: string[];
  risks: AnalysisRisk[];
}

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

/** The minutes as they appear in the comment thread. */
function formatMinutes(analysis: Analysis, meetingTitle: string, scheduledAt: string): string {
  const when = new Date(scheduledAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines = [`📝 Minutes — ${meetingTitle} (${when})`, "", analysis.summary];

  if (analysis.decisions.length > 0) {
    lines.push("", "Decisions:", ...analysis.decisions.map((d) => `• ${d}`));
  }
  if (analysis.action_items.length > 0) {
    lines.push("", "Action items:", ...analysis.action_items.map((a) => `• ${a}`));
  }
  if (analysis.risks.length > 0) {
    lines.push(
      "",
      "Flagged as risk:",
      ...analysis.risks.map((r) => `• [${r.severity}] ${r.title} — ${r.description}`),
    );
  }
  return lines.join("\n");
}

async function callModel(apiKey: string, transcript: string, context: string): Promise<Analysis> {
  const systemPrompt = `You are a delivery analyst reading the transcript of a merchant onboarding call.

Return TWO things:
1. Minutes: a factual summary of what was discussed, the decisions taken and the action items agreed. Name who owns each action item when the transcript makes it clear. Never invent an owner, a date or a commitment that was not said.
2. Risks: only things that genuinely threaten the go-live — a slipped or contested date, a blocked dependency, a missing approval, scope being renegotiated, an unhappy or disengaged merchant, a technical blocker with no owner. Do NOT raise a risk for routine progress, for an action item that simply has a due date, or to be cautious. An ordinary call with no trouble returns an empty risks array, and that is the expected outcome most of the time.

Severity: critical = go-live will slip without intervention this week; high = a real threat with no owner or plan; medium = a concern worth tracking; low = worth noting only.
Category: one short lowercase word, e.g. timeline, technical, commercial, stakeholder, compliance.

Be concise. Minutes under 200 words.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${context}\n\nTRANSCRIPT:\n${clipTranscript(transcript)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_meeting_analysis",
              description: "Return the minutes and any risks worth flagging",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  decisions: { type: "array", items: { type: "string" } },
                  action_items: { type: "array", items: { type: "string" } },
                  risks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        category: { type: "string" },
                      },
                      required: ["title", "description", "severity"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["summary", "decisions", "action_items", "risks"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_meeting_analysis" } },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 429) throw new Error("AI rate limit exceeded. Try again shortly.");
    if (response.status === 402) throw new Error("AI credits exhausted.");
    console.error("AI gateway error:", response.status, await response.text());
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  let parsed: Partial<Analysis> = {};
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.summary) throw new Error("The model returned no minutes for this transcript");

  const risks = (Array.isArray(parsed.risks) ? parsed.risks : [])
    .filter((r): r is AnalysisRisk => Boolean(r?.title && r?.description))
    .map((r) => ({
      ...r,
      severity: SEVERITIES.has(r.severity) ? r.severity : "medium",
      category: (r.category || "delivery").toLowerCase().slice(0, 40),
    }))
    .slice(0, 5);

  return {
    summary: parsed.summary,
    decisions: (Array.isArray(parsed.decisions) ? parsed.decisions : []).slice(0, 10),
    action_items: (Array.isArray(parsed.action_items) ? parsed.action_items : []).slice(0, 10),
    risks,
  };
}

/**
 * Run the pipeline for one meeting. Exported so the intake endpoint and the
 * poller can analyse a transcript in the same request that received it.
 */
export async function analyseMeeting(
  meetingId: string,
  transcriptOverride?: string,
): Promise<{ comment_id: string | null; risks_created: number }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const supabase = adminClient();

  const { data: meeting, error } = await supabase
    .from("checklist_meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) throw error;
  if (!meeting) throw new Error("Meeting not found");

  const transcript = (transcriptOverride ?? meeting.transcript ?? "").trim();
  if (!transcript) throw new Error("This meeting has no transcript yet");

  await supabase
    .from("checklist_meetings")
    .update({ analysis_status: "processing", analysis_error: null })
    .eq("id", meetingId);

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("merchant_name, current_phase, project_state, expected_go_live_date")
      .eq("id", meeting.project_id)
      .maybeSingle();
    const { data: item } = await supabase
      .from("checklist_items")
      .select("title")
      .eq("id", meeting.checklist_item_id)
      .maybeSingle();

    const context = [
      `MERCHANT: ${project?.merchant_name ?? "Unknown"}`,
      `CURRENT PHASE: ${project?.current_phase ?? "unknown"} (${project?.project_state ?? "unknown"})`,
      project?.expected_go_live_date ? `EXPECTED GO-LIVE: ${project.expected_go_live_date}` : "",
      `CHECKLIST ITEM: ${item?.title ?? "Unknown"}`,
      `MEETING: ${meeting.title} on ${meeting.scheduled_at}`,
      meeting.agenda ? `AGENDA: ${meeting.agenda}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const analysis = await callModel(apiKey, transcript, context);

    // Minutes go back to the checklist item as a comment from a non-human author.
    const { data: comment, error: commentError } = await supabase
      .from("checklist_comments")
      .insert({
        checklist_item_id: meeting.checklist_item_id,
        user_name: MEETING_AI_AUTHOR,
        user_id: null,
        comment: formatMinutes(analysis, meeting.title, meeting.scheduled_at),
        tenant_id: meeting.tenant_id,
      })
      .select("id")
      .single();
    if (commentError) throw commentError;

    let risksCreated = 0;
    for (const risk of analysis.risks) {
      // trigger_rule keys the risk to this meeting so re-running the analysis
      // updates the same row instead of stacking duplicates. The unique index
      // on project_risks is partial to trigger_type 'auto', so this cannot be
      // an upsert — look the row up and decide.
      const triggerRule = `meeting:${meetingId}:${risk.title.toLowerCase().slice(0, 60)}`;
      const row = {
        project_id: meeting.project_id,
        tenant_id: meeting.tenant_id,
        title: risk.title.slice(0, 200),
        description: `${risk.description}\n\nRaised by Meeting AI from "${meeting.title}".`,
        severity: risk.severity,
        category: risk.category,
        trigger_type: "ai",
        trigger_rule: triggerRule,
      };

      const { data: existing } = await supabase
        .from("project_risks")
        .select("id, status")
        .eq("project_id", meeting.project_id)
        .eq("trigger_rule", triggerRule)
        .maybeSingle();

      // Someone who already resolved or dismissed this risk should not have it
      // reopened by a re-run.
      const riskError = existing
        ? existing.status === "resolved" || existing.status === "dismissed"
          ? null
          : (await supabase.from("project_risks").update(row).eq("id", existing.id)).error
        : (
            await supabase
              .from("project_risks")
              .insert({ ...row, status: "open", created_by: null })
          ).error;

      if (riskError) {
        // One bad risk row must not lose the minutes that were already posted.
        console.error("Meeting risk insert failed:", riskError);
        continue;
      }
      risksCreated++;
    }

    await supabase
      .from("checklist_meetings")
      .update({
        analysis_status: "done",
        analysis_error: null,
        analysed_at: new Date().toISOString(),
        mom_comment_id: comment.id,
        status: "completed",
      })
      .eq("id", meetingId);

    return { comment_id: comment.id, risks_created: risksCreated };
  } catch (err) {
    await supabase
      .from("checklist_meetings")
      .update({ analysis_status: "failed", analysis_error: (err as Error).message.slice(0, 500) })
      .eq("id", meetingId);
    throw err;
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const meetingId: string = body.meeting_id;
    if (!meetingId) return json({ error: "meeting_id is required" }, 400);

    const transcript: string | undefined =
      typeof body.transcript === "string" && body.transcript.trim() ? body.transcript : undefined;

    if (transcript) {
      const supabase = adminClient();
      await supabase
        .from("checklist_meetings")
        .update({
          transcript,
          transcript_source: "manual",
          transcript_received_at: new Date().toISOString(),
        })
        .eq("id", meetingId);
    }

    const result = await analyseMeeting(meetingId, transcript);
    return json({ success: true, ...result });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/analyse-meeting")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
