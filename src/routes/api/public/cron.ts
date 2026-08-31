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
] as const;

const ALL_JOBS: string[] = [...PER_TENANT_JOBS, ...GLOBAL_JOBS];

async function verifyToken(req: Request): Promise<boolean> {
  const provided =
    req.headers.get("x-cron-token") ||
    new URL(req.url).searchParams.get("token") ||
    "";
  if (!provided) return false;

  const envToken = process.env["LOVABLE_CRON_SECRET"];
  if (envToken && provided === envToken) return true;

  const { data } = await adminClient().rpc("cron_token_matches", { _token: provided });
  return data === true;
}

async function callJob(origin: string, job: string, body: Record<string, unknown>) {
  const res = await fetch(`${origin}/api/public/${job}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { job, status: res.status, body: text.slice(0, 300) };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await verifyToken(req))) return json({ error: "Unauthorized" }, 401);

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
            ...(await callJob(origin, job, { tenant_id: tenant.id })),
          });
        } catch (err) {
          results.push({ tenant: tenant.name, error: (err as Error).message });
        }
      }
    } else {
      results.push(await callJob(origin, job, {}));
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
