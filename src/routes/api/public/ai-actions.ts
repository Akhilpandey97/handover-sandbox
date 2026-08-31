import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    
    const userClient = createClient(SUPABASE_URL, process.env['SUPABASE_ANON_KEY']!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get user profile for tenant_id
    const { data: profile } = await adminClient
      .from("profiles")
      .select("tenant_id, name")
      .eq("id", user.id)
      .single();
    
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, params } = await req.json();
    const tenantId = profile.tenant_id;
    const userName = profile.name;

    let result: any = { success: true };
    let logDescription = "";
    let logCategory = "general";
    let logEntityType = "";
    let logEntityId = "";
    let logStatus = "success";

    switch (action) {
      case "assign_owner": {
        const { project_id, owner_id, owner_name } = params;
        const { error } = await adminClient
          .from("projects")
          .update({ assigned_owner: owner_id })
          .eq("id", project_id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        logDescription = `AI assigned owner "${owner_name}" to project`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = project_id;
        result = { success: true, message: `Owner "${owner_name}" assigned successfully` };
        break;
      }

      case "update_project_field": {
        const { project_id, field, value } = params;
        const allowedFields = [
          "project_state", "current_phase", "platform", "category",
          "arr", "txns_per_day", "aov", "sales_spoc", "integration_type",
          "pg_onboarding", "go_live_percent", "expected_go_live_date",
          "project_notes", "mint_notes", "current_phase_comment",
        ];
        if (!allowedFields.includes(field)) {
          throw new Error(`Field "${field}" is not allowed to be updated`);
        }
        
        // For note/comment fields, log to timeline instead of overwriting
        const noteFields = ["project_notes", "mint_notes", "current_phase_comment"];
        if (noteFields.includes(field)) {
          // Log the new note to the timeline
          await adminClient.from("project_comment_logs").insert({
            project_id,
            author_name: `AI (via ${userName})`,
            author_type: "ai",
            field_name: field,
            content: value,
            tenant_id: tenantId,
          });
          
          // Also update the field with latest value (append style)
          const { data: existing } = await adminClient
            .from("projects")
            .select(field)
            .eq("id", project_id)
            .eq("tenant_id", tenantId)
            .single();
          
          const timestamp = new Date().toLocaleString();
          const existingVal = existing?.[field as keyof typeof existing] || "";
          const newVal = existingVal 
            ? `${existingVal}\n\n[${timestamp} - AI] ${value}` 
            : `[${timestamp} - AI] ${value}`;
          
          const { error } = await adminClient
            .from("projects")
            .update({ [field]: newVal })
            .eq("id", project_id)
            .eq("tenant_id", tenantId);
          if (error) throw error;
        } else {
          const { error } = await adminClient
            .from("projects")
            .update({ [field]: value })
            .eq("id", project_id)
            .eq("tenant_id", tenantId);
          if (error) throw error;
        }
        
        logDescription = `AI updated project field "${field}" to "${value}"`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = project_id;
        result = { success: true, message: `Field "${field}" updated successfully` };
        break;
      }

      case "create_workflow": {
        const { name, description, trigger_type, trigger_config, action_type, action_config } = params;
        const { data, error } = await adminClient
          .from("ai_workflows")
          .insert({
            tenant_id: tenantId,
            name,
            description,
            trigger_type,
            trigger_config,
            action_type,
            action_config,
            created_by: user.id,
            created_by_name: userName,
          })
          .select()
          .single();
        if (error) throw error;
        logDescription = `AI created workflow "${name}"`;
        logCategory = "workflow";
        logEntityType = "workflow";
        logEntityId = data.id;
        result = { success: true, message: `Workflow "${name}" created successfully`, workflow: data };
        break;
      }

      case "update_workflow": {
        const { workflow_id, updates } = params;
        const { error } = await adminClient
          .from("ai_workflows")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", workflow_id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        logDescription = `AI updated workflow`;
        logCategory = "workflow";
        logEntityType = "workflow";
        logEntityId = workflow_id;
        result = { success: true, message: "Workflow updated successfully" };
        break;
      }

      case "delete_workflow": {
        const { workflow_id } = params;
        const { error } = await adminClient
          .from("ai_workflows")
          .delete()
          .eq("id", workflow_id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        logDescription = `AI deleted workflow`;
        logCategory = "workflow";
        logEntityType = "workflow";
        logEntityId = workflow_id;
        result = { success: true, message: "Workflow deleted successfully" };
        break;
      }

      case "bulk_update_projects": {
        const { project_ids, field, value } = params;
        const { error } = await adminClient
          .from("projects")
          .update({ [field]: value })
          .in("id", project_ids)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        logDescription = `AI bulk-updated "${field}" to "${value}" on ${project_ids.length} projects`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = project_ids.join(",");
        result = { success: true, message: `Updated ${project_ids.length} projects` };
        break;
      }

      case "trigger_brd": {
        const { project_id } = params;
        
        // Get project details
        const { data: project, error: projErr } = await adminClient
          .from("projects")
          .select("merchant_name, mid, contact_email")
          .eq("id", project_id)
          .eq("tenant_id", tenantId)
          .single();
        if (projErr || !project) throw new Error("Project not found");
        if (!project.contact_email) throw new Error("Project has no contact email set in the 'Merchant Contact Email' field. Please add it first.");

        // Auto-find "BRD Form" template
        const { data: formTemplate, error: formErr } = await adminClient
          .from("checklist_form_templates")
          .select("id, name")
          .ilike("name", "%BRD%")
          .limit(1)
          .single();
        if (formErr || !formTemplate) throw new Error("No BRD Form template found. Please create one in Settings → Checklist Forms.");
        const form_template_id = formTemplate.id;

        // Create BRD session
        const { data: session, error: sessErr } = await adminClient
          .from("brd_sessions")
          .insert({
            project_id,
            form_template_id,
            merchant_email: project.contact_email,
            tenant_id: tenantId,
          })
          .select("token")
          .single();
        if (sessErr || !session) throw new Error("Failed to create BRD session");

        // Determine app URL from environment or default
        const appUrl = process.env['APP_URL'] || "https://project-visionary-90.lovable.app";
        const brdLink = `${appUrl}/brd?token=${session.token}`;

        // Send email via Resend
        const RESEND_API_KEY = process.env['RESEND_API_KEY'];
        if (RESEND_API_KEY) {
          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "MINT Updates <mintupdates@notifications.gokwik.co>",
              to: [project.contact_email],
              subject: `📋 BRD Form Required: ${project.merchant_name}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="background: linear-gradient(135deg, #3b82f6, #6366f1); padding: 20px; border-radius: 12px 12px 0 0; color: white;">
                    <h1 style="margin: 0; font-size: 20px;">📋 BRD Form Required</h1>
                  </div>
                  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="margin: 0 0 16px;">Hi,</p>
                    <p style="margin: 0 0 16px;">We need you to complete the <strong>${formTemplate.name}</strong> form for project <strong>${project.merchant_name}</strong> (MID: ${project.mid}).</p>
                    <p style="margin: 0 0 16px;">Please click the button below to fill out the form. Your responses will be automatically recorded.</p>
                    <div style="margin: 24px 0; text-align: center;">
                      <a href="${brdLink}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #6366f1); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">Fill BRD Form →</a>
                    </div>
                    <p style="margin: 0; color: #64748b; font-size: 13px;">If the button doesn't work, copy this link: ${brdLink}</p>
                  </div>
                </div>
              `,
            }),
          });

          if (!emailResponse.ok) {
            const errData = await emailResponse.json();
            console.error("Resend error:", errData);
            // Continue even if email fails - the link is still valid
          }
        }

        logDescription = `AI triggered BRD form "${formTemplate.name}" for ${project.merchant_name} → ${project.contact_email}`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = project_id;
        result = { 
          success: true, 
          message: `BRD form "${formTemplate.name}" sent to ${project.contact_email} for ${project.merchant_name}. The merchant will receive an email with a link to fill out the form. Once completed, the BRD Excel file will be automatically saved to the project's BRD Link field.`,
          brd_link: `${appUrl}/brd?token=${session.token}`,
        };
        break;
      }

      case "create_project": {
        const allowedFields = [
          "merchant_name", "mid", "kick_off_date", "platform", "category",
          "arr", "txns_per_day", "aov", "brand_url", "contact_email",
          "sales_spoc", "integration_type", "pg_onboarding",
          "current_phase", "current_owner_team", "project_state",
          "expected_go_live_date", "project_notes", "mint_notes",
          "jira_link", "sow_link", "brd_link",
        ];
        // Whitelist incoming params
        const insertRow: Record<string, any> = { tenant_id: tenantId, created_by: user.id };
        for (const k of allowedFields) {
          if (params[k] !== undefined && params[k] !== null && params[k] !== "") {
            insertRow[k] = params[k];
          }
        }
        // Validate required
        if (!insertRow.merchant_name || !insertRow.mid || !insertRow.kick_off_date) {
          throw new Error("merchant_name, mid, and kick_off_date are required to create a project");
        }
        // Validate enums
        const phaseEnum = ["mint", "integration", "ms", "completed"];
        const stateEnum = ["not_started", "on_hold", "in_progress", "live", "blocked"];
        if (insertRow.current_phase && !phaseEnum.includes(insertRow.current_phase)) {
          throw new Error(`Invalid current_phase. Must be one of: ${phaseEnum.join(", ")}`);
        }
        if (insertRow.project_state && !stateEnum.includes(insertRow.project_state)) {
          throw new Error(`Invalid project_state. Must be one of: ${stateEnum.join(", ")}`);
        }
        // Check MID uniqueness within tenant
        const { data: existing } = await adminClient
          .from("projects")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("mid", insertRow.mid)
          .maybeSingle();
        if (existing) throw new Error(`A project with MID "${insertRow.mid}" already exists in this tenant`);

        const { data: created, error } = await adminClient
          .from("projects")
          .insert(insertRow)
          .select("id, merchant_name, mid, kick_off_date")
          .single();
        if (error) throw error;

        // Checklist items are seeded automatically by the database trigger on projects insert.
        const { count: seededCount } = await adminClient
          .from("checklist_items")
          .select("id", { count: "exact", head: true })
          .eq("project_id", created.id);

        logDescription = `AI created project "${created.merchant_name}" (MID: ${created.mid}) with ${seededCount ?? 0} checklist items`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = created.id;
        result = { success: true, message: `Project "${created.merchant_name}" (MID: ${created.mid}) created successfully`, project: created };
        break;
      }

      case "toggle_responsibility": {
        const { project_id, party } = params;
        const validParties = ["gokwik", "merchant", "neutral"];
        if (!validParties.includes(party)) {
          throw new Error(`Invalid party "${party}". Must be one of: ${validParties.join(", ")}`);
        }
        const { error } = await adminClient
          .from("projects")
          .update({ current_responsibility: party })
          .eq("id", project_id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        logDescription = `AI toggled project responsibility to "${party}"`;
        logCategory = "project";
        logEntityType = "project";
        logEntityId = project_id;
        result = { success: true, message: `Project responsibility set to "${party}" successfully` };
        break;
      }

      case "get_available_actions": {
        // Return all available actions for suggestion display
        result = {
          success: true,
          actions: [
            { id: "assign_owner", label: "Assign Owner", description: "Assign an owner to a project", needsApproval: true },
            { id: "update_project_field", label: "Update Project Field", description: "Update any project field (state, phase, notes, etc.)", needsApproval: true },
            { id: "create_workflow", label: "Create Workflow", description: "Create an automated workflow rule", needsApproval: true },
            { id: "bulk_update_projects", label: "Bulk Update Projects", description: "Update a field across multiple projects at once", needsApproval: true },
            { id: "trigger_brd", label: "Trigger BRD", description: "Send BRD form to merchant via email", needsApproval: true },
            { id: "toggle_responsibility", label: "Toggle Responsibility", description: "Change project responsibility between GoKwik, Merchant, or Neutral", needsApproval: true },
            { id: "analyze_risks", label: "Analyze Risks", description: "Identify at-risk projects based on timelines and blockers", needsApproval: false },
            { id: "suggest_workflows", label: "Suggest Workflows", description: "Get AI-recommended automation workflows", needsApproval: false },
            { id: "team_workload", label: "Team Workload Summary", description: "Get a summary of workloads across teams", needsApproval: false },
          ],
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Log the activity
    if (action !== "get_available_actions") {
      await adminClient.from("activity_logs").insert({
        tenant_id: tenantId,
        user_id: user.id,
        user_name: userName,
        action_type: "ai",
        category: logCategory,
        description: logDescription,
        entity_type: logEntityType,
        entity_id: logEntityId,
        metadata: { action, params, result },
        status: logStatus,
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-actions error:", e);

    // Try to log the failure
    try {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const body = await req.clone().json().catch(() => ({}));
      await adminClient.from("activity_logs").insert({
        action_type: "ai",
        category: "api",
        description: `AI action failed: ${e instanceof Error ? e.message : "Unknown error"}`,
        metadata: { error: e instanceof Error ? e.message : "Unknown", body },
        status: "failed",
      });
    } catch { /* ignore logging errors */ }

    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/ai-actions")({
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
