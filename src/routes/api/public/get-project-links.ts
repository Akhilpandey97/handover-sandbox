import { createFileRoute } from "@tanstack/react-router";

// Public read-only API to fetch full project details.
// Lookup by `id` (uuid) or `mid` (merchant id), passed as query string or JSON body.
//
// Examples:
//   GET  /get-project-links?id=<uuid>
//   GET  /get-project-links?mid=<mid>
//   POST /get-project-links   { "id": "<uuid>" }  or  { "mid": "<mid>" }

import { createClient } from "@supabase/supabase-js";
import { requireCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const denied = await requireCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    let id: string | null = null;
    let mid: string | null = null;

    const url = new URL(req.url);
    id = url.searchParams.get("id");
    mid = url.searchParams.get("mid");

    if (!id && !mid && (req.method === "POST" || req.method === "PUT")) {
      try {
        const body = await req.json();
        id = body?.id ?? null;
        mid = body?.mid ?? null;
      } catch {
        // body optional
      }
    }

    if (!id && !mid) {
      return json(
        { error: "Provide either `id` (project uuid) or `mid` (merchant id)." },
        400,
      );
    }

    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    );

    // 1. Fetch the project row (all columns).
    const projectQuery = supabase.from("projects").select("*").limit(1);
    const { data: project, error: projectError } = id
      ? await projectQuery.eq("id", id).maybeSingle()
      : await projectQuery.eq("mid", mid!).maybeSingle();

    if (projectError) {
      console.error("Project fetch error:", projectError);
      return json({ error: projectError.message }, 500);
    }
    if (!project) {
      return json({ error: "Project not found" }, 404);
    }

    const projectId = project.id;
    const tenantId = project.tenant_id;

    // 2. Parallel fetch related data.
    const [
      checklistRes,
      customFieldsRes,
      customValuesRes,
      ownerRes,
      jiraRes,
      tasksRes,
      transferRes,
    ] = await Promise.all([
      supabase
        .from("checklist_items")
        .select(
          "id, title, completed, completed_by, completed_at, phase, owner_team, current_responsibility, comment, sort_order, due_date, is_task",
        )
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true }),
      tenantId
        ? supabase
            .from("custom_fields")
            .select("id, field_key, field_label, field_type, options")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
        : Promise.resolve({ data: [], error: null } as any),
      supabase
        .from("custom_field_values")
        .select("field_id, value")
        .eq("project_id", projectId),
      project.assigned_owner
        ? supabase
            .from("profiles")
            .select("id, name, email, team")
            .eq("id", project.assigned_owner)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      supabase
        .from("project_jira_tickets")
        .select(
          "jira_key, summary, status, status_category, priority, issue_type, assignee_name, url, due_date, updated",
        )
        .eq("project_id", projectId),
      supabase
        .from("checklist_tasks")
        .select("id, title, description, status, priority, due_date, assigned_to, checklist_item_id, created_at")
        .eq("project_id", projectId),
      supabase
        .from("project_responsibility_logs")
        .select("party, phase, started_at, ended_at")
        .eq("project_id", projectId)
        .order("started_at", { ascending: true }),
    ]);

    // Build custom fields map
    const valueByField = new Map<string, string | null>();
    (customValuesRes.data ?? []).forEach((v: any) =>
      valueByField.set(v.field_id, v.value),
    );
    const customFields = (customFieldsRes.data ?? []).map((f: any) => ({
      key: f.field_key,
      label: f.field_label,
      type: f.field_type,
      value: valueByField.get(f.id) ?? null,
    }));

    // Checklist progress
    const checklist = checklistRes.data ?? [];
    const completedCount = checklist.filter((c: any) => c.completed).length;

    return json({
      // Core
      id: project.id,
      mid: project.mid,
      merchant_name: project.merchant_name,
      platform: project.platform,
      category: project.category,
      integration_type: project.integration_type,
      pg_onboarding: project.pg_onboarding,
      sales_spoc: project.sales_spoc,
      contact_email: project.contact_email,

      // Status
      current_phase: project.current_phase,
      current_owner_team: project.current_owner_team,
      current_responsibility: project.current_responsibility,
      project_state: project.project_state,
      pending_acceptance: project.pending_acceptance,
      go_live_percent: project.go_live_percent,
      archived: project.archived,

      // Metrics
      arr: project.arr,
      txns_per_day: project.txns_per_day,
      aov: project.aov,

      // Dates
      kick_off_date: project.kick_off_date,
      expected_go_live_date: project.expected_go_live_date,
      go_live_date: project.go_live_date,
      created_at: project.created_at,
      updated_at: project.updated_at,

      // Links
      links: {
        brand_url: project.brand_url,
        brd_link: project.brd_link,
        jira_link: project.jira_link,
        sow_link: project.sow_link,
        mint_checklist_link: project.mint_checklist_link,
        integration_checklist_link: project.integration_checklist_link,
      },

      // Notes
      notes: {
        mint_notes: project.mint_notes,
        project_notes: project.project_notes,
        current_phase_comment: project.current_phase_comment,
        phase2_comment: project.phase2_comment,
      },

      // Owner
      assigned_owner: ownerRes.data
        ? {
            id: ownerRes.data.id,
            name: ownerRes.data.name,
            email: ownerRes.data.email,
            team: ownerRes.data.team,
          }
        : null,

      // Custom fields
      custom_fields: customFields,

      // Checklist
      checklist_progress: {
        completed: completedCount,
        total: checklist.length,
        percent: checklist.length
          ? Math.round((completedCount / checklist.length) * 100)
          : 0,
      },
      checklist,

      // Tasks
      tasks: tasksRes.data ?? [],

      // Jira tickets
      jira_tickets: jiraRes.data ?? [],

      // Responsibility timeline
      responsibility_logs: transferRes.data ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Unhandled:", message);
    return json({ error: message }, 500);
  }
}

export const Route = createFileRoute("/api/public/get-project-links")({
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
