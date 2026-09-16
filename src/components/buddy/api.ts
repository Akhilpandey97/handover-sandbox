import { apiAuthHeaders } from "@/lib/api-invoke";
import type { ActionPreview, BuddyPage, BuddyReport, BuddySource, Mention } from "./types";

export type ChatEvent =
  | { type: "delta"; content: string }
  | { type: "step"; label: string }
  | { type: "sources"; items: BuddySource[] }
  | { type: "report"; report: BuddyReport }
  | { type: "actions"; calls: { id: string; name: string; arguments: Record<string, any> }[] }
  | { type: "error"; message: string };

/** Streams one Buddy turn, calling onEvent for every server event. */
export async function streamChat(opts: {
  messages: { role: "user" | "assistant"; content: string }[];
  page: BuddyPage;
  mentions: Mention[];
  signal: AbortSignal;
  onEvent: (evt: ChatEvent) => void;
}) {
  const res = await fetch("/api/public/ai-chat", {
    method: "POST",
    headers: await apiAuthHeaders(),
    body: JSON.stringify({
      messages: opts.messages,
      page: opts.page,
      mentions: opts.mentions.map(({ kind, id, name }) => ({ kind, id, name })),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Buddy couldn't answer. Try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      opts.onEvent(JSON.parse(payload) as ChatEvent);
    } catch {
      // Ignore a malformed event rather than dropping the whole answer.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      handle(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) buffer.split("\n").forEach((l) => handle(l.replace(/\r$/, "")));
}

async function postAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/public/ai-actions", {
    method: "POST",
    headers: await apiAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Buddy couldn't do that. Try again.");
  return data as T;
}

export const previewAction = (action: string, params: Record<string, any>) =>
  postAction<ActionPreview>({ mode: "preview", action, params });

export const executeAction = (action: string, params: Record<string, any>) =>
  postAction<{
    success: boolean;
    message: string;
    link?: { label: string; href: string };
    log_id?: string;
    undoable?: boolean;
    undo_until?: string;
    /** Secret values to mask in the open conversation. */
    redact?: string[];
  }>({ mode: "execute", action, params });

export const undoBuddyAction = (logId: string) => postAction<{ message: string }>({ mode: "undo", log_id: logId });
