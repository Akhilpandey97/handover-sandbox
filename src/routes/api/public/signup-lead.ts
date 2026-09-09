import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Sign-up enquiries from the login page.
 *
 * Unauthenticated and public, so it is written defensively: the row is stored
 * first and the Google Sheet is written second. A sheet that is down, slow or
 * misconfigured must not cost a lead, so a failed forward is recorded on the
 * row and still returns success to the visitor.
 */

const FIELD_LIMIT = 200;
const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, FIELD_LIMIT) : "");

// Deliberately permissive — this rejects obvious typos, not unusual domains.
const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v);

/**
 * A crude per-IP throttle. Not a substitute for a real rate limiter — it is
 * per server instance and resets on deploy — but it stops a single client
 * hammering the form, which is the realistic case for a page like this.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > RATE_MAX;
}

/** The Apps Script web app bound to the sheet. */
async function sheetWebhookUrl(): Promise<string | null> {
  const fromEnv = process.env["SIGNUP_SHEET_WEBHOOK_URL"];
  if (fromEnv) return fromEnv;
  try {
    const { data } = await adminClient()
      .from("app_settings")
      .select("value")
      .eq("key", "signup_sheet_webhook_url")
      .is("tenant_id", null)
      .maybeSingle();
    return (data as { value: string } | null)?.value || null;
  } catch {
    return null;
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (rateLimited(ip)) return json({ error: "Too many requests. Please try again shortly." }, 429);

    const body = await req.json().catch(() => ({}));

    // Honeypot: a field no human sees, so anything filling it is a bot.
    // Answer 200 so the bot has nothing to learn from the response.
    if (clean(body.website)) return json({ ok: true });

    const lead = {
      name: clean(body.name),
      email: clean(body.email).toLowerCase(),
      job_title: clean(body.jobTitle),
      company_name: clean(body.companyName),
      phone: clean(body.phone),
      country: clean(body.country),
      city: clean(body.city),
    };

    const missing = (["name", "email", "job_title", "company_name", "country", "city"] as const)
      .filter((k) => !lead[k]);
    if (missing.length) return json({ error: "Please fill in every required field." }, 400);
    if (!looksLikeEmail(lead.email)) return json({ error: "That email address does not look right." }, 400);

    const supabase = adminClient();
    const { data: inserted, error } = await supabase
      .from("signup_leads")
      .insert({ ...lead, user_agent: (req.headers.get("user-agent") || "").slice(0, 400) })
      .select("id")
      .single();

    if (error) {
      console.error("signup-lead insert failed:", error.message);
      return json({ error: "Could not save your details. Please try again." }, 500);
    }

    // Forward to the sheet. Never fatal to the visitor.
    const webhook = await sheetWebhookUrl();
    if (webhook) {
      try {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...lead, submitted_at: new Date().toISOString() }),
        });
        if (!res.ok) throw new Error(`Sheet responded ${res.status}`);
        await supabase.from("signup_leads")
          .update({ synced_at: new Date().toISOString(), sync_error: null })
          .eq("id", (inserted as { id: string }).id);
      } catch (err) {
        const message = (err as Error).message;
        console.error("signup-lead sheet forward failed:", message);
        await supabase.from("signup_leads")
          .update({ sync_error: message.slice(0, 300) })
          .eq("id", (inserted as { id: string }).id);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("signup-lead error:", (err as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

export const Route = createFileRoute("/api/public/signup-lead")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
