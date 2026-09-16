import { createFileRoute } from "@tanstack/react-router";
import { adminClient, tenantIdFromRequest } from "@/lib/tenant-integrations.server";
import { drainQueue, runScheduledPass } from "@/lib/workflows.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Runs the workflows configured in Settings → Workflows.
 *
 * Project and checklist changes are queued by database triggers, so a rule
 * fires however the row changed — the app, the SQL editor, an import, an AI
 * action. Each call drains that queue; the scheduler (and "Run now") also runs
 * the scheduled pass for time-based and "go-live date passed" rules. The runner itself lives in
 * src/lib/workflows.server.ts.
 *
 * Called by the app right after it changes a project (so rules feel immediate)
 * and by the scheduler every 10 minutes (so nothing waits on someone editing).
 */

/** The scheduler's token, matching cron.ts. */
async function cronToken(req: Request): Promise<boolean> {
  const provided =
    req.headers.get("x-cron-token") || new URL(req.url).searchParams.get("token") || "";
  if (!provided) return false;
  if (process.env["LOVABLE_CRON_SECRET"] && provided === process.env["LOVABLE_CRON_SECRET"]) return true;
  const { data } = await adminClient().rpc("cron_token_matches", { _token: provided });
  return data === true;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    console.error("run-workflows: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    return json({ error: "Server is not configured for workflows" }, 500);
  }

  try {
    // Either the scheduler, or a signed-in user — who only ever runs their
    // own tenant's rules.
    const isCron = await cronToken(req);
    const tenantId = isCron ? null : await tenantIdFromRequest(req);
    if (!isCron && !tenantId) return json({ error: "Unauthorized" }, 401);

    // The app calls this after every project edit, so the scheduled pass only
    // runs for the scheduler and when someone presses "Run now".
    const body = (await req.clone().json().catch(() => ({}))) as { scheduled?: boolean };
    const queue = await drainQueue(req, tenantId);
    const scheduled = isCron || body.scheduled ? await runScheduledPass(req, tenantId) : { fired: 0 };
    return json({ processed: queue.processed, fired: queue.fired + scheduled.fired });
  } catch (err) {
    console.error("run-workflows error:", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/run-workflows")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
