import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Jobs that must run once per tenant (the handler needs a tenant_id in the body). */
const PER_TENANT_JOBS = [
  "poll-emails",
  "poll-shopify-sme-emails",
  "poll-platform-golive-emails",
] as const;

/** Jobs that already iterate tenants (or schedules) themselves. */
const GLOBAL_JOBS = [
  "send-scheduled-report",
  "send-scheduled-tat-report",
  "send-scheduled-movement-report",
  "slack-stuck-merchants-digest",
  "check-overdue-tasks",
  // Drains the workflow queue and handles time-based rules. Event and
  // field-change rules are also run by the app right after a change, so this is
  // the safety net rather than the only path.
  "run-workflows",
] as const;

const ALL_JOBS: string[] = [...PER_TENANT_JOBS, ...GLOBAL_JOBS];

/** Returns the validated scheduler token, or null when the caller is unknown. */
async function verifyToken(req: Request): Promise<string | null> {
  const provided =
    req.headers.get("x-cron-token") ||
    new URL(req.url).searchParams.get("token") ||
    "";
  if (!provided) return null;

  const envToken = process.env["LOVABLE_CRON_SECRET"];
  if (envToken && provided === envToken) return provided;

  const { data } = await adminClient().rpc("cron_token_matches", { _token: provided });
  return data === true ? provided : null;
}

async function callJob(
  origin: string,
  job: string,
  body: Record<string, unknown>,
  token: string,
) {
  const res = await fetch(`${origin}/api/public/${job}`, {
    method: "POST",
    // The job routes authenticate independently, so the scheduler token has to
    // travel with the internal fan-out call.
    headers: { "Content-Type": "application/json", "x-cron-token": token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { job, status: res.status, body: text.slice(0, 300) };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronToken = await verifyToken(req);
  if (!cronToken) return json({ error: "Unauthorized" }, 401);


  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const job = String(url.searchParams.get("job") || body["job"] || "");
  if (!ALL_JOBS.includes(job)) {
    return json({ error: `Unknown job "${job}"`, available: ALL_JOBS }, 400);
  }

  const origin = url.origin;
  const results: unknown[] = [];

  try {
    if ((PER_TENANT_JOBS as readonly string[]).includes(job)) {
      const { data: tenants } = await adminClient()
        .from("tenants")
        .select("id, name")
        .eq("is_active", true);
      for (const tenant of (tenants || []) as { id: string; name: string }[]) {
        try {
          results.push({
            tenant: tenant.name,
            ...(await callJob(origin, job, { tenant_id: tenant.id }, cronToken)),
          });
        } catch (err) {
          results.push({ tenant: tenant.name, error: (err as Error).message });
        }
      }
    } else {
      results.push(await callJob(origin, job, {}, cronToken));
    }
    return json({ success: true, job, ran_at: new Date().toISOString(), results });
  } catch (err) {
    console.error("cron dispatch error", job, err);
    return json({ error: (err as Error).message, job }, 500);
  }
}

export const Route = createFileRoute("/api/public/cron")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
