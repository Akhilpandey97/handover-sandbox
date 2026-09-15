import { createFileRoute } from "@tanstack/react-router";
import { buddyCaller, corsHeaders, json, PHASE_LABELS, STATE_LABELS, todayIso } from "@/lib/buddy/scope.server";
import { READ_TOOL_DEFS, READ_TOOL_NAMES, runReadTool, type BuddySource } from "@/lib/buddy/read-tools.server";
import { REPORT_TOOL_DEF, runReportTool } from "@/lib/buddy/report-tool.server";
import { ALL_ACTION_TOOL_DEFS as ACTION_TOOL_DEFS } from "@/lib/buddy/registry.server";
import { loadBuddySettings } from "@/lib/buddy/settings.server";

/**
 * Buddy's conversation endpoint.
 *
 * The model loop runs here. When the model asks to read data, the server runs
 * the read tool against the caller's workspace and loops; when it proposes a
 * change, the proposal goes back to the browser, which shows an approval card.
 * Nothing about scope or permissions is taken from the request body.
 *
 * Streams server-sent events, one JSON object per event:
 *   { type: "step", label }          what Buddy is doing ("Read Urban Threads")
 *   { type: "sources", items }       projects and data behind the answer
 *   { type: "report", report }       a table and chart built for the user
 *   { type: "delta", content }       answer text
 *   { type: "actions", calls }       proposed changes, for approval
 *   { type: "error", message }
 * followed by `data: [DONE]`.
 */

const MODEL = "google/gemini-3-flash-preview";
const MAX_ROUNDS = 6;
const TOOL_RESULT_LIMIT = 24_000;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface PageContext {
  path?: string;
  projectId?: string | null;
}

interface Mention {
  kind: "project" | "person" | "item";
  id: string;
  name: string;
}

const PAGE_NAMES: Record<string, string> = {
  dashboard: "the dashboard",
  projects: "the projects list",
  risks: "the risks page",
  reports: "reports",
  settings: "settings",
  "go-live": "the go-live tracker",
  emails: "emails",
  archived: "archived projects",
};

const isReadTool = (name: string) => READ_TOOL_NAMES.has(name) || name === REPORT_TOOL_DEF.function.name;

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, corsHeaders);

  const caller = await buddyCaller(req);
  if (!caller) return json({ error: "Sign in again to use Buddy." }, 401, corsHeaders);

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json({ error: "Buddy isn't configured on this server." }, 500, corsHeaders);

  const body = (await req.json().catch(() => ({}))) as {
    messages?: ClientMessage[];
    page?: PageContext;
    mentions?: Mention[];
  };
  const history = (body.messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30);
  if (history.length === 0) return json({ error: "Ask Buddy something first." }, 400, corsHeaders);

  const settings = await loadBuddySettings(caller);

  // ── What the user is looking at, resolved here rather than trusted ──────
  let pageLine = "";
  const pageSources: BuddySource[] = [];
  if (body.page?.projectId) {
    const { data } = await caller.client
      .from("projects")
      .select("id, merchant_name, mid, project_state, current_phase, assigned_owner")
      .eq("tenant_id", caller.tenantId)
      .eq("id", body.page.projectId)
      .maybeSingle();
    const p = data as any;
    if (p && (caller.portfolio || p.assigned_owner === caller.userId)) {
      pageLine = `The user has project "${p.merchant_name}" (MID ${p.mid}, project_id=${p.id}, ${STATE_LABELS[p.project_state] || p.project_state}, ${PHASE_LABELS[p.current_phase] || p.current_phase}) open. Questions like "this project" or "why is it slipping" mean this one unless they name another.`;
      pageSources.push({ kind: "project", id: p.id, label: p.merchant_name });
    }
  } else if (body.page?.path) {
    const first = body.page.path.split("/").filter(Boolean)[0] || "dashboard";
    pageLine = `The user is on ${PAGE_NAMES[first] || "the dashboard"}.`;
  }

  const mentionLines = (body.mentions || [])
    .filter((m) => m && m.id && m.name)
    .slice(0, 10)
    .map((m) =>
      m.kind === "project"
        ? `- project "${m.name}" (project_id=${m.id})`
        : m.kind === "item"
          ? `- checklist item "${m.name}" (item_id=${m.id})`
          : `- person "${m.name}" (user_id=${m.id})`,
    );

  const allowedActions = caller.canAct
    ? ACTION_TOOL_DEFS.filter((t) => !settings.disabled_actions.includes(t.function.name))
    : [];
  const tools = [...READ_TOOL_DEFS, REPORT_TOOL_DEF, ...allowedActions];
  const allowedToolNames = new Set<string>(tools.map((t) => t.function.name as string));

  const system = [
    `You are Buddy, the assistant inside Handover, a tool for tracking merchant onboarding and integration projects. Today is ${todayIso()}.`,
    `You're talking to ${caller.name}. Their scope is ${caller.portfolio ? "every project in their workspace" : "only the projects assigned to them"}.`,
    pageLine,
    mentionLines.length ? `They referred to these specifically; act on them unless they say otherwise:\n${mentionLines.join("\n")}` : "",
    settings.instructions ? `Workspace instructions from an admin:\n${settings.instructions}` : "",
    `
How to answer:
- Answer from live data, never from memory. Before answering anything about projects, people, checklists, tasks, risks, meetings or numbers, call the read tools. Call several if you need to.
- Lead with the answer in one sentence, then the detail. Be brief and specific.
- For three or more projects or items, use a markdown table. Use merchant names exactly as the tools return them.
- Never show ids, database field names or raw enum values. Use the labels the tools return.
- Write dates like "26 Sep" and money like "₹4.2 Cr".
- If the data doesn't say, say so.

Reports:
- When the user asks for a report, a chart, a graph, a breakdown or trend, or a list they want to keep, call build_report. Headline numbers, the chart and the table appear in the chat with a chart switcher, download and save buttons, so reply with the one or two key takeaways only.
- Choose the chart by the job, and honour the chart the user names: line or area for a trend over months; column to compare a few categories; bar for many or long-named categories; pie or donut only for share of a whole; stacked, grouped or multiline with split_by for a second dimension (for example go-lives by month split by state). Use metric "arr" when they ask about revenue or ARR.
- If they ask how to save a report: project lists have "Save to Reports" on the card (it lands in Reports → Report Builder → Saved Reports and can be scheduled in Scheduler); any report can be downloaded as CSV.

Summaries:
- For a project summary, handover summary, meeting prep or meeting recap, read the project with get_project first and use these sections: Status, Done, Open (with who holds each item), Risks, Next steps. For meeting prep, lead with open questions for the call; for a recap, use the latest meeting's minutes.

Changing things:
${
  caller.canAct
    ? `- To change anything, call the matching action tool. The user sees an approval card with before and after values, so don't ask "shall I?" first and don't restate the details. Say in one short sentence what you've prepared.
- Get ids from the read tools first (project_id from search_projects or get_project, item and task ids from get_project, user ids from list_people). Never invent ids.
- Propose one action per reply unless the user asked for several.
- For emails, write the full subject and body yourself in a clear, friendly, professional tone, signed with the user's name. Use send_email for merchants or anyone outside Handover, and send_notification for teammates inside Handover.
- Meeting links: use create_meeting_link. Times are IST (+05:30) unless the user says otherwise; if no time was given, ask for it. Attach the meeting to a checklist item when one clearly fits, so it's saved and invites go out.
- Tasks, checklist comments and checklist changes need item or task ids: read the project with get_project first, or use a tagged checklist item.
- "Who holds" a single checklist item is toggle_item_responsibility; who the whole project waits on is toggle_responsibility.`
    : `- This user can't make changes. If they ask, explain that a manager or admin can, and offer to prepare the information instead.`
}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (evt: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      const convo: any[] = [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
      const toolsUsed: string[] = [];
      let actionsProposed = 0;
      let failed = false;
      if (pageSources.length) emit({ type: "sources", items: pageSources });

      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: convo, tools, tool_choice: "auto", stream: true }),
            signal: req.signal,
          });

          if (!res.ok || !res.body) {
            failed = true;
            const message =
              res.status === 429
                ? "Buddy is getting a lot of requests. Try again in a moment."
                : res.status === 402
                  ? "This workspace has run out of AI credits. An admin can add more."
                  : "Buddy couldn't reach the AI service. Try again.";
            if (res.status !== 429 && res.status !== 402) console.error("ai-chat gateway error:", res.status, await res.text().catch(() => ""));
            emit({ type: "error", message });
            break;
          }

          let text = "";
          const calls = new Map<number, { id: string; name: string; args: string }>();
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const handleLine = (line: string) => {
            if (!line.startsWith("data: ")) return;
            const payload = line.slice(6).trim();
            if (!payload || payload === "[DONE]") return;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta;
              if (delta?.content) {
                text += delta.content;
                emit({ type: "delta", content: delta.content });
              }
              for (const tc of delta?.tool_calls || []) {
                const idx = tc.index ?? 0;
                const acc = calls.get(idx) || { id: "", name: "", args: "" };
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name += tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
                calls.set(idx, acc);
              }
            } catch {
              // A partial JSON line; the next chunk completes it.
            }
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              handleLine(buffer.slice(0, nl).replace(/\r$/, ""));
              buffer = buffer.slice(nl + 1);
            }
          }
          if (buffer.trim()) buffer.split("\n").forEach((l) => handleLine(l.replace(/\r$/, "")));

          const parsed = Array.from(calls.values())
            .filter((c) => c.name)
            .map((c, i) => {
              let args: Record<string, any> = {};
              try {
                args = c.args ? JSON.parse(c.args) : {};
              } catch {
                args = {};
              }
              return { id: c.id || `call_${round}_${i}`, name: c.name, args, raw: c.args || "{}" };
            });
          if (parsed.length === 0) break;

          // A tool name the model made up, or one switched off for this workspace: tell the
          // model what exists and let it try again, rather than showing a card that can't run.
          if (parsed.some((c) => !allowedToolNames.has(c.name))) {
            convo.push({
              role: "assistant",
              content: text || "",
              tool_calls: parsed.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })),
            });
            for (const c of parsed) {
              convo.push({
                role: "tool",
                tool_call_id: c.id,
                content: JSON.stringify(
                  allowedToolNames.has(c.name)
                    ? { error: "Not run, because another tool in the same step does not exist. Call the tools again." }
                    : { error: `There is no tool named ${c.name}. Available tools: ${Array.from(allowedToolNames).join(", ")}.` },
                ),
              });
            }
            continue;
          }

          const actionCalls = parsed.filter((c) => !isReadTool(c.name));
          if (actionCalls.length > 0) {
            actionsProposed += actionCalls.length;
            emit({ type: "actions", calls: actionCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.args })) });
            break;
          }

          convo.push({
            role: "assistant",
            content: text || "",
            tool_calls: parsed.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })),
          });
          for (const call of parsed) {
            toolsUsed.push(call.name);
            const result =
              call.name === REPORT_TOOL_DEF.function.name
                ? await runReportTool(caller, call.args)
                : await runReadTool(caller, call.name, call.args);
            emit({ type: "step", label: result.step });
            if (result.sources.length) emit({ type: "sources", items: result.sources });
            if ("report" in result && result.report) emit({ type: "report", report: result.report });
            convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data).slice(0, TOOL_RESULT_LIMIT) });
          }

          if (round === MAX_ROUNDS - 1) {
            emit({ type: "delta", content: "\n\nI couldn't finish looking that up. Try a narrower question." });
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          failed = true;
          console.error("ai-chat error:", err);
          emit({ type: "error", message: "Buddy hit a problem answering that. Try again." });
        }
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        // Usage for Settings → Buddy. The question text is not stored.
        await caller.client
          .from("activity_logs")
          .insert({
            tenant_id: caller.tenantId,
            user_id: caller.userId,
            user_name: caller.name,
            action_type: "ai",
            category: "buddy_question",
            description: "Asked Buddy a question",
            metadata: {
              via: "buddy_chat",
              tools: toolsUsed,
              actions_proposed: actionsProposed,
              page: body.page?.projectId ? "project" : body.page?.path?.split("/").filter(Boolean)[0] || null,
            },
            status: failed ? "failed" : "success",
          })
          .then(() => undefined, () => undefined);
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export const Route = createFileRoute("/api/public/ai-chat")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
