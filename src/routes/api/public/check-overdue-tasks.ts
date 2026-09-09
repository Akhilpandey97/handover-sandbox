import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const supabaseUrl = process.env['SUPABASE_URL']!;
    const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date().toISOString().split("T")[0];

    // Find overdue checklist items (due_date passed, not completed)
    const { data: overdueItems, error: overdueError } = await supabase
      .from("checklist_items")
      .select("id, title, due_date, project_id, owner_team, tenant_id")
      .eq("completed", false)
      .not("due_date", "is", null)
      .lt("due_date", now);

    if (overdueError) throw overdueError;
    if (!overdueItems || overdueItems.length === 0) {
      return new Response(JSON.stringify({ message: "No overdue items found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by project
    const projectMap = new Map<string, { projectId: string; tenantId: string; items: typeof overdueItems }>();
    for (const item of overdueItems) {
      const key = item.project_id;
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectId: item.project_id, tenantId: item.tenant_id || "", items: [] });
      }
      projectMap.get(key)!.items.push(item);
    }

    let emailsSent = 0;

    for (const [projectId, group] of projectMap) {
      // Get project info
      const { data: project } = await supabase
        .from("projects")
        .select("merchant_name, assigned_owner, tenant_id")
        .eq("id", projectId)
        .single();

      if (!project) continue;

      // Get assigned owner email
      const recipients: { email: string; name: string }[] = [];

      if (project.assigned_owner) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("email, name")
          .eq("id", project.assigned_owner)
          .single();
        if (ownerProfile) {
          recipients.push({ email: ownerProfile.email, name: ownerProfile.name });
        }
      }

      // Get all managers for this tenant
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager")
        .eq("tenant_id", project.tenant_id);

      if (managerRoles) {
        const managerIds = managerRoles.map(r => r.user_id);
        if (managerIds.length > 0) {
          const { data: managerProfiles } = await supabase
            .from("profiles")
            .select("email, name")
            .in("id", managerIds);
          managerProfiles?.forEach(mp => {
            if (!recipients.find(r => r.email === mp.email)) {
              recipients.push({ email: mp.email, name: mp.name });
            }
          });
        }
      }

      // Send notification to each recipient
      const itemList = group.items.map(i => `• ${i.title} (due: ${i.due_date})`).join("\n");

      for (const recipient of recipients) {
        try {
          await supabase.functions.invoke("send-notification", {
            body: {
              type: "checklist_overdue",
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              projectName: project.merchant_name,
              details: `The following checklist items are overdue:\n${itemList}`,
            },
          });
          emailsSent++;
        } catch (e) {
          console.error(`Failed to send to ${recipient.email}:`, e);
        }
      }
    }

    return new Response(
      JSON.stringify({ message: `Processed ${overdueItems.length} overdue items, sent ${emailsSent} notifications` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in check-overdue-tasks:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/check-overdue-tasks")({
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
