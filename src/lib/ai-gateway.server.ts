/**
 * One place for the AI provider, so the routes don't each know where the models live.
 *
 * Lovable's gateway was OpenAI-shaped, and so is Google's own endpoint, so the routes
 * keep sending the same chat-completions payload. Only the host, the key and the model
 * name differ:
 *
 *   AI_API_KEY set        -> Google AI directly, model "gemini-2.5-flash"
 *   only LOVABLE_API_KEY  -> Lovable's gateway, model "google/gemini-2.5-flash"
 *
 * AI_BASE_URL overrides the endpoint for any other OpenAI-compatible provider.
 */

const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** True while we're still going through Lovable, i.e. no key of our own yet. */
function usingLovable(): boolean {
  return !process.env["AI_API_KEY"] && !!process.env["LOVABLE_API_KEY"];
}

/** The provider key. Throws with a clear message rather than sending an unauthenticated call. */
export function aiApiKey(): string {
  const key = process.env["AI_API_KEY"] || process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI_API_KEY is not configured");
  return key;
}

export function aiEndpoint(): string {
  const override = process.env["AI_BASE_URL"];
  if (override) return `${override.replace(/\/$/, "")}/chat/completions`;
  return usingLovable() ? LOVABLE_ENDPOINT : GOOGLE_ENDPOINT;
}

/**
 * Lovable namespaced its models ("google/gemini-2.5-flash"); Google itself does not.
 * Call sites keep the name they always used and this drops the prefix when needed.
 */
export function aiModel(model: string): string {
  if (usingLovable()) return model;
  const override = process.env["AI_MODEL"];
  if (override && model.startsWith("google/gemini-2.5")) return override;
  return model.replace(/^google\//, "");
}

export function aiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${aiApiKey()}`,
  };
}
