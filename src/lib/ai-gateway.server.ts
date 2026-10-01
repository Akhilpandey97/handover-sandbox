/**
 * Claude, through the official Anthropic SDK.
 *
 * Replaces Lovable's AI gateway, which spoke the OpenAI chat-completions shape. The
 * Messages API is shaped differently — system prompt outside the messages, tool calls as
 * content blocks — so the routes call the three helpers here instead of fetching a URL.
 *
 *   aiText        one prompt in, text out (the majority of the routes)
 *   aiStructured  a forced tool call, for routes that want a known-shaped object back
 *   aiStream      Buddy's conversation: streaming, with tools, over several rounds
 *
 * Model choice is deliberate and overridable per deployment:
 *   Buddy      claude-opus-5   — multi-step tool use where judgement shows
 *   Background claude-haiku-4-5 — email parsing, field mapping, summaries: high volume
 */
import Anthropic from "@anthropic-ai/sdk";

/** Buddy and the merchant assistant. */
export const BUDDY_MODEL = process.env["AI_MODEL_BUDDY"] || "claude-opus-5";
/** Everything else: parsing, mapping, summarising, enrichment. */
export const BACKGROUND_MODEL = process.env["AI_MODEL_BACKGROUND"] || "claude-haiku-4-5";

let client: Anthropic | undefined;

export function aiClient(): Anthropic {
  if (!client) {
    const apiKey = process.env["ANTHROPIC_API_KEY"] || process.env["AI_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export type AiMessage = Anthropic.MessageParam;

/** Text out of a response, ignoring thinking blocks. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * A single prompt, text back. `json: true` adds the instruction Claude needs to answer
 * with bare JSON, which is what the routes that used response_format relied on.
 */
export async function aiText(opts: {
  prompt?: string;
  messages?: AiMessage[];
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const system = [opts.system, opts.json ? "Reply with valid JSON only — no prose, no code fences." : null]
    .filter(Boolean)
    .join("\n\n");

  const message = await aiClient().messages.create(
    {
      model: opts.model || BACKGROUND_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      messages: opts.messages ?? [{ role: "user", content: opts.prompt ?? "" }],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  const text = textOf(message);
  // Models wrap JSON in ```json fences often enough that callers shouldn't each have to.
  return opts.json ? text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim() : text;
}

/**
 * Ask for one object of a known shape. Claude is given a single tool and told to use it,
 * which is how the routes that used a forced OpenAI function call get their result.
 */
export async function aiStructured<T = Record<string, unknown>>(opts: {
  prompt?: string;
  messages?: AiMessage[];
  system?: string;
  toolName: string;
  description: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<T | null> {
  const message = await aiClient().messages.create(
    {
      model: opts.model || BACKGROUND_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      messages: opts.messages ?? [{ role: "user", content: opts.prompt ?? "" }],
      tools: [
        {
          name: opts.toolName,
          description: opts.description,
          input_schema: opts.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  const call = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.toolName,
  );
  return call ? (call.input as T) : null;
}

/** What a caller of aiStream sees, in the order the model produces it. */
export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "end"; stopReason: string | null };

/**
 * Buddy's round. Yields text as it arrives and the tool calls Claude wants to make; the
 * caller runs the tools, appends the results and calls again.
 */
export async function* aiStream(opts: {
  messages: AiMessage[];
  system?: string;
  tools?: Anthropic.Tool[];
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<AiStreamEvent, Anthropic.Message, void> {
  const stream = aiClient().messages.stream(
    {
      model: opts.model || BUDDY_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: { type: "auto" as const } } : {}),
      messages: opts.messages,
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text", text: event.delta.text };
    }
  }

  const final = await stream.finalMessage();

  for (const block of final.content) {
    if (block.type === "tool_use") {
      yield {
        type: "tool_call",
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      };
    }
  }

  yield { type: "end", stopReason: final.stop_reason };
  return final;
}
