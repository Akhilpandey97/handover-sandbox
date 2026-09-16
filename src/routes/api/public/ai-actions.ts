import { createFileRoute } from "@tanstack/react-router";
import { buddyCaller, corsHeaders, json } from "@/lib/buddy/scope.server";
import { DEFAULT_BULK_LIMIT, UNDO_WINDOW_MS, isActionError, undoAction } from "@/lib/buddy/actions.server";
import { getAnyAction as getAction } from "@/lib/buddy/registry.server";
import { hasRole, maskSecret } from "@/lib/buddy/setup-catalog.server";
import { drainQueue } from "@/lib/workflows.server";
import { loadBuddySettings } from "@/lib/buddy/settings.server";

/**
 * Buddy's actions: preview, execute and undo.
 *
 * Every request is checked here, on the server: the caller must be signed in,
 * the action must belong to their workspace, their role must be allowed to act,
 * and the workspace must not have switched the action off. The browser only
 * ever proposes.
 */
const redactFor = (name: string, params: Record<string, any>) => {
  const def = getAction(name);
  return def?.redactParams ? def.redactParams(params) : params;
};

/** Replace pasted secrets in the person's saved Buddy chats with a masked form. */
async function redactChat(caller: NonNullable<Awaited<ReturnType<typeof buddyCaller>>>, secrets: string[]) {
  const mask = (text: string) => secrets.reduce((t, s) => (s.length >= 6 ? t.split(s).join(maskSecret(s)) : t), text);
  const { data } = await caller.client
    .from("chat_messages")
    .select("id, content, metadata")
    .eq("user_id", caller.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  for (const row of (data || []) as { id: string; content: string; metadata?: unknown }[]) {
    const content = mask(row.content || "");
    const meta = row.metadata === undefined ? undefined : JSON.parse(mask(JSON.stringify(row.metadata)));
    if (content === row.content && JSON.stringify(meta) === JSON.stringify(row.metadata)) continue;
    await caller.client
      .from("chat_messages")
      .update(meta === undefined ? { content } : { content, metadata: meta })
      .eq("id", row.id)
      .eq("user_id", caller.userId);
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, corsHeaders);

  const caller = await buddyCaller(req);
  if (!caller) return json({ error: "Sign in again to use Buddy." }, 401, corsHeaders);

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "preview" | "execute" | "undo";
    action?: string;
    params?: Record<string, any>;
    log_id?: string;
  };
  const mode = body.mode || "execute";

  if (!caller.canAct) {
    return json({ error: "Your role can't make changes through Buddy. A manager or admin can." }, 403, corsHeaders);
  }

  try {
    if (mode === "undo") {
      if (!body.log_id) return json({ error: "Nothing to undo." }, 400, corsHeaders);
      return json(await undoAction(caller, body.log_id), 200, corsHeaders);
    }

    const name = String(body.action || "");
    const def = getAction(name);
    if (!def) return json({ error: `Buddy doesn't know how to ${name.replace(/_/g, " ") || "do that"}.` }, 400, corsHeaders);

    if (def.requires === "admin" && !hasRole(caller.roles, "admin")) {
      return json({ error: `${def.label} is for workspace admins.` }, 403, corsHeaders);
    }
    const settings = await loadBuddySettings(caller);
    if (settings.disabled_actions.includes(name)) {
      return json({ error: `${def.label} is switched off for this workspace.` }, 403, corsHeaders);
    }
    const ctx = { req, bulkLimit: settings.bulk_limit || DEFAULT_BULK_LIMIT };
    const params = body.params || {};

    if (mode === "preview") {
      return json(await def.preview(caller, params, ctx), 200, corsHeaders);
    }

    const outcome = await def.execute(caller, params, ctx);
    const loggedParams = def.redactParams ? def.redactParams(params) : params;
    if (outcome.secrets?.length) await redactChat(caller, outcome.secrets);
    // Workflows react to what Buddy just changed now, not at the next scheduled run.
    await drainQueue(req, caller.tenantId).catch((err) => console.error("ai-actions workflow drain:", (err as Error).message));
    const { data: log } = await caller.client
      .from("activity_logs")
      .insert({
        tenant_id: caller.tenantId,
        user_id: caller.userId,
        user_name: caller.name,
        action_type: "ai",
        category: outcome.log.category,
        description: outcome.log.description,
        entity_type: outcome.log.entityType,
        entity_id: outcome.log.entityId,
        metadata: { action: name, params: loggedParams, result: { message: outcome.message }, undo: outcome.undo, log_category: outcome.log.category, via: "buddy" },
        status: "success",
      })
      .select("id")
      .single();

    return json(
      {
        success: true,
        message: outcome.message,
        link: outcome.link,
        log_id: (log as { id: string } | null)?.id,
        undoable: !!outcome.undo,
        undo_until: outcome.undo ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString() : undefined,
        // The browser masks these in the open conversation; the saved copy is already masked.
        redact: outcome.secrets?.length ? outcome.secrets : undefined,
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    if (mode === "execute") {
      await caller.client
        .from("activity_logs")
        .insert({
          tenant_id: caller.tenantId,
          user_id: caller.userId,
          user_name: caller.name,
          action_type: "ai",
          category: "api",
          description: `Buddy couldn't ${String(body.action || "act").replace(/_/g, " ")}: ${message}`,
          metadata: { action: body.action, params: redactFor(String(body.action || ""), body.params || {}), error: message, via: "buddy" },
          status: "failed",
        })
        .then(() => undefined, () => undefined);
    }
    if (!isActionError(e)) console.error("ai-actions error:", e);
    return json({ error: message }, isActionError(e) ? 400 : 500, corsHeaders);
  }
}

export const Route = createFileRoute("/api/public/ai-actions")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
