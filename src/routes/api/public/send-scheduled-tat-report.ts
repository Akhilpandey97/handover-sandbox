import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, requireCred, resendFrom, resendReplyTo, type TenantIntegrations } from "@/lib/tenant-integrations.server";

// Dispatches scheduled TAT (Turn-around Time) reports.
// Triggered by pg_cron every minute, or manually with { schedule_id } to send immediately.
import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 86400_000;

const escapeHtml = (s: string) =>
  (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const diffDays = (from: string, to: string) => {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
};

const networkDays = (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

const monthKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};
const quarterKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`;
};

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

function buildReport(projects: any[], granularity: "monthly" | "quarterly") {
  const map = new Map<string, any>();
  for (const p of projects) {
    const kick = p.kick_off_date;
    const live = p.go_live_date;
    if (!kick || !live) continue;
    const key = granularity === "monthly" ? monthKey(live) : quarterKey(live);
    const label = granularity === "monthly" ? monthLabel(key) : key;
    const row = {
      id: p.id,
      merchant: p.merchant_name,
      platform: p.platform || "—",
      arr: (() => { const n = Number(p.arr) || 0; return Math.abs(n) >= 100000 ? n / 1e7 : n; })(),
      kickOff: kick,
      goLive: live,
      tat: diffDays(kick, live),
      netDays: networkDays(kick, live),
    };
    const g = map.get(key) || { key, label, rows: [], totalArr: 0, avgTat: 0, avgNet: 0 };
    g.rows.push(row);
    map.set(key, g);
  }
  const groups = Array.from(map.values())
    .map((g) => {
      const n = g.rows.length;
      const totalArr = g.rows.reduce((s: number, r: any) => s + r.arr, 0);
      const avgTat = n ? g.rows.reduce((s: number, r: any) => s + r.tat, 0) / n : 0;
      const avgNet = n ? g.rows.reduce((s: number, r: any) => s + r.netDays, 0) / n : 0;
      return { ...g, totalArr, avgTat, avgNet, rows: g.rows.sort((a: any, b: any) => b.tat - a.tat) };
    })
    .sort((a: any, b: any) => b.key.localeCompare(a.key));

  const rows = groups.flatMap((g: any) => g.rows);
  const n = rows.length;
  const overall = {
    count: n,
    avgTat: n ? rows.reduce((s: number, r: any) => s + r.tat, 0) / n : 0,
    avgNet: n ? rows.reduce((s: number, r: any) => s + r.netDays, 0) / n : 0,
    totalArr: rows.reduce((s: number, r: any) => s + r.arr, 0),
  };
  return { groups, overall };
}

function renderHtml(title: string, granularity: "monthly" | "quarterly", data: ReturnType<typeof buildReport>) {
  const th = `background:#eef3f6;padding:8px 10px;text-align:left;font-size:12px;color:#3b5466;border-bottom:1px solid #c3d1d9;`;
  const td = `padding:8px 10px;font-size:13px;color:#11263b;border-bottom:1px solid #d5e0e6;`;
  let html = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;color:#11263b;">`;
  html += `<h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(title)}</h1>`;
  html += `<p style="margin:0 0 14px;color:#546978;font-size:12px;">Grouped by ${granularity} · Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST</p>`;
  html += `<div style="background:#eef3f6;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:20px;display:flex;gap:16px;flex-wrap:wrap;">
    <div><strong>${data.overall.count}</strong> Live merchants</div>
    <div>Total ARR: <strong>${data.overall.totalArr.toFixed(3)} Cr</strong></div>
    <div>Avg TAT: <strong>${data.overall.avgTat.toFixed(2)} days</strong></div>
    <div>Avg Network TAT: <strong>${data.overall.avgNet.toFixed(2)} days</strong></div>
  </div>`;

  if (data.groups.length === 0) {
    html += `<p style="color:#546978;">No projects with both Kick-off and Go-Live dates.</p>`;
  }

  for (const g of data.groups) {
    html += `<h2 style="font-size:15px;margin:18px 0 6px;">${escapeHtml(g.label)}
      <span style="font-weight:normal;color:#546978;font-size:12px;">
        · ${g.rows.length} merchants · Avg TAT ${g.avgTat.toFixed(2)}d · Avg Network ${g.avgNet.toFixed(2)}d
      </span></h2>`;
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <thead><tr>
        <th style="${th}">#</th>
        <th style="${th}">Merchant</th>
        <th style="${th}">Platform</th>
        <th style="${th};text-align:right;">ARR</th>
        <th style="${th}">Kickoff</th>
        <th style="${th}">Actual Go-Live</th>
        <th style="${th};text-align:right;">TAT (days)</th>
        <th style="${th};text-align:right;">TAT (network)</th>
      </tr></thead><tbody>`;
    g.rows.forEach((r: any, i: number) => {
      html += `<tr>
        <td style="${td};color:#546978;">${i + 1}</td>
        <td style="${td};font-weight:600;">${escapeHtml(r.merchant)}</td>
        <td style="${td}">${escapeHtml(r.platform)}</td>
        <td style="${td};text-align:right;">${r.arr}</td>
        <td style="${td}">${escapeHtml(r.kickOff)}</td>
        <td style="${td}">${escapeHtml(r.goLive)}</td>
        <td style="${td};text-align:right;font-weight:600;">${r.tat}</td>
        <td style="${td};text-align:right;">${r.netDays}</td>
      </tr>`;
    });
    html += `<tr style="background:#f7fafc;">
      <td colspan="3" style="${td};font-weight:700;">Total</td>
      <td style="${td};text-align:right;font-weight:700;">${g.totalArr.toFixed(3)}</td>
      <td colspan="2" style="${td};text-align:right;font-weight:700;">Average TAT</td>
      <td style="${td};text-align:right;font-weight:700;">${g.avgTat.toFixed(2)}</td>
      <td style="${td};text-align:right;font-weight:700;">${g.avgNet.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table>`;
  }

  html += `<p style="color:#546978;font-size:11px;margin-top:24px;">Automated TAT report from MINT.</p>`;
  html += `</div>`;
  return html;
}

async function sendEmail(subject: string, html: string, recipients: string[], RESEND_API_KEY: string, creds: TenantIntegrations) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom(creds),
      ...resendReplyTo(creds),
      to: recipients,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend failed [${res.status}]: ${text}`);
  }
  return res.json();
}

async function runSchedule(supa: any, schedule: any) {
  const projects = await fetchAll<any>(
    supa,
    "projects",
    "id, merchant_name, platform, arr, kick_off_date, go_live_date, project_state, tenant_id",
    (q) => q.eq("tenant_id", schedule.tenant_id).eq("project_state", "live"),
  );
  const data = buildReport(projects, schedule.granularity);
  const title = schedule.name || "TAT Report";
  const html = renderHtml(title, schedule.granularity, data);
  const subject = `${schedule.subject_prefix ? schedule.subject_prefix + " " : ""}${title} — ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })}`;
  const creds = await getTenantIntegrations(schedule.tenant_id);
  const resendKey = requireCred(creds, "resend_api_key", "Resend email");
  await sendEmail(subject, html, schedule.recipients, resendKey, creds);
  await supa.from("tat_report_schedules").update({ last_sent_at: new Date().toISOString() }).eq("id", schedule.id);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const scheduleId = body?.schedule_id as string | undefined;

    if (scheduleId) {
      const { data: sched, error } = await supa.from("tat_report_schedules").select("*").eq("id", scheduleId).maybeSingle();
      if (error || !sched) throw new Error(error?.message || "Schedule not found");
      await runSchedule(supa, sched);
      return new Response(JSON.stringify({ ok: true, sent: 1 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cron path: find schedules matching current IST time/day
    const nowUtc = Date.now();
    const nowIst = new Date(nowUtc + IST_OFFSET_MS);
    const hhmm = `${String(nowIst.getUTCHours()).padStart(2, "0")}:${String(nowIst.getUTCMinutes()).padStart(2, "0")}`;
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][nowIst.getUTCDay()];

    const { data: schedules, error } = await supa
      .from("tat_report_schedules")
      .select("*")
      .eq("enabled", true)
      .eq("time_ist", hhmm);
    if (error) throw error;

    const due = (schedules || []).filter((s: any) => Array.isArray(s.days) && s.days.includes(dayName));
    let sent = 0;
    for (const s of due) {
      try {
        await runSchedule(supa, s);
        sent++;
      } catch (e) {
        console.error("TAT schedule failed", s.id, e);
      }
    }
    return new Response(JSON.stringify({ ok: true, sent, checked: due.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-scheduled-tat-report error", e);
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/send-scheduled-tat-report")({
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
