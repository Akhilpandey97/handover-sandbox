import { createFileRoute } from "@tanstack/react-router";
import { STATE_LABELS, buddyCaller, corsHeaders, json, todayIso, type BuddyCaller } from "@/lib/buddy/scope.server";
import { loadBuddySettings } from "@/lib/buddy/settings.server";
import {
  RISK_SETTINGS_KEY,
  evaluateRisk,
  parseRiskRules,
  withManualRisks,
  type RiskFinding,
  type RiskSeverity,
  type RiskVerdict,
} from "@/data/riskRules";
import { sumArrCrore } from "@/lib/arr";
import { setupOverview } from "@/lib/buddy/setup-read.server";
import { EGL_SETTINGS_KEY, describeEglRisk, evaluateEglRisk, isInWindow, parseEglRules, type EglRiskVerdict } from "@/data/eglRisk";

/**
 * The daily brief and project-page suggestions.
 *
 * Computed straight from the database, without the model, so it's fast, cheap
 * and says what the dashboard says. It runs the dashboard's own engines with
 * the workspace's saved rules, so a project flagged on one is flagged on the
 * other:
 *   needs attention   Risk Rules verdict is high, manual risks included
 *                     (the "Projects Needing Attention" dashlet)
 *   go-live at risk   expected go-live in this Monday–Sunday week and the EGL
 *                     rules fire (the EGL dashlet's "This week" tab)
 *   blocked           project state "blocked" (the KPI bar)
 *   overdue items     open checklist items due before today
 *
 * Scope follows the same rule as Buddy: the whole workspace for portfolio
 * roles, assigned projects otherwise. Archived projects are never counted.
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
const MAX_ITEMS = 5;

/** Same handoff order as TransferDialog; no other transfer exists in the app. */
const NEXT_TEAM: Record<string, string> = { mint: "integration", integration: "ms" };
/** useTeams' fallback names, used until a workspace saves its own. */
const DEFAULT_TEAM_NAMES: Record<string, string> = { mint: "Sales", integration: "MINT", ms: "Merchant Success" };

const SEVERITY_RANK: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

const stateName = (state: string) => (STATE_LABELS[state] || state.replace(/_/g, " ")).toLowerCase();

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

async function loadSetting(caller: BuddyCaller, key: string): Promise<string | null> {
  const { data } = await caller.client
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

async function loadTeamNames(caller: BuddyCaller): Promise<Record<string, string>> {
  const { data } = await caller.client.from("teams").select("slug, name").eq("tenant_id", caller.tenantId);
  const names = { ...DEFAULT_TEAM_NAMES };
  for (const t of (data || []) as { slug: string; name: string }[]) if (t.name) names[t.slug] = t.name;
  return names;
}

/** Latest checklist comment per project — the dashboard's activity signal. */
async function loadLastActivity(caller: BuddyCaller): Promise<Map<string, string>> {
  const { data } = await caller.client.rpc("project_last_activity" as never, { _tenant_id: caller.tenantId } as never);
  const map = new Map<string, string>();
  for (const row of (data || []) as { project_id: string; last_comment_at: string }[]) {
    if (row.last_comment_at) map.set(row.project_id, row.last_comment_at);
  }
  return map;
}

/** The finding that decides an item's wording: worst severity, rules before manual risks. */
const leadFinding = (verdict: RiskVerdict): RiskFinding =>
  [...verdict.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];

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

    const [items, meetings, risks, teamNames] = await Promise.all([
      c.from("checklist_items").select("completed, due_date, current_responsibility, owner_team").eq("tenant_id", caller.tenantId).eq("project_id", p.id),
      c.from("checklist_meetings").select("title, scheduled_at, status, analysis_status").eq("tenant_id", caller.tenantId).eq("project_id", p.id).order("scheduled_at", { ascending: false }).limit(10),
      c.from("project_risks").select("id").eq("tenant_id", caller.tenantId).eq("project_id", p.id).in("status", ["open", "mitigating"]),
      loadTeamNames(caller),
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
    const nextTeam = NEXT_TEAM[p.current_owner_team];
    if (teamDone && nextTeam) {
      const nextName = teamNames[nextTeam];
      suggestions.push({ label: "Write a handover summary", prompt: `Write a handover summary of this project for the ${nextName} team.` });
      if (caller.canAct) suggestions.push({ label: `Transfer to ${nextName}`, prompt: `Transfer this project to ${nextName} with a short handover note.` });
    }
    suggestions.push({ label: "Summarise this project", prompt: "Summarise this project." });

    return json({ summary: parts.join(" · ") || null, suggestions: suggestions.slice(0, 5) }, 200, corsHeaders);
  }

  // ── Daily brief ─────────────────────────────────────────────────────────
  // People who can change settings see how far workspace setup has got, so an
  // unfinished workspace invites them to onboard it.
  const setup = caller.canAct
    ? await setupOverview(caller)
        .then((o) => ({ set_up: o.progress.set_up, total: o.progress.total }))
        .catch(() => null)
    : null;
  if (!settings.brief_enabled) return json({ enabled: false, setup }, 200, corsHeaders);

  // Live projects stay in the query: the dashboard counts them in its totals.
  let q = c
    .from("projects")
    .select("id, merchant_name, project_state, current_owner_team, expected_go_live_date, expected_go_live_is_manual, updated_at, contact_email, pending_acceptance, assigned_owner, arr")
    .eq("tenant_id", caller.tenantId)
    .eq("archived", false);
  if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);

  const [{ data: projectRows }, riskRaw, eglRaw, lastActivity, teamNames] = await Promise.all([
    q.limit(2000),
    loadSetting(caller, RISK_SETTINGS_KEY),
    loadSetting(caller, EGL_SETTINGS_KEY),
    loadLastActivity(caller),
    loadTeamNames(caller),
  ]);
  const projects = (projectRows || []) as any[];
  const ids = projects.map((p) => p.id);
  const riskRules = parseRiskRules(riskRaw);
  const eglRules = parseEglRules(eglRaw);

  type Item = { completed: boolean; dueDate: string | null; isTask: boolean; merchant: boolean; ownerTeam: string };
  const checklists = new Map<string, Item[]>(ids.map((id) => [id, []]));
  const manualRisks = new Map<string, { id: string; title: string; severity: string }[]>();
  if (ids.length) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await c
        .from("checklist_items")
        .select("id, project_id, completed, due_date, is_task, current_responsibility, owner_team")
        .eq("tenant_id", caller.tenantId)
        .in("project_id", ids)
        .order("id")
        .range(from, from + PAGE - 1);
      for (const i of (data || []) as any[]) {
        checklists.get(i.project_id)?.push({
          completed: !!i.completed,
          dueDate: i.due_date ?? null,
          isTask: !!i.is_task,
          merchant: i.current_responsibility === "merchant",
          ownerTeam: (i.owner_team || "mint").toLowerCase(),
        });
      }
      if (!data || data.length < PAGE) break;
    }
    // Only hand-raised risks count, exactly as useProjectRiskVerdicts folds them in.
    const { data: risks } = await c
      .from("project_risks")
      .select("id, project_id, title, severity, trigger_type")
      .eq("tenant_id", caller.tenantId)
      .in("project_id", ids)
      .in("status", ["open", "mitigating"]);
    for (const r of (risks || []) as any[]) {
      if (r.trigger_type && r.trigger_type !== "manual") continue;
      const list = manualRisks.get(r.project_id) || [];
      list.push({ id: r.id, title: r.title, severity: r.severity });
      manualRisks.set(r.project_id, list);
    }
  }

  const nowDate = new Date(now);
  const rows = projects.map((p) => {
    const checklist = checklists.get(p.id) || [];
    const base = {
      projectState: p.project_state || "not_started",
      expectedGoLiveDate: p.expected_go_live_date ?? null,
      expectedGoLiveDateIsDerived: !p.expected_go_live_is_manual,
      checklist,
      lastActivityAt: lastActivity.get(p.id) ?? null,
      updatedAt: p.updated_at ?? null,
      pendingAcceptance: !!p.pending_acceptance,
      now: nowDate,
    };
    const risk = withManualRisks(evaluateRisk({ ...base, assignedOwner: p.assigned_owner ?? null }, riskRules), manualRisks.get(p.id) || []);
    const egl: EglRiskVerdict | null = isInWindow(p.expected_go_live_date, "week", nowDate) ? evaluateEglRisk(base, eglRules) : null;
    const open = checklist.filter((i) => !i.completed);
    const overdue = open.filter((i) => i.dueDate && i.dueDate < today);
    return {
      p,
      risk,
      eglAtRisk: !!egl?.atRisk,
      egl,
      open: open.length,
      overdue: overdue.length,
      merchantOverdue: overdue.filter((i) => i.merchant).length,
      teamOpen: open.filter((i) => i.ownerTeam === p.current_owner_team).length,
    };
  });

  type Row = (typeof rows)[number];
  const needsAttention = rows.filter((r) => r.risk.level === "high");
  const goLivesAtRisk = rows.filter((r) => r.eglAtRisk);

  const actionFor = (r: Row, finding: RiskFinding): BriefItem["action"] => {
    const name = r.p.merchant_name;
    switch (finding.type) {
      case "project_state":
        return {
          label: r.p.project_state === "blocked" ? "Ask what's blocking it" : "Ask what's holding it up",
          prompt: `Why is ${name} ${stateName(r.p.project_state)}, and what would move it forward?`,
        };
      case "checklist_overdue":
        return r.merchantOverdue && caller.canAct && r.p.contact_email
          ? { label: "Draft follow-up", prompt: `Draft a follow-up email to the merchant contact for ${name} about their overdue checklist items.` }
          : { label: "See what's overdue", prompt: `What's overdue on ${name}, and who holds each item?` };
      case "golive_missed":
        return { label: "Plan a new date", prompt: `${name} missed its go-live date. What's left, who holds it, and what's a realistic new date?` };
      case "no_activity":
        return caller.canAct
          ? { label: "Nudge the owner", prompt: `Send a notification to the owner of ${name} asking for a status update.` }
          : { label: "Ask what's next", prompt: `What's the next step on ${name}?` };
      case "pending_acceptance":
        return { label: "See who needs to accept", prompt: `Who needs to accept the handover of ${name}, and how long has it been waiting?` };
      case "unassigned_owner":
        return caller.canAct
          ? { label: "Assign an owner", prompt: `Assign ${name} to @`, draft: true }
          : { label: "Ask who should own it", prompt: `Who should own ${name}?` };
      default:
        return { label: "Review the risk", prompt: `Summarise the open risks on ${name} and what would mitigate them.` };
    }
  };

  // One candidate per project, ranked the way the dashboard ranks: risk score
  // first, then the soonest go-live. A go-live at risk this week that the risk
  // rules haven't flagged yet ranks alongside a high-severity finding.
  const candidates: { rank: number; soon: number; ready?: boolean; item: BriefItem }[] = [];
  for (const r of rows) {
    const name = r.p.merchant_name;
    const eglNote = r.eglAtRisk && r.egl ? ` Go-live ${shortDate(r.p.expected_go_live_date)} at risk.` : "";
    if (r.risk.level === "high") {
      const lead = leadFinding(r.risk);
      const others = r.risk.findings.length - 1;
      candidates.push({
        rank: r.risk.score,
        soon: r.egl?.daysRemaining ?? Number.MAX_SAFE_INTEGER,
        item: {
          tone: SEVERITY_RANK[lead.severity] >= SEVERITY_RANK.high ? "bad" : "warn",
          project_id: r.p.id,
          merchant: name,
          // A state rule's name ("Project blocked") can cover several states,
          // so say the state the project is actually in.
          title: lead.type === "project_state" ? `${name} is ${stateName(r.p.project_state)}` : `${name}: ${lead.label.toLowerCase()}`,
          detail: `${lead.detail}${others > 0 ? ` (+${others} more)` : ""}.${eglNote}`,
          action: actionFor(r, lead),
        },
      });
    } else if (r.eglAtRisk && r.egl) {
      candidates.push({
        rank: 45,
        soon: r.egl.daysRemaining,
        item: {
          tone: "warn",
          project_id: r.p.id,
          merchant: name,
          title: `${name}: go-live ${shortDate(r.p.expected_go_live_date)} at risk`,
          detail: `${describeEglRisk(r.egl)}.`,
          action: { label: "Check readiness", prompt: `Is ${name} ready to go live on ${r.p.expected_go_live_date}? What's left and who holds it?` },
        },
      });
    } else if (r.p.project_state !== "live" && r.open > 0 && r.teamOpen === 0 && NEXT_TEAM[r.p.current_owner_team]) {
      const nextName = teamNames[NEXT_TEAM[r.p.current_owner_team]];
      candidates.push({
        rank: 0,
        soon: Number.MAX_SAFE_INTEGER,
        ready: true,
        item: {
          tone: "ok",
          project_id: r.p.id,
          merchant: name,
          title: `${name}: ready to hand over to ${nextName}`,
          detail: `The ${teamNames[r.p.current_owner_team] || "current"} team's checklist is complete.`,
          action: { label: "Write handover summary", prompt: `Write a handover summary of ${name} for the ${nextName} team.` },
        },
      });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank || a.soon - b.soon);
  const items = candidates.slice(0, MAX_ITEMS).map((candidate) => candidate.item);

  return json(
    {
      enabled: true,
      date: today,
      first_name: caller.name.split(" ")[0],
      scope_label: caller.portfolio ? `${projects.length} projects` : `your ${projects.length} projects`,
      counts: {
        attention: needsAttention.length,
        blocked: rows.filter((r) => r.p.project_state === "blocked").length,
        go_lives_at_risk: goLivesAtRisk.length,
        // Live projects are exempt from the risk rules, so their leftover dates aren't counted either.
        overdue: rows.reduce((sum, r) => (r.p.project_state === "live" ? sum : sum + r.overdue), 0),
        /** Projects with a problem (attention or go-live at risk), for the greeting. */
        flagged: candidates.filter((candidate) => !candidate.ready).length,
        ready_to_hand_over: candidates.filter((candidate) => candidate.ready).length,
      },
      // Managers get the KPI bar's headline; team members already see their own list.
      portfolio: caller.portfolio
        ? {
            projects: projects.length,
            arr_cr: Number(sumArrCrore(projects.map((p) => Number(p.arr) || 0)).toFixed(2)),
            awaiting_acceptance: rows.filter((r) => r.p.pending_acceptance).length,
          }
        : null,
      items,
      more: Math.max(0, candidates.length - items.length),
      setup,
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
