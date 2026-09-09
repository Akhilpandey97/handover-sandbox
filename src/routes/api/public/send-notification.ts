import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { projectUrl } from "@/lib/app-links.server";

import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const { type, recipientEmail, recipientName, projectName, fromTeam, toTeam, notes, assignedBy, projectId, checklistItemId, taskId, commentId, cc, tenantId } = await req.json();

    // tenantId lets server-to-server callers (which have no user JWT) still get
    // the right tenant's branding and base URL.
    const creds = await getTenantIntegrations(await tenantIdFromRequest(req, tenantId));
    const RESEND_API_KEY = requireCred(creds, "resend_api_key", "Resend email");

    const link = projectUrl(creds, projectId, { item: checklistItemId, task: taskId, comment: commentId });
    const viewProjectBtn = link
      ? `<div style="margin-top: 20px; text-align: center;">
           <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">View Project →</a>
         </div>`
      : "";

    let subject: string;
    let htmlContent: string;

    if (type === "project_assignment") {
      subject = `🎯 New Project Assigned: ${projectName}`;
      htmlContent = `
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px; border-radius: 12px 12px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 20px;">🎯 New Project Assignment</h1>
          </div>
          <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px;">Hi <strong>${recipientName}</strong>,</p>
            <p style="margin: 0 0 16px;">You have been assigned to a new project:</p>
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <h2 style="margin: 0 0 8px; color: #1e293b; font-size: 18px;">${projectName}</h2>
              ${assignedBy ? `<p style="margin: 0; color: #64748b; font-size: 14px;">Assigned by: ${assignedBy}</p>` : ''}
            </div>
            ${viewProjectBtn || `<p style="margin: 0; color: #64748b; font-size: 14px;">Please log in to your dashboard to review and accept the project.</p>`}
          </div>
        </div>
      `;
    } else if (type === "project_transfer") {
      subject = `📦 Incoming Project Transfer: ${projectName}`;
      htmlContent = `
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 20px; border-radius: 12px 12px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 20px;">📦 Incoming Project Transfer</h1>
          </div>
          <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px;">Hi <strong>${recipientName}</strong>,</p>
            <p style="margin: 0 0 16px;">A project has been transferred to you and is awaiting your acceptance:</p>
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <h2 style="margin: 0 0 8px; color: #1e293b; font-size: 18px;">${projectName}</h2>
              <p style="margin: 0 0 4px; color: #64748b; font-size: 14px;">From: <strong>${fromTeam}</strong> → To: <strong>${toTeam}</strong></p>
              ${notes ? `<p style="margin: 8px 0 0; color: #64748b; font-size: 14px;">Notes: ${notes}</p>` : ''}
            </div>
            ${viewProjectBtn || `<p style="margin: 0; color: #64748b; font-size: 14px;">Please log in to your dashboard to accept this project.</p>`}
          </div>
        </div>
      `;
    } else if (type === "project_rejection") {
      subject = `🔴 Project Rejected: ${projectName}`;
      htmlContent = `
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 20px; border-radius: 12px 12px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 20px;">🔴 Project Rejected — Action Needed</h1>
          </div>
          <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px;">Hi <strong>${recipientName}</strong>,</p>
            <p style="margin: 0 0 16px;">A project has been <strong style="color:#ef4444;">rejected</strong> and returned to you for corrections:</p>
            <div style="background: white; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <h2 style="margin: 0 0 8px; color: #1e293b; font-size: 18px;">${projectName}</h2>
              <p style="margin: 0 0 4px; color: #64748b; font-size: 14px;">From: <strong>${fromTeam}</strong> → Back to: <strong>${toTeam}</strong></p>
              ${notes ? `<p style="margin: 8px 0 0; color: #dc2626; font-size: 14px; font-weight: 600;">Reason: ${notes}</p>` : ''}
            </div>
            ${viewProjectBtn || `<p style="margin: 0; color: #64748b; font-size: 14px;">Please address the issues and re-transfer the project.</p>`}
          </div>
        </div>
      `;
    } else {
      throw new Error(`Unknown notification type: ${type}`);
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(creds, "MINT Updates"),
        ...resendReplyTo(creds),
        to: [recipientEmail],
        ...(Array.isArray(cc) && cc.length > 0 ? { cc } : {}),
        subject,
        html: htmlContent,
      }),
    });

    const result = await emailResponse.json();
    
    if (!emailResponse.ok) {
      console.error("Resend error:", result);
      throw new Error(result.message || "Failed to send email");
    }

    console.log("Email sent successfully:", result);

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send notification error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/send-notification")({
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
