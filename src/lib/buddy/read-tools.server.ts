import {
  type BuddyCaller,
  PHASE_LABELS,
  RESPONSIBILITY_LABELS,
  STATE_LABELS,
  todayIso,
} from "@/lib/buddy/scope.server";

/**
 * Read tools Buddy calls on the server to answer questions from live data.
 *
 * These replace the one-line summary of the first 20 projects the browser used
 * to send. Every query is filtered to the caller's workspace, and to their own
 * assigned projects when they are not a portfolio role.
 */

export interface BuddySource {
  kind: "project" | "data";
  id?: string;
  label: string;
}

export interface ReadToolResult {
  step: string;
  data: unknown;
  sources: BuddySource[];
}

export const READ_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_projects",
      description:
        "Find projects in the user's scope. Use for any question about more than one project: lists, filters, 'which projects…', counts with details. Returns up to 50 rows with checklist progress and overdue counts.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of a merchant name or MID" },
          state: { type: "string", enum: ["not_started", "on_hold", "in_progress", "live", "blocked"] },
          phase: { type: "string", enum: ["mint", "integration", "ms", "completed"] },
          owner_id: { type: "string", description: "Only projects owned by this user id" },
          platform: { type: "string" },
          go_live_from: { type: "string", description: "Expected go-live on or after (YYYY-MM-DD)" },
          go_live_to: { type: "string", description: "Expected go-live on or before (YYYY-MM-DD)" },
          only_overdue: { type: "boolean", description: "Only projects with overdue checklist items" },
          limit: { type: "number", description: "Rows to return, max 50 (default 25)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project",
      description:
        "Everything about one project: details, checklist items with ids, due dates and who holds each, tasks with ids and status, recent checklist comments, open risks, transfers, recent notes, meetings with minutes, and Jira tickets. Use before answering anything specific to a project, preparing a summary, handover or meeting brief, or changing a checklist item or task.",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" } },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "portfolio_stats",
      description:
        "Counts and ARR totals across the user's projects, grouped by one dimension. Use for 'how many', breakdowns and trends.",
      parameters: {
        type: "object",
        properties: {
          group_by: { type: "string", enum: ["state", "phase", "owner", "platform", "go_live_month", "responsibility"] },
          state: { type: "string", enum: ["not_started", "on_hold", "in_progress", "live", "blocked"] },
          phase: { type: "string", enum: ["mint", "integration", "ms", "completed"] },
        },
        required: ["group_by"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_people",
      description: "People in this workspace with their user ids, email and team. Use before assigning, notifying or emailing someone.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of a name or email" },
          team: { type: "string" },
        },
      },
    },
  },
] as const;

export const READ_TOOL_NAMES = new Set<string>(READ_TOOL_DEFS.map((t) => t.function.name));

const PROJECT_COLUMNS =
  "id, merchant_name, mid, project_state, current_phase, current_owner_team, assigned_owner, expected_go_live_date, go_live_date, arr, platform, category, current_responsibility, kick_off_date, updated_at, pending_acceptance";

const TASK_STATUS_LABELS: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done" };

/** Postgres LIKE needs %/_ escaped; PostgREST .or() needs commas and parens kept out. */
const safeLike = (s: string) => s.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/[,()]/g, " ").trim();

const clampText = (s: string | null | undefined, n: number) => {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

async function ownerNames(caller: BuddyCaller, ids: (string | null)[]) {
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await caller.client
    .from("profiles")
    .select("id, name")
    .eq("tenant_id", caller.tenantId)
    .in("id", unique);
  return new Map(((data || []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
}

async function checklistProgress(caller: BuddyCaller, projectIds: string[]) {
  const today = todayIso();
  const out = new Map<string, { done: number; total: number; overdue: number; merchantOverdue: number }>();
  for (const id of projectIds) out.set(id, { done: 0, total: 0, overdue: 0, merchantOverdue: 0 });
  if (projectIds.length === 0) return out;

  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await caller.client
      .from("checklist_items")
      .select("project_id, completed, due_date, current_responsibility")
      .eq("tenant_id", caller.tenantId)
      .in("project_id", projectIds)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of (data || []) as Array<{ project_id: string; completed: boolean | null; due_date: string | null; current_responsibility: string | null }>) {
      const p = out.get(row.project_id);
      if (!p) continue;
      p.total++;
      if (row.completed) p.done++;
      else if (row.due_date && row.due_date < today) {
        p.overdue++;
        if (row.current_responsibility === "merchant") p.merchantOverdue++;
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function searchProjects(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 50);
  let q = caller.client
    .from("projects")
    .select(PROJECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", caller.tenantId)
    .eq("archived", false);
  if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);
  if (typeof args.query === "string" && args.query.trim()) {
    const term = safeLike(args.query);
    if (term) q = q.or(`merchant_name.ilike.%${term}%,mid.ilike.%${term}%`);
  }
  if (args.state) q = q.eq("project_state", args.state);
  if (args.phase) q = q.eq("current_phase", args.phase);
  if (args.owner_id) q = q.eq("assigned_owner", args.owner_id);
  if (args.platform) q = q.ilike("platform", safeLike(String(args.platform)));
  if (args.go_live_from) q = q.gte("expected_go_live_date", args.go_live_from);
  if (args.go_live_to) q = q.lte("expected_go_live_date", args.go_live_to);

  // Overdue filtering happens after counting checklist items, so fetch wider.
  const fetchLimit = args.only_overdue ? 500 : limit;
  const { data, error, count } = await q
    .order("expected_go_live_date", { ascending: true, nullsFirst: false })
    .limit(fetchLimit);
  if (error) throw error;

  const rows = (data || []) as any[];
  const [progress, owners] = await Promise.all([
    checklistProgress(caller, rows.map((r) => r.id)),
    ownerNames(caller, rows.map((r) => r.assigned_owner)),
  ]);

  let projects = rows.map((r) => {
    const pr = progress.get(r.id)!;
    return {
      project_id: r.id,
      merchant: r.merchant_name,
      mid: r.mid,
      state: STATE_LABELS[r.project_state] || r.project_state,
      phase: PHASE_LABELS[r.current_phase] || r.current_phase,
      owner: owners.get(r.assigned_owner) || "Unassigned",
      owner_id: r.assigned_owner,
      with: RESPONSIBILITY_LABELS[r.current_responsibility] || r.current_responsibility,
      expected_go_live: r.expected_go_live_date,
      went_live: r.go_live_date,
      arr_cr: r.arr,
      platform: r.platform,
      checklist: `${pr.done}/${pr.total}`,
      overdue_items: pr.overdue,
      merchant_overdue_items: pr.merchantOverdue,
      awaiting_acceptance: !!r.pending_acceptance,
    };
  });
  if (args.only_overdue) projects = projects.filter((p) => p.overdue_items > 0).slice(0, limit);

  const scopeLabel = caller.portfolio ? "workspace" : "your assigned projects";
  return {
    step: args.query ? `Searched ${scopeLabel} for "${args.query}"` : `Searched ${scopeLabel}`,
    data: {
      matching: args.only_overdue ? projects.length : count ?? projects.length,
      returned: projects.length,
      today: todayIso(),
      projects,
    },
    sources: [
      { kind: "data", label: `${count ?? projects.length} projects` },
      ...projects.slice(0, 6).map((p) => ({ kind: "project" as const, id: p.project_id, label: p.merchant })),
    ],
  };
}

async function getProject(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult> {
  const id = String(args.project_id || "");
  const { data: project, error } = await caller.client
    .from("projects")
    .select(`${PROJECT_COLUMNS}, brand_url, contact_email, sales_spoc, integration_type, pg_onboarding, go_live_percent, project_notes, current_phase_comment, jira_link, brd_link, sow_link, txns_per_day, aov`)
    .eq("tenant_id", caller.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const p = project as any;
  if (!p) return { step: "Looked for a project", data: { error: "No project with that id in this workspace." }, sources: [] };
  if (!caller.portfolio && p.assigned_owner !== caller.userId) {
    return { step: "Looked for a project", data: { error: "That project isn't assigned to this user." }, sources: [] };
  }

  const today = todayIso();
  const [items, tasks, risks, transfers, notes, meetings, jira] = await Promise.all([
    caller.client.from("checklist_items").select("id, title, phase, owner_team, completed, completed_at, due_date, current_responsibility").eq("tenant_id", caller.tenantId).eq("project_id", id).order("sort_order", { ascending: true }),
    caller.client.from("checklist_tasks").select("id, checklist_item_id, title, status, priority, due_date, assigned_to").eq("tenant_id", caller.tenantId).eq("project_id", id).order("created_at", { ascending: false }).limit(60),
    caller.client.from("project_risks").select("title, severity, category, status, description, mitigation_plan, mitigation_due_at").eq("tenant_id", caller.tenantId).eq("project_id", id).in("status", ["open", "mitigating"]).limit(20),
    caller.client.from("transfer_history").select("from_team, to_team, transferred_by, transferred_at, accepted_at, notes").eq("tenant_id", caller.tenantId).eq("project_id", id).order("transferred_at", { ascending: false }).limit(5),
    caller.client.from("project_comment_logs").select("field_name, content, author_name, created_at").eq("tenant_id", caller.tenantId).eq("project_id", id).order("created_at", { ascending: false }).limit(8),
    caller.client.from("checklist_meetings").select("title, scheduled_at, status, provider, join_url, attendees, analysis_status, mom_comment_id, checklist_item_id").eq("tenant_id", caller.tenantId).eq("project_id", id).order("scheduled_at", { ascending: false }).limit(5),
    caller.client.from("project_jira_tickets").select("jira_key, summary, status, priority, due_date, assignee_name").eq("tenant_id", caller.tenantId).eq("project_id", id).limit(15),
  ]);

  const itemRows = (items.data || []) as any[];
  const itemTitle = new Map(itemRows.map((c) => [c.id, c.title]));
  const taskRows = (tasks.data || []) as any[];
  const meetingRows = (meetings.data || []) as any[];
  const momIds = meetingRows.map((m) => m.mom_comment_id).filter(Boolean);

  const [owners, moms, comments] = await Promise.all([
    ownerNames(caller, [p.assigned_owner, ...taskRows.map((t) => t.assigned_to)]),
    momIds.length
      ? caller.client.from("checklist_comments").select("id, comment").eq("tenant_id", caller.tenantId).in("id", momIds)
      : Promise.resolve({ data: [] as any[] }),
    itemRows.length
      ? caller.client
          .from("checklist_comments")
          .select("id, checklist_item_id, comment, user_name, created_at")
          .eq("tenant_id", caller.tenantId)
          .in("checklist_item_id", itemRows.map((c) => c.id))
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const momById = new Map((((moms as any).data || []) as { id: string; comment: string }[]).map((c) => [c.id, c.comment]));

  const checklist = itemRows.map((c) => ({
    item_id: c.id,
    title: c.title,
    team: c.owner_team,
    done: !!c.completed,
    due: c.due_date,
    overdue: !c.completed && !!c.due_date && c.due_date < today,
    with: RESPONSIBILITY_LABELS[c.current_responsibility] || null,
  }));

  return {
    step: `Read ${p.merchant_name}`,
    data: {
      today,
      project: {
        project_id: p.id,
        merchant: p.merchant_name,
        mid: p.mid,
        state: STATE_LABELS[p.project_state] || p.project_state,
        phase: PHASE_LABELS[p.current_phase] || p.current_phase,
        owner: owners.get(p.assigned_owner) || "Unassigned",
        with: RESPONSIBILITY_LABELS[p.current_responsibility] || p.current_responsibility,
        kick_off: p.kick_off_date,
        expected_go_live: p.expected_go_live_date,
        went_live: p.go_live_date,
        go_live_percent: p.go_live_percent,
        arr_cr: p.arr,
        platform: p.platform,
        category: p.category,
        integration_type: p.integration_type,
        contact_email: p.contact_email,
        sales_spoc: p.sales_spoc,
        awaiting_acceptance: !!p.pending_acceptance,
        notes: clampText(p.project_notes, 1200),
        phase_comment: clampText(p.current_phase_comment, 600),
        links: { jira: p.jira_link, brd: p.brd_link, sow: p.sow_link, brand: p.brand_url },
      },
      checklist_summary: {
        done: checklist.filter((c) => c.done).length,
        total: checklist.length,
        overdue: checklist.filter((c) => c.overdue).length,
      },
      checklist,
      tasks: taskRows.map((t) => ({
        task_id: t.id,
        title: t.title,
        status: TASK_STATUS_LABELS[t.status] || t.status,
        priority: t.priority,
        due: t.due_date,
        assigned_to: owners.get(t.assigned_to) || (t.assigned_to ? "Someone" : "Nobody"),
        under_item: itemTitle.get(t.checklist_item_id) || null,
        item_id: t.checklist_item_id,
      })),
      recent_checklist_comments: (((comments as any).data || []) as any[]).map((c) => ({
        item: itemTitle.get(c.checklist_item_id) || null,
        item_id: c.checklist_item_id,
        by: c.user_name,
        at: c.created_at,
        comment: clampText(c.comment, 400),
      })),
      open_risks: risks.data || [],
      transfers: transfers.data || [],
      recent_notes: ((notes.data || []) as any[]).map((n) => ({ ...n, content: clampText(n.content, 400) })),
      meetings: meetingRows.map((m) => ({
        title: m.title,
        when: m.scheduled_at,
        status: m.status,
        provider: m.provider,
        join_url: m.join_url,
        attendees: m.attendees,
        checklist_item: itemTitle.get(m.checklist_item_id) || null,
        minutes: clampText(momById.get(m.mom_comment_id) || null, 1500),
      })),
      jira_tickets: jira.data || [],
    },
    sources: [{ kind: "project", id: p.id, label: p.merchant_name }],
  };
}

async function portfolioStats(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult> {
  let q = caller.client
    .from("projects")
    .select("project_state, current_phase, assigned_owner, platform, expected_go_live_date, current_responsibility, arr")
    .eq("tenant_id", caller.tenantId)
    .eq("archived", false);
  if (!caller.portfolio) q = q.eq("assigned_owner", caller.userId);
  if (args.state) q = q.eq("project_state", args.state);
  if (args.phase) q = q.eq("current_phase", args.phase);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const rows = (data || []) as any[];

  const groupBy = String(args.group_by || "state");
  const owners = groupBy === "owner" ? await ownerNames(caller, rows.map((r) => r.assigned_owner)) : new Map<string, string>();
  const keyOf = (r: any): string => {
    switch (groupBy) {
      case "phase": return PHASE_LABELS[r.current_phase] || r.current_phase || "None";
      case "owner": return owners.get(r.assigned_owner) || "Unassigned";
      case "platform": return r.platform || "Unknown";
      case "go_live_month": return r.expected_go_live_date ? String(r.expected_go_live_date).slice(0, 7) : "No date";
      case "responsibility": return RESPONSIBILITY_LABELS[r.current_responsibility] || "Unknown";
      default: return STATE_LABELS[r.project_state] || r.project_state || "None";
    }
  };

  const groups = new Map<string, { projects: number; arr_cr: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k) || { projects: 0, arr_cr: 0 };
    g.projects++;
    g.arr_cr += Number(r.arr) || 0;
    groups.set(k, g);
  }
  const list = Array.from(groups.entries())
    .map(([group, v]) => ({ group, projects: v.projects, arr_cr: Math.round(v.arr_cr * 100) / 100 }))
    .sort((a, b) => (groupBy === "go_live_month" ? a.group.localeCompare(b.group) : b.projects - a.projects));

  return {
    step: `Counted ${rows.length} projects by ${groupBy.replace(/_/g, " ")}`,
    data: { total_projects: rows.length, group_by: groupBy, groups: list },
    sources: [{ kind: "data", label: `${rows.length} projects` }],
  };
}

async function listPeople(caller: BuddyCaller, args: Record<string, any>): Promise<ReadToolResult> {
  let q = caller.client.from("profiles").select("id, name, email, team").eq("tenant_id", caller.tenantId);
  if (typeof args.query === "string" && args.query.trim()) {
    const term = safeLike(args.query);
    if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  if (args.team) q = q.eq("team", args.team);
  const { data, error } = await q.order("name").limit(50);
  if (error) throw error;
  const people = ((data || []) as any[]).map((p) => ({ user_id: p.id, name: p.name, email: p.email, team: p.team }));
  return {
    step: args.query ? `Looked up people matching "${args.query}"` : "Looked up people",
    data: { people },
    sources: [{ kind: "data", label: `${people.length} people` }],
  };
}

export async function runReadTool(
  caller: BuddyCaller,
  name: string,
  args: Record<string, any>,
): Promise<ReadToolResult> {
  try {
    switch (name) {
      case "search_projects": return await searchProjects(caller, args);
      case "get_project": return await getProject(caller, args);
      case "portfolio_stats": return await portfolioStats(caller, args);
      case "list_people": return await listPeople(caller, args);
      default: return { step: `Unknown tool ${name}`, data: { error: `Unknown tool ${name}` }, sources: [] };
    }
  } catch (err) {
    return { step: `Couldn't read data (${name})`, data: { error: (err as Error).message }, sources: [] };
  }
}
