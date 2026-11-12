import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { userCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const caller = await userCaller(req);
    if (!caller || !caller.isAdmin) {
      return new Response(JSON.stringify({ error: "Admins and managers only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { project_id, checklist_set_id } = await req.json();
    if (!project_id || !checklist_set_id) {
      return new Response(JSON.stringify({ error: "project_id and checklist_set_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Verify the project belongs to the caller's tenant
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, tenant_id, kick_off_date")
      .eq("id", project_id)
      .eq("tenant_id", caller.tenantId!)
      .maybeSingle();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the checklist set belongs to the same tenant
    const { data: set, error: setErr } = await supabase
      .from("checklist_sets")
      .select("id")
      .eq("id", checklist_set_id)
      .eq("tenant_id", caller.tenantId!)
      .maybeSingle();

    if (setErr || !set) {
      return new Response(JSON.stringify({ error: "Checklist set not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch templates for this set
    const { data: templates, error: templErr } = await supabase
      .from("checklist_templates")
      .select("title, owner_team, sort_order, standard_duration")
      .eq("checklist_set_id", checklist_set_id)
      .order("sort_order");

    if (templErr) throw templErr;

    if (!templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No templates in this checklist set", seeded: 0 }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Delete existing items then re-seed
    const { error: delErr } = await supabase
      .from("checklist_items")
      .delete()
      .eq("project_id", project_id);

    if (delErr) throw delErr;

    const kickOff = project.kick_off_date ? new Date(project.kick_off_date) : null;

    const rows = templates.map((t) => ({
      project_id,
      tenant_id: caller.tenantId,
      title: t.title,
      completed: false,
      owner_team: t.owner_team,
      current_responsibility: "neutral",
      sort_order: t.sort_order ?? 0,
      due_date:
        kickOff && t.standard_duration && t.standard_duration > 0
          ? new Date(kickOff.getTime() + t.standard_duration * 86400000)
              .toISOString()
              .split("T")[0]
          : null,
    }));

    const { error: insErr } = await supabase.from("checklist_items").insert(rows as any);
    if (insErr) throw insErr;

    // Update checklist_set_id on the project
    await supabase
      .from("projects")
      .update({ checklist_set_id })
      .eq("id", project_id);

    return new Response(JSON.stringify({ seeded: rows.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/seed-checklist")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
