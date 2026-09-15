import { createFileRoute } from "@tanstack/react-router";
import { buddyCaller, corsHeaders, json, todayIso } from "@/lib/buddy/scope.server";
import { loadBuddySettings } from "@/lib/buddy/settings.server";

/**
 * The daily brief and project-page suggestions.
 *
 * Computed straight from the database, without the model, so it's fast, cheap
 * and matches what the dashboards show. Scope follows the same rule as Buddy:
 * the whole workspace for portfolio roles, assigned projects otherwise.
 *
 * Definitions:
 *   overdue item   checklist item not done with a due date before today
 *   blocked        project state "blocked"
 *   go-live week   expected go-live between today and 7 days from now, not live
 *   stalled        in progress with no checklist completion, note or project
 *                  update for 7 days
 */

type Tone = "bad" | "warn" | "info" | "ok";

interface BriefItem {
  tone: Tone;
  project_id: string;
  merchant: string;
  title: string;
  detail: string;
  action: { label: string; prompt: string; draft?: boolean };
}

const DAY = 86_400_000;
const NEXT_TEAM: Record<string, string> = { mint: "Integration", integration: "Merchant Success" };

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const caller = await buddyCaller(req);
  if (!caller) return json({ error: "Sign in again to use Buddy." }, 401, corsHeaders);

  const body = (await req.json().catch(() => ({}))) as { project_id?: string };
  const settings = await loadBuddySettings(caller);
  const today = todayIso();
  const now = Date.now();
  const c = caller.client;

  // ── One project: suggestions for the drawer on a project page ───────────
  if (body.project_id) {
    const { data: projectRow } = await c
      .from("projects")
      .select("id, merchant_name, assigned_owner, current_owner_team, project_state, expected_go_live_date, contact_email")
      .eq("tenant_id", caller.tenantId)
      .eq("id", body.project_id)
      .maybeSingle();
    const p = projectRow as any;
    if (!p || (!caller.portfolio && p.assigned_owner !== caller.userId)) {
      return json({ summary: null, suggestions: [] }, 200, corsHeaders);
    }

    const [items, meetings, risks] = await Promise.all([
      c.from("checklist_items").select("completed, due_date, current_responsibility, owner_team").eq("tenant_id", caller.tenantId).eq("project_id", p.id),
      c.from("checklist_meetings").select("title, scheduled_at, status, analysis_status").eq("tenant_id", caller.tenantId).eq("project_id", p.id).order("scheduled_at", { ascending: false }).limit(10),
      c.from("project_risks").select("id").eq("tenant_id", caller.tenantId).eq("project_id", p.id).in("status", ["open", "mitigating"]),
    ]);
    const list = (items.data || []) as any[];
    const overdue = list.filter((i) => !i.completed && i.due_date && i.due_date < today);
    const merchantOverdue = overdue.filter((i) => i.current_responsibility === "merchant").length;
    const teamItems = list.filter((i) => i.owner_team === p.current_owner_team);
    const teamDone = teamItems.length > 0 && teamItems.every((i) => i.completed);
    const meetingRows = (meetings.data || []) as any[];
    const upcoming = meetingRows
      .filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() > now && new Date(m.scheduled_at).getTime() < now + 3 * DAY)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    const recent = meetingRows.find((m) => m.analysis_status === "done" && now - new Date(m.scheduled_at).getTime() < 7 * DAY);
    const riskCount = (risks.data || []).length;

    const parts: string[] = [];
    if (overdue.length) parts.push(`${overdue.length} overdue item${overdue.length === 1 ? "" : "s"}${merchantOverdue ? `, ${merchantOverdue} with the merchant` : ""}`);
    if (riskCount) parts.push(`${riskCount} open risk${riskCount === 1 ? "" : "s"}`);
    if (upcoming) parts.push(`next meeting ${shortDate(upcoming.scheduled_at)}`);
    if (p.expected_go_live_date) parts.push(`go-live ${shortDate(p.expected_go_live_date)}`);

    const suggestions: { label: string; prompt: string; draft?: boolean }[] = [];
    if (overdue.length) suggestions.push({ label: "Why is this slipping?", prompt: "Why is this project slipping, and what should I do today?" });
    if (merchantOverdue && caller.canAct && p.contact_email) {
      suggestions.push({ label: "Draft a follow-up to the merchant", prompt: "Draft a follow-up email to the merchant contact about the overdue items on this project." });
    }
    if (upcoming) suggestions.push({ label: `Prep for "${upcoming.title}"`, prompt: "Prepare me for the next meeting on this project: open questions, what's overdue and who holds it." });
    if (recent) suggestions.push({ label: "Recap the last meeting", prompt: "Recap the last meeting on this project and list the follow-ups with owners." });
    if (teamDone && NEXT_TEAM[p.current_owner_team]) {
      suggestions.push({ label: "Write a handover summary", prompt: `Write a handover summary of this project for the ${NEXT_TEAM[p.current_owner_team]} team.` });
      if (caller.canAct) suggestions.push({ label: `Transfer to ${NEXT_TEAM[p.current_owner_team]}`, prompt: `Transfer this project to ${NEXT_TEAM[p.current_owner_team]} with a short handover note.` });
    }
    suggestions.push({ label: "Summarise this project", prompt: "Summarise this project." });

    return json({ summary: parts.join(" · ") || null, suggestions: suggestions.slice(0, 5) }, 200, corsHeaders);
  }

  // ── Daily brief ─────────────────────────────────────────────────────────
  if (!settings.brief_enabled) return json({ enabled: false }, 200, corsHeaders);

  let q = c
    .from("projects")
    .select("id, merchant_name, project_state, current_owner_team, expected_go_live_date, updated_at, contact_email")
    .eq("tenant_id", caller.tenantId)
    .eq("archived", false)
    .neq("project_state", "live");
  if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);
  const { data: projectRows } = await q.limit(2000);
  const projects = (projectRows || []) as any[];
  const ids = projects.map((p) => p.id);

  const perProject = new Map<string, { overdue: number; merchantOverdue: number; open: number; lastDone: number; teamOpen: number }>();
  const lastNote = new Map<string, number>();
  if (ids.length) {
    const teamOf = new Map(projects.map((p) => [p.id, p.current_owner_team]));
    for (const id of ids) perProject.set(id, { overdue: 0, merchantOverdue: 0, open: 0, lastDone: 0, teamOpen: 0 });
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await c
        .from("checklist_items")
        .select("project_id, completed, completed_at, due_date, current_responsibility, owner_team")
        .eq("tenant_id", caller.tenantId)
        .in("project_id", ids)
        .range(from, from + PAGE - 1);
      for (const i of (data || []) as any[]) {
        const s = perProject.get(i.project_id);
        if (!s) continue;
        if (i.completed) {
          if (i.completed_at) s.lastDone = Math.max(s.lastDone, new Date(i.completed_at).getTime());
        } else {
          s.open++;
          if (i.owner_team === teamOf.get(i.project_id)) s.teamOpen++;
          if (i.due_date && i.due_date < today) {
            s.overdue++;
            if (i.current_responsibility === "merchant") s.merchantOverdue++;
          }
        }
      }
      if (!data || data.length < PAGE) break;
    }
    const { data: notes } = await c
      .from("project_comment_logs")
      .select("project_id, created_at")
      .eq("tenant_id", caller.tenantId)
      .in("project_id", ids)
      .gte("created_at", new Date(now - 30 * DAY).toISOString())
      .limit(5000);
    for (const n of (notes || []) as any[]) {
      lastNote.set(n.project_id, Math.max(lastNote.get(n.project_id) || 0, new Date(n.created_at).getTime()));
    }
  }

  const weekEnd = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const lastActivity = (p: any) => {
    const s = perProject.get(p.id);
    return Math.max(new Date(p.updated_at || 0).getTime(), s?.lastDone || 0, lastNote.get(p.id) || 0);
  };

  const blocked = projects.filter((p) => p.project_state === "blocked");
  const goLives = projects.filter((p) => p.expected_go_live_date && p.expected_go_live_date >= today && p.expected_go_live_date <= weekEnd);
  const stalled = projects.filter((p) => p.project_state === "in_progress" && now - lastActivity(p) > 7 * DAY);
  const overdueTotal = Array.from(perProject.values()).reduce((a, s) => a + s.overdue, 0);

  const items: BriefItem[] = [];
  const used = new Set<string>();
  const push = (item: BriefItem) => {
    if (items.length >= 5 || used.has(item.project_id)) return;
    used.add(item.project_id);
    items.push(item);
  };

  for (const p of blocked) {
    const s = perProject.get(p.id)!;
    push({
      tone: "bad",
      project_id: p.id,
      merchant: p.merchant_name,
      title: `${p.merchant_name} is blocked`,
      detail: `${s.open} open checklist item${s.open === 1 ? "" : "s"}${s.overdue ? `, ${s.overdue} overdue` : ""}.`,
      action: { label: "Ask what's blocking it", prompt: `Why is ${p.merchant_name} blocked, and what would unblock it?` },
    });
  }
  for (const p of [...projects].sort((a, b) => (perProject.get(b.id)?.merchantOverdue || 0) - (perProject.get(a.id)?.merchantOverdue || 0))) {
    const s = perProject.get(p.id)!;
    if (s.merchantOverdue < 1) break;
    push({
      tone: "bad",
      project_id: p.id,
      merchant: p.merchant_name,
      title: `${p.merchant_name}: ${s.merchantOverdue} merchant item${s.merchantOverdue === 1 ? "" : "s"} overdue`,
      detail: p.expected_go_live_date ? `Go-live is ${shortDate(p.expected_go_live_date)}.` : "No go-live date set.",
      action: caller.canAct && p.contact_email
        ? { label: "Draft follow-up", prompt: `Draft a follow-up email to the merchant contact for ${p.merchant_name} about their overdue checklist items.` }
        : { label: "See what's overdue", prompt: `What's overdue on ${p.merchant_name}, and who holds each item?` },
    });
  }
  for (const p of goLives.sort((a, b) => a.expected_go_live_date.localeCompare(b.expected_go_live_date))) {
    const s = perProject.get(p.id)!;
    push({
      tone: "info",
      project_id: p.id,
      merchant: p.merchant_name,
      title: `${p.merchant_name}: go-live ${shortDate(p.expected_go_live_date)}`,
      detail: s.open ? `${s.open} checklist item${s.open === 1 ? "" : "s"} still open.` : "Checklist complete.",
      action: { label: "Check readiness", prompt: `Is ${p.merchant_name} ready to go live on ${p.expected_go_live_date}? What's left and who holds it?` },
    });
  }
  for (const p of stalled) {
    const days = Math.floor((now - lastActivity(p)) / DAY);
    push({
      tone: "warn",
      project_id: p.id,
      merchant: p.merchant_name,
      title: `${p.merchant_name}: no activity for ${days} days`,
      detail: "In progress, but nothing has moved.",
      action: caller.canAct
        ? { label: "Nudge the owner", prompt: `Send a notification to the owner of ${p.merchant_name} asking for a status update.` }
        : { label: "Ask what's next", prompt: `What's the next step on ${p.merchant_name}?` },
    });
  }
  for (const p of projects) {
    const s = perProject.get(p.id)!;
    if (s.teamOpen === 0 && s.open > 0 && NEXT_TEAM[p.current_owner_team]) {
      push({
        tone: "ok",
        project_id: p.id,
        merchant: p.merchant_name,
        title: `${p.merchant_name}: ready to hand over to ${NEXT_TEAM[p.current_owner_team]}`,
        detail: "This team's checklist is complete.",
        action: { label: "Write handover summary", prompt: `Write a handover summary of ${p.merchant_name} for the ${NEXT_TEAM[p.current_owner_team]} team.` },
      });
    }
  }

  return json(
    {
      enabled: true,
      date: today,
      first_name: caller.name.split(" ")[0],
      scope_label: caller.portfolio ? `${projects.length} active projects` : `your ${projects.length} projects`,
      counts: { overdue: overdueTotal, blocked: blocked.length, go_lives: goLives.length, stalled: stalled.length },
      items,
    },
    200,
    corsHeaders,
  );
}

export const Route = createFileRoute("/api/public/buddy-brief")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
