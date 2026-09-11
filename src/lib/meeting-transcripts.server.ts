import { adminClient } from "@/lib/tenant-integrations.server";

/**
 * Shared transcript handling for the meeting pipeline: turning a provider's
 * caption file into plain text, and recording one against a meeting.
 */

/**
 * Providers hand back WebVTT, which is mostly timing metadata. Reduce it to
 * readable speaker lines so the model spends its context on what was said.
 */
export function vttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let lastSpeaker = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "WEBVTT" || line.startsWith("NOTE ") || line.startsWith("STYLE")) continue;
    // Cue numbers and "00:00:01.000 --> 00:00:04.000" timing lines.
    if (/^\d+$/.test(line)) continue;
    if (line.includes("-->")) continue;

    // "<v Priya Shah>text</v>" and "Priya Shah: text" are both common.
    const voice = line.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
    const text = voice ? voice[2].trim() : line.replace(/<[^>]+>/g, "").trim();
    const speaker = voice
      ? voice[1].trim()
      : (line.match(/^([A-Z][\w.'\- ]{1,40}):\s/) || [])[1] || "";
    if (!text) continue;

    if (speaker && speaker !== lastSpeaker) {
      out.push(`${speaker}: ${voice ? text : text.replace(/^[^:]+:\s*/, "")}`);
      lastSpeaker = speaker;
    } else {
      out.push(voice ? text : text.replace(/^[^:]+:\s*/, ""));
    }
  }

  return out.join("\n").trim();
}

/** Meetings that have finished but still owe us a transcript. */
export async function meetingsAwaitingTranscript(provider: string, olderThanMinutes = 5) {
  const supabase = adminClient();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  // Anything older than a couple of days is a lost cause and would otherwise be
  // retried against the provider forever.
  const floor = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("checklist_meetings")
    .select("*")
    .eq("provider", provider)
    .is("transcript", null)
    .neq("status", "cancelled")
    .lt("scheduled_at", cutoff)
    .gt("scheduled_at", floor)
    .limit(25);
  if (error) throw error;
  return data || [];
}

/** Store a transcript against a meeting, ready for analysis. */
export async function recordTranscript(
  meetingId: string,
  transcript: string,
  source: "zoom" | "google_meet" | "teams" | "manual" | "api",
) {
  const supabase = adminClient();
  const { error } = await supabase
    .from("checklist_meetings")
    .update({
      transcript,
      transcript_source: source,
      transcript_received_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", meetingId);
  if (error) throw error;
}

/** HMAC-SHA256, hex encoded — used by the Zoom webhook handshake and signature. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparison that does not leak how much of the signature matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
