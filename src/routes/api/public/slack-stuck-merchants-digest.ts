import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, requireCred, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { projectUrl } from "@/lib/app-links.server";

import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StuckItem {
  project_id: string;
  checklist_item_id: string;
  comment_id: string;
  merchant_name: string;
  funnel_stage: string;
  project_state: string;
  sales_spoc: string | null;
  item_title: string;
  last_note: string;
  last_note_by: string;
  hours_stuck: number;
  tag_comment_at: string;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {

    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
    );

    const url = new URL(req.url);
    const isTest = url.searchParams.get("test") === "true";
    const testTenantId = url.searchParams.get("tenant_id");
    const testRecipient = url.searchParams.get("to");

    // Load all tenants
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, name");
    if (tErr) throw tErr;

    const results: any[] = [];

    for (const tenant of tenants || []) {
      if (testTenantId && tenant.id !== testTenantId) continue;

      // Load tenant slack alert settings
      const { data: settings } = await supabase
        .from("app_settings")
        .select("key, value")
        .eq("tenant_id", tenant.id)
        .in("key", [
          "slack_alerts_enabled",
          "slack_channel_email",
          "slack_alert_tag",
          "slack_alert_hours",
        ]);

      const cfg: Record<string, string> = {};
      (settings || []).forEach((s: any) => (cfg[s.key] = s.value));

      const enabled = cfg.slack_alerts_enabled === "true";
      const channelEmail = testRecipient || cfg.slack_channel_email;
      const tag = (cfg.slack_alert_tag || "#awaiting-merchant").toLowerCase();
      const hours = parseInt(cfg.slack_alert_hours || "24", 10);

      if (!isTest && !enabled) {
        results.push({ tenant: tenant.name, skipped: "disabled" });
        continue;
      }
      if (!channelEmail) {
        results.push({ tenant: tenant.name, skipped: "no channel email" });
        continue;
      }

      // Find stuck items
      const stuck = await findStuckItems(supabase, tenant.id, tag, hours);

      if (stuck.length === 0 && !isTest) {
        results.push({ tenant: tenant.name, count: 0, sent: false });
        continue;
      }

      const tenantCreds = await getTenantIntegrations(tenant.id);
      const RESEND_API_KEY = tenantCreds.resend_api_key;
      if (!RESEND_API_KEY) {
        results.push({ tenant: tenant.name, skipped: "resend not configured" });
        continue;
      }

      const html = buildDigestHtml(stuck, tag, hours, tenantCreds);
      const subject = stuck.length
        ? `🚨 ${stuck.length} merchant${stuck.length > 1 ? "s" : ""} pending response (${hours}h+) — ${formatDateIST()}`
        : `✅ No stuck merchants (test) — ${formatDateIST()}`;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom(tenantCreds, "MINT Alerts"),
          ...resendReplyTo(tenantCreds),
          to: [channelEmail],
          subject,
          html,
        }),
      });

      const sendResult = await resp.json();
      if (!resp.ok) {
        console.error("Resend error", tenant.name, sendResult);
        results.push({
          tenant: tenant.name,
          count: stuck.length,
          sent: false,
          error: sendResult,
        });
        continue;
      }

      // Log activity
      await supabase.from("activity_logs").insert({
        tenant_id: tenant.id,
        user_name: "System",
        action_type: "system",
        category: "slack-alert",
        description: `Sent Slack digest: ${stuck.length} stuck merchant${stuck.length === 1 ? "" : "s"}${isTest ? " (test)" : ""}`,
        metadata: { count: stuck.length, recipient: channelEmail, test: isTest },
        status: "success",
      });

      results.push({
        tenant: tenant.name,
        count: stuck.length,
        sent: true,
        id: sendResult.id,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("slack-stuck-merchants-digest error", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
async function findStuckItems(
  supabase: any,
  tenantId: string,
  tag: string,
  hours: number
): Promise<StuckItem[]> {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  // Get all comments containing the tag (case-insensitive)
  const { data: tagComments, error: cErr } = await supabase
    .from("checklist_comments")
    .select("id, checklist_item_id, comment, user_name, created_at")
    .eq("tenant_id", tenantId)
    .ilike("comment", `%${tag}%`)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: false });
  if (cErr) throw cErr;
  if (!tagComments?.length) return [];

  // Keep only latest tag-comment per item
  const latestTagByItem = new Map<string, any>();
  for (const c of tagComments) {
    if (!latestTagByItem.has(c.checklist_item_id)) {
      latestTagByItem.set(c.checklist_item_id, c);
    }
  }
  const itemIds = Array.from(latestTagByItem.keys());

  // Load items (only incomplete)
  const { data: items, error: iErr } = await supabase
    .from("checklist_items")
    .select("id, title, project_id, completed")
    .in("id", itemIds)
    .eq("completed", false);
  if (iErr) throw iErr;
  if (!items?.length) return [];

  const openItemIds = items.map((i: any) => i.id);
  const itemById = new Map<string, any>(items.map((i: any) => [i.id, i]));

  // Check for newer untagged comments per item (anything after the tagged comment)
  const { data: allRecent } = await supabase
    .from("checklist_comments")
    .select("checklist_item_id, comment, created_at")
    .in("checklist_item_id", openItemIds)
    .order("created_at", { ascending: false });

  const repliedItems = new Set<string>();
  for (const c of allRecent || []) {
    const tagCmt = latestTagByItem.get(c.checklist_item_id);
    if (!tagCmt) continue;
    if (c.created_at > tagCmt.created_at && !c.comment.toLowerCase().includes(tag)) {
      repliedItems.add(c.checklist_item_id);
    }
  }

  const stuckItems = openItemIds.filter((id: string) => !repliedItems.has(id));
  if (!stuckItems.length) return [];

  const projectIds = Array.from(
    new Set(stuckItems.map((id: string) => itemById.get(id)!.project_id))
  );

  const { data: projects } = await supabase
    .from("projects")
    .select("id, merchant_name, current_phase, project_state, sales_spoc, archived")
    .in("id", projectIds);

  const projectById = new Map<string, any>((projects || []).map((p: any) => [p.id, p]));

  const stuck: StuckItem[] = [];
  for (const itemId of stuckItems) {
    const item = itemById.get(itemId)!;
    const project = projectById.get(item.project_id);
    if (!project || project.archived) continue;
    const tagCmt = latestTagByItem.get(itemId);
    const hoursStuck = Math.floor(
      (Date.now() - new Date(tagCmt.created_at).getTime()) / 3600_000
    );
    stuck.push({
      project_id: project.id,
      checklist_item_id: itemId,
      comment_id: tagCmt.id,
      merchant_name: project.merchant_name,
      funnel_stage: humanPhase(project.current_phase, project.project_state),
      project_state: project.project_state,
      sales_spoc: project.sales_spoc,
      item_title: item.title,
      last_note: tagCmt.comment,
      last_note_by: tagCmt.user_name,
      hours_stuck: hoursStuck,
      tag_comment_at: tagCmt.created_at,
    });
  }

  // Sort by hours stuck desc
  stuck.sort((a, b) => b.hours_stuck - a.hours_stuck);
  return stuck;
}

function humanPhase(phase: string, state: string): string {
  if (state === "live") return "Live";
  const map: Record<string, string> = {
    sales: "Sales",
    mint: "MINT (Under Integration)",
    ms: "Merchant Success",
  };
  return map[phase] || phase;
}

function formatDateIST(): string {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.toUTCString().split(" ").slice(1, 4).join(" ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDigestHtml(
  items: StuckItem[],
  tag: string,
  hours: number,
  creds: { app_base_url: string | null },
): string {
  if (items.length === 0) {
    return `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:16px;color:#111">
      <p>✅ No stuck merchants matched <code>${escapeHtml(tag)}</code> (>${hours}h).</p>
      <p style="color:#666;font-size:12px">This is a test digest.</p>
    </div>`;
  }

  const rows = items
    .map((it) => {
      const url = projectUrl(creds, it.project_id, {
        tab: "checklists",
        item: it.checklist_item_id,
        comment: it.comment_id,
      });
      const note = escapeHtml(it.last_note).slice(0, 400);
      return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#fff">
        <div style="font-size:15px;font-weight:600;color:#111;margin-bottom:4px">
          ${url
            ? `<a href="${url}" style="color:#0b66ff;text-decoration:none">${escapeHtml(it.merchant_name)}</a>`
            : escapeHtml(it.merchant_name)}
          <span style="color:#6b7280;font-weight:400;font-size:13px"> · ${escapeHtml(it.funnel_stage)} · ${it.hours_stuck}h stuck</span>
        </div>
        <div style="font-size:13px;color:#374151;margin-bottom:6px">
          <strong>Item:</strong> ${escapeHtml(it.item_title)}
        </div>
        <div style="font-size:13px;color:#374151;margin-bottom:6px">
          <strong>Last note</strong> <span style="color:#6b7280">(${escapeHtml(it.last_note_by)})</span>: ${note}
        </div>
        ${it.sales_spoc ? `<div style="font-size:12px;color:#6b7280">Sales SPOC: ${escapeHtml(it.sales_spoc)}</div>` : ""}
      </div>`;
    })
    .join("");

  return `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;padding:16px;color:#111">
    <h2 style="margin:0 0 12px;font-size:17px">🚨 Merchants pending response (${hours}h+)</h2>
    <p style="margin:0 0 14px;color:#374151;font-size:13px">
      ${items.length} merchant${items.length > 1 ? "s have" : " has"} a checklist note tagged <code>${escapeHtml(tag)}</code> older than ${hours}h with no follow-up.
    </p>
    ${rows}
    <p style="color:#9ca3af;font-size:11px;margin-top:14px">
      Auto-generated daily at 12:00 PM IST. Add a new comment without <code>${escapeHtml(tag)}</code> to drop a merchant from tomorrow's digest.
    </p>
  </div>`;
}

export const Route = createFileRoute("/api/public/slack-stuck-merchants-digest")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      PATCH: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
