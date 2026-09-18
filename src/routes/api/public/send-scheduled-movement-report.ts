import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, requireCred, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";

// Dispatches scheduled movement reports.
// Triggered by pg_cron every minute, or manually with { schedule_id } to send immediately.
import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FUNNEL_ORDER = ["sales", "pre_integration", "under_integration", "live", "none"];
const funnelRank: Record<string, number> = Object.fromEntries(FUNNEL_ORDER.map((s, i) => [s, i]));
const funnelLabels: Record<string, string> = {
  sales: "Sales",
  pre_integration: "Pre Integration",
  under_integration: "Under Integration",
  live: "Live",
  none: "Other",
};
const stateLabels: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  on_hold: "On Hold",
  blocked: "Blocked",
  completed: "Completed",
  live: "Live",
};

const escapeHtml = (s: string) =>
  (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const formatArr = (arr: number | null | undefined) => {
  if (arr == null || isNaN(Number(arr)) || Number(arr) === 0) return "TBD";
  const n = Number(arr);
  const cr = Math.abs(n) >= 100000 ? n / 1e7 : n;
  return `${cr.toFixed(2)} Cr`;
};
const formatEgl = (d: string | null | undefined) => {
  if (!d) return "TBD";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "TBD";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

function getFunnelStage(p: any): string {
  const state = p.project_state;
  const phase = p.current_phase;
  if (state === "live") return "live";
  if (phase === "mint" || phase === "integration") return "under_integration";
  if (phase === "sales") return "sales";
  if (phase === "pre_integration") return "pre_integration";
  return "none";
}

async function fetchAll<T>(supa: any, table: string, select: string, filters: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const size = 1000;
  while (true) {
    let q = supa.from(table).select(select).range(from, from + size - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

const PHASE_RANK: Record<string, number> = {
  sales: 0, pre_integration: 1, mint: 2, integration: 2, under_integration: 2, ms: 2, live: 3,
};
const phaseRank = (v: any): number => {
  if (!v) return -1;
  return PHASE_RANK[String(v).toLowerCase().trim()] ?? -1;
};
const LOWLIGHT_KW = /\b(not getting any update|no response|no responses|unresponsive|following up|awaiting response|chasing|reminder sent|haven't heard|still waiting|no eta)\b/i;
const WIN_KW = /\b(resolved|unblocked|cleared|sign(ed)?[- ]off|approved|pg done|sandbox cleared|api(s)? validated)\b/i;
const EGL_FIELD = /expected.?go.?live/i;
const PHASE_FIELD = /^(current_phase|phase|project_state|state|funnel|stage)$/i;

function classify(p: any, entries: any[]): "wins" | "updates" | "lowlights" {
  if (p.project_state === "blocked" || p.project_state === "on_hold") return "lowlights";
  if (!entries || entries.length === 0) return "lowlights";

  let fwd = false, regr = false, live = false, eglPushed = false, checklistDone = 0;
  for (const e of entries) {
    for (const c of (e.changes || [])) {
      if (PHASE_FIELD.test(c.field)) {
        const fr = phaseRank(c.from), tr = phaseRank(c.to);
        if (fr >= 0 && tr >= 0) { if (tr > fr) fwd = true; if (tr < fr) regr = true; }
        if (/live/i.test(c.to || "")) live = true;
      }
      if (EGL_FIELD.test(c.field)) {
        const fd = new Date(c.from).getTime(), td = new Date(c.to).getTime();
        if (!isNaN(fd) && !isNaN(td) && td > fd) eglPushed = true;
      }
    }
    if (e.category === "checklist") {
      if ((e.actionType && /complet/i.test(e.actionType)) ||
          /\b(completed|marked complete|checked off|ticked off)\b/i.test(e.description || "")) {
        checklistDone++;
      }
    }
  }
  const text = entries.map((e) => e.description || "").join(" ");
  if (eglPushed) return "lowlights";
  if (regr) return "lowlights";
  if (LOWLIGHT_KW.test(text)) return "lowlights";
  if (live || p.project_state === "live") return "wins";
  if (fwd) return "wins";
  if (checklistDone >= 1) return "wins";
  if (WIN_KW.test(text)) return "wins";
  return "updates";
}

function buildSummary(entries: any[], max = 2): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const e of entries) {
    const d = (e.description || "").replace(/\s+/g, " ").trim();
    if (!d) continue;
    const k = d.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    parts.push(d);
    if (parts.length >= max) break;
  }
  let out = parts.join("; ");
  if (out.length > 320) out = out.slice(0, 317) + "...";
  return out;
}

async function generateReportHtml(supa: any, tenantId: string, timeframe: "daily" | "weekly", title: string): Promise<string> {
  // The workspace's own words for the two sides of the work.
  const names = await getTenantBranding(tenantId);
  const nowUtc = Date.now();
  const nowIst = new Date(nowUtc + IST_OFFSET_MS);
  const y = nowIst.getUTCFullYear(), m = nowIst.getUTCMonth(), d = nowIst.getUTCDate();
  const istDay = nowIst.getUTCDay();
  const daysSinceMon = (istDay + 6) % 7;
  const startToday = Date.UTC(y, m, d) - IST_OFFSET_MS;
  const startWeek = startToday - daysSinceMon * 86400_000;
  const since = new Date(timeframe === "daily" ? startToday : startWeek).toISOString();
  const until = new Date(nowUtc).toISOString();

  const startLabel = timeframe === "daily"
    ? new Date(Date.UTC(y, m, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : `${new Date(startWeek + IST_OFFSET_MS).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${new Date(Date.UTC(y, m, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  const windowLabel = timeframe === "daily" ? `Today (IST) · ${startLabel}` : `This week (Mon–today IST) · ${startLabel}`;

  // Projects (tenant scope)
  const projects = await fetchAll<any>(supa, "projects", "*", (q) =>
    q.eq("tenant_id", tenantId).eq("archived", false)
  );

  // Activity logs (tenant scope)
  const activityLogs = await fetchAll<any>(supa, "activity_logs",
    "id, entity_id, entity_type, category, action_type, description, metadata, created_at, user_name",
    (q) => q.eq("tenant_id", tenantId).gte("created_at", since).lte("created_at", until)
      .order("created_at", { ascending: false })
  );

  // Project comment logs
  const projectIds = projects.map((p) => p.id);
  const commentLogs = projectIds.length > 0
    ? await fetchAll<any>(supa, "project_comment_logs",
        "id, project_id, field_name, content, author_name, created_at",
        (q) => q.in("project_id", projectIds).gte("created_at", since).lte("created_at", until)
          .order("created_at", { ascending: false }))
    : [];

  // Checklist comments first (bounded by date window), then resolve only their items.
  // Avoids passing 1000+ checklist_item_ids in a .in() URL which fails the request.
  const checklistComments = await fetchAll<any>(supa, "checklist_comments",
    "id, checklist_item_id, comment, user_name, created_at",
    (q) => q.gte("created_at", since).lte("created_at", until)
      .order("created_at", { ascending: false }));
  const neededItemIds = Array.from(new Set(checklistComments.map((c: any) => c.checklist_item_id).filter(Boolean)));
  const items = neededItemIds.length > 0
    ? await fetchAll<any>(supa, "checklist_items", "id, project_id, title",
        (q) => q.in("id", neededItemIds as string[]))
    : [];
  const itemMap: Record<string, { project_id: string; title: string }> = Object.fromEntries(
    items.map((i) => [i.id, { project_id: i.project_id, title: i.title }])
  );

  // Group entries per project
  const entries: Record<string, any[]> = {};
  const push = (pid: string, e: any) => { (entries[pid] ||= []).push(e); };

  for (const l of activityLogs) {
    if (l.entity_type && l.entity_type !== "project") continue;
    const md = l.metadata || {};
    push(l.entity_id, {
      category: l.category,
      actionType: l.action_type,
      description: l.description,
      timestamp: l.created_at,
      changes: Array.isArray(md.changes) ? md.changes : undefined,
    });
  }
  for (const c of commentLogs) push(c.project_id, { category: "comment", description: `Comment on "${c.field_name}": ${c.content}`, timestamp: c.created_at });
  for (const cc of checklistComments) {
    const it = itemMap[cc.checklist_item_id];
    if (!it) continue;
    push(it.project_id, { category: "checklist", description: `Commented on "${it.title}": ${cc.comment}`, timestamp: cc.created_at });
  }

  // For BLOCKED projects (daily), fetch a wider 7-day context window of comments + activity
  // so the blocker reason isn't "no recent update" when nothing happened today.
  const blockedProjectsAll = projects.filter((p) => p.project_state === "blocked");
  const blockedIds = blockedProjectsAll.map((p) => p.id);
  const extendedEntries: Record<string, any[]> = {};
  if (timeframe === "daily" && blockedIds.length > 0) {
    const sevenDaysAgo = new Date(nowUtc - 7 * 86400_000).toISOString();
    const pushExt = (pid: string, e: any) => { (extendedEntries[pid] ||= []).push(e); };

    const [extActivity, extCommentLogs, extChecklistComments] = await Promise.all([
      fetchAll<any>(supa, "activity_logs",
        "id, entity_id, entity_type, category, action_type, description, metadata, created_at, user_name",
        (q) => q.eq("tenant_id", tenantId).in("entity_id", blockedIds)
          .gte("created_at", sevenDaysAgo).lt("created_at", since)
          .order("created_at", { ascending: false })),
      fetchAll<any>(supa, "project_comment_logs",
        "id, project_id, field_name, content, author_name, created_at",
        (q) => q.in("project_id", blockedIds).gte("created_at", sevenDaysAgo).lt("created_at", since)
          .order("created_at", { ascending: false })),
      (async () => {
        // checklist items for blocked projects, then their comments in window
        const blkItems = await fetchAll<any>(supa, "checklist_items", "id, project_id, title",
          (q) => q.in("project_id", blockedIds));
        const itemIds = blkItems.map((i: any) => i.id);
        const blkItemMap: Record<string, { project_id: string; title: string }> =
          Object.fromEntries(blkItems.map((i: any) => [i.id, { project_id: i.project_id, title: i.title }]));
        if (itemIds.length === 0) return [] as any[];
        const cmts = await fetchAll<any>(supa, "checklist_comments",
          "id, checklist_item_id, comment, user_name, created_at",
          (q) => q.in("checklist_item_id", itemIds).gte("created_at", sevenDaysAgo).lt("created_at", since)
            .order("created_at", { ascending: false }));
        return cmts.map((c: any) => ({ ...c, _item: blkItemMap[c.checklist_item_id] }));
      })(),
    ]);

    for (const l of extActivity) {
      if (l.entity_type && l.entity_type !== "project") continue;
      const md = l.metadata || {};
      pushExt(l.entity_id, {
        category: l.category, actionType: l.action_type, description: l.description,
        timestamp: l.created_at, changes: Array.isArray(md.changes) ? md.changes : undefined,
      });
    }
    for (const c of extCommentLogs) pushExt(c.project_id, {
      category: "comment", description: `Comment on "${c.field_name}": ${c.content}`, timestamp: c.created_at,
    });
    for (const cc of extChecklistComments as any[]) {
      if (!cc._item) continue;
      pushExt(cc._item.project_id, {
        category: "checklist", description: `Commented on "${cc._item.title}": ${cc.comment}`, timestamp: cc.created_at,
      });
    }

    // Merge extended context into main entries map for blocked projects (so AI sees both)
    for (const pid of blockedIds) {
      if (extendedEntries[pid]?.length) {
        entries[pid] = [...(entries[pid] || []), ...extendedEntries[pid]];
      }
    }
  }

  // Always run AI summaries BEFORE the email is sent. Each chunk is retried a few
  // times; only after retries are exhausted do we fall back to rule-based lines.
  type AiRes = { id: string; bucket: "wins" | "updates" | "lowlights"; line1: string; line2: string };
  const aiMap: Record<string, AiRes> = {};
  const activeOrBlocked = projects.filter(
    (p) => (entries[p.id]?.length ?? 0) > 0 || p.project_state === "blocked",
  );
  if (LOVABLE_API_KEY && activeOrBlocked.length > 0) {
    const items = activeOrBlocked.map((p) => ({
      id: p.id,
      merchantName: p.merchant_name,
      funnel: funnelLabels[getFunnelStage(p)],
      projectState: stateLabels[p.project_state] || p.project_state,
      arr: formatArr(p.arr),
      egl: formatEgl(p.expected_go_live_date),
      entries: (entries[p.id] || []).slice(0, 30).map((e) => ({
        ts: e.timestamp, category: e.category, description: (e.description || "").slice(0, 400),
      })),
    }));
    const chunk = 12;
    const runChunk = async (slice: any[]) => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-project-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
        body: JSON.stringify({ type: "movement_summary", timeframe, items: slice }),
      });
      if (!res.ok) throw new Error(`ai-project-insights ${res.status}`);
      const data = await res.json();
      for (const r of (data.result || []) as AiRes[]) aiMap[r.id] = r;
    };
    for (let i = 0; i < items.length; i += chunk) {
      const slice = items.slice(i, i + chunk);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await runChunk(slice);
          break;
        } catch (e) {
          console.warn(`AI enrich chunk ${i} attempt ${attempt} failed`, e);
          if (attempt === 3) break;
          await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
    }
    console.log(`AI summaries ready for ${Object.keys(aiMap).length}/${items.length} projects`);
  }


  const isActive = (p: any) => (entries[p.id]?.length ?? 0) > 0;
  const totalActive = projects.filter(isActive).length;
  const totalInactive = projects.length - totalActive;
  const byFunnel = (a: any, b: any) => (funnelRank[getFunnelStage(a)] ?? 99) - (funnelRank[getFunnelStage(b)] ?? 99);

  const renderLine = (p: any) => {
    const ai = aiMap[p.id];
    const fallback = buildSummary(entries[p.id] || [], 2) || "No specific updates captured this period.";
    const funnel = funnelLabels[getFunnelStage(p)];
    const line1 = ai?.line1 || fallback;
    const line2 = ai?.line2 || "";
    return `<div style="padding:10px 0;border-bottom:1px solid #eef3f6;font-size:13px;line-height:1.5;color:#11263b;">
      <div><strong style="font-size:14px;">${escapeHtml(p.merchant_name)}</strong></div>
      <div style="color:#3b5466;font-size:12px;margin:2px 0 6px;">ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.expected_go_live_date))}</strong> &nbsp;|&nbsp; ${escapeHtml(funnel)} · ${escapeHtml(stateLabels[p.project_state] || p.project_state)}</div>
      <div>${escapeHtml(line1)}</div>
      ${line2 ? `<div style="color:#3b5466;margin-top:2px;">${escapeHtml(line2)}</div>` : ""}
    </div>`;
  };

  let html = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#11263b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 14px;color:#546978;font-size:12px;">${escapeHtml(windowLabel)} · Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}</p>`;
  html += `<div style="background:#eef3f6;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:20px;">
    <strong>${projects.length}</strong> projects · <strong style="color:#116958;">${totalActive}</strong> Active · <strong style="color:#546978;">${totalInactive}</strong> Inactive
  </div>`;

  if (timeframe === "daily") {
    // BLOCKED section — surfaced first, highlighted red. Only true 'blocked' state (on_hold stays in normal funnel).
    const blockedProjects = projects.filter((p) => p.project_state === "blocked");
    if (blockedProjects.length > 0) {
      // Fetch next-incomplete checklist item per blocked project (for "what's needed to unblock")
      const blkIds = blockedProjects.map((p) => p.id);
      const blockedItems = await fetchAll<any>(
        supa,
        "checklist_items",
        "id, project_id, title, completed, sort_order, is_task",
        (q) => q.in("project_id", blkIds).eq("completed", false).eq("is_task", false).order("sort_order", { ascending: true }),
      );
      const nextItemByProject: Record<string, string> = {};
      for (const it of blockedItems) {
        if (!nextItemByProject[it.project_id]) nextItemByProject[it.project_id] = it.title;
      }

      // "Blocked on whom" — current responsibility + assigned owner name
      const responsibilityLabel = (r: any): string => {
        const v = String(r || "").toLowerCase();
        if (v === "gokwik") return names.internalLabel;
        if (v === "merchant") return names.externalLabel;
        if (v === "neutral") return "Neutral";
        return "—";
      };

      html += `<div style="margin-bottom:26px;border:2px solid #ad1f1f;border-radius:8px;overflow:hidden;">
        <h2 style="font-size:14px;margin:0;padding:10px 14px;background:#ad1f1f;color:#ffffff;">
          Blocked · ${blockedProjects.length} project${blockedProjects.length === 1 ? "" : "s"} — needs attention
        </h2>
        <div style="padding:6px 14px 12px;background:#fdecec;">`;
      for (const p of blockedProjects) {
        const ai = aiMap[p.id];
        const blockerLine =
          ai?.line1 ||
          buildSummary(entries[p.id] || [], 1) ||
          "No recent update — reason for block not captured.";
        const unblockNeeded = ai?.line2 || nextItemByProject[p.id] || "Confirm next checklist step with owner.";
        const owner = p.assigned_owner_name || p.assigned_owner || "Unassigned";
        const respSide = responsibilityLabel(p.current_responsibility);
        html += `<div style="padding:10px 0;border-bottom:1px solid #f3c4c4;font-size:13px;line-height:1.5;color:#11263b;">
          <div><strong style="font-size:14px;color:#8f1a1a;">${escapeHtml(p.merchant_name)}</strong>
            <span style="color:#8f1a1a;font-size:11px;margin-left:6px;">${escapeHtml(funnelLabels[getFunnelStage(p)])} · ${escapeHtml(stateLabels[p.project_state] || p.project_state)}</span>
          </div>
          <div style="color:#3b5466;font-size:12px;margin:2px 0 6px;">
            ARR: <strong>${escapeHtml(formatArr(p.arr))}</strong> &nbsp;|&nbsp; EGL: <strong>${escapeHtml(formatEgl(p.expected_go_live_date))}</strong>
          </div>
          <div><span style="color:#8f1a1a;font-weight:600;">Blocked on:</span> ${escapeHtml(respSide)} &middot; Owner: <strong>${escapeHtml(owner)}</strong></div>
          <div style="margin-top:2px;"><span style="color:#8f1a1a;font-weight:600;">Blocker:</span> ${escapeHtml(blockerLine)}</div>
          <div style="margin-top:2px;"><span style="color:#116958;font-weight:600;">To unblock:</span> ${escapeHtml(unblockNeeded)}</div>
        </div>`;
      }
      html += `</div></div>`;
    }

    // Funnel-wise layout (skip 'blocked' — already shown above; on_hold still renders here)
    for (const stage of FUNNEL_ORDER) {
      const list = projects.filter(
        (p) => getFunnelStage(p) === stage && p.project_state !== "blocked",
      );
      if (list.length === 0) continue;
      const activeList = list.filter(isActive);
      const inactiveList = list.filter((p) => !isActive(p));
      html += `<div style="margin-bottom:26px;">
        <h2 style="font-size:14px;margin:0 0 10px;padding:8px 12px;background:#1d3a5c;color:#ffffff;border-radius:4px;">
          ${escapeHtml(funnelLabels[stage])} · ${list.length} projects · ${activeList.length} Active / ${inactiveList.length} Inactive
        </h2>`;
      if (activeList.length > 0) {
        html += activeList.map(renderLine).join("");
      } else {
        html += `<p style="color:#546978;font-size:12px;margin:0 0 6px;">No movement this period.</p>`;
      }
      if (inactiveList.length > 0) {
        html += `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #d5e0e6;font-size:12px;color:#546978;">
          <strong style="color:#546978;">Inactive (${inactiveList.length}):</strong> ${inactiveList.map((p) => escapeHtml(p.merchant_name)).join(", ")}
        </div>`;
      }
      html += `</div>`;
    }
  } else {
    // Weekly: Wins / Updates / Lowlights — deterministic classification, sort by ARR desc
    const buckets: Record<string, any[]> = { wins: [], updates: [], lowlights: [] };
    for (const p of projects) {
      const bucket = classify(p, entries[p.id] || []);
      buckets[bucket].push(p);
    }
    const byArrDesc = (a: any, b: any) => (Number(b.arr) || 0) - (Number(a.arr) || 0);
    buckets.wins.sort(byArrDesc); buckets.updates.sort(byArrDesc); buckets.lowlights.sort(byArrDesc);

    const section = (label: string, color: string, list: any[], emptyText: string) => {
      const body = list.length === 0
        ? `<p style="color:#546978;font-size:12px;margin:0;">${emptyText}</p>`
        : list.map(renderLine).join("");
      return `<div style="margin-bottom:24px;">
        <h2 style="font-size:15px;margin:0 0 8px;padding:6px 10px;background:${color};color:#ffffff;border-radius:4px;display:inline-block;">${label} (${list.length})</h2>
        ${body}
      </div>`;
    };
    html += section("Wins", "#116958", buckets.wins, "No new wins this period.");
    html += section("Updates", "#24598a", buckets.updates, "No active updates this period.");
    html += section("Lowlights", "#ad1f1f", buckets.lowlights, "No lowlights this period.");
  }

  html += `</div>`;
  return html;
}

async function sendOne(supa: any, schedule: any): Promise<{ ok: boolean; error?: string }> {
  const __creds = await getTenantIntegrations(schedule.tenant_id);
  const RESEND_API_KEY = requireCred(__creds, "resend_api_key", "Resend email");
  const exec = await supa.from("movement_report_executions").insert({
    schedule_id: schedule.id,
    tenant_id: schedule.tenant_id,
    status: "sending",
    recipients: schedule.recipients,
  }).select().single();
  const execId = exec.data?.id;

  try {
    if (!schedule.recipients?.length) throw new Error("No recipients");
    const title = `${schedule.timeframe === "daily" ? "Daily" : "Weekly"} Movement Report`;
    const subject = `${schedule.subject_prefix ? schedule.subject_prefix + " " : ""}${title} — ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`;
    const html = await generateReportHtml(supa, schedule.tenant_id, schedule.timeframe, title);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: resendFrom(__creds, "MINT Updates"),
        ...resendReplyTo(__creds),
        to: schedule.recipients,
        bcc: ["custom_mint_sales-aaaaumgxqqu5dozs2yxm5ul62e@gokwik.slack.com"],
        subject,
        html,
      }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.message || "Resend failed");

    await supa.from("movement_report_executions").update({
      status: "success", email_count: schedule.recipients.length, completed_at: new Date().toISOString(),
    }).eq("id", execId);
    await supa.from("movement_report_schedules").update({ last_sent_at: new Date().toISOString() }).eq("id", schedule.id);
    return { ok: true };
  } catch (e: any) {
    await supa.from("movement_report_executions").update({
      status: "failed", error_message: String(e?.message || e), completed_at: new Date().toISOString(),
    }).eq("id", execId);
    return { ok: false, error: String(e?.message || e) };
  }
}

function isDue(schedule: any, nowIst: Date): boolean {
  if (!schedule.enabled) return false;
  const [hh, mm] = (schedule.time_ist || "09:00").split(":").map(Number);
  if (nowIst.getUTCHours() !== hh || nowIst.getUTCMinutes() !== mm) return false;
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = dowNames[nowIst.getUTCDay()];
  if (schedule.timeframe === "daily") {
    if (!schedule.days?.includes(today)) return false;
  } else {
    // weekly: send on the configured day(s); default Mon
    if (!schedule.days?.includes(today)) return false;
  }
  // Skip if already sent within last 5 minutes
  if (schedule.last_sent_at) {
    const last = new Date(schedule.last_sent_at).getTime();
    if (Date.now() - last < 5 * 60 * 1000) return false;
  }
  return true;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch { /* cron may send empty */ }

    // Manual trigger
    if (body.schedule_id) {
      const { data: s, error } = await supa.from("movement_report_schedules").select("*").eq("id", body.schedule_id).single();
      if (error || !s) throw new Error(error?.message || "Schedule not found");
      const r = await sendOne(supa, s);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cron tick: find all due schedules
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    const { data: schedules } = await supa.from("movement_report_schedules").select("*").eq("enabled", true);
    const due = (schedules || []).filter((s: any) => isDue(s, nowIst));
    const results = await Promise.all(due.map((s: any) => sendOne(supa, s)));
    return new Response(JSON.stringify({ processed: due.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-scheduled-movement-report error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/send-scheduled-movement-report")({
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
