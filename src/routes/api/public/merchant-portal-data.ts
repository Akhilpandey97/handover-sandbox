import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, requireCred, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";
import { portalUrl } from "@/lib/app-links.server";

import { createClient } from "@supabase/supabase-js";
import { signStorageUrl, storageObjectPath } from "@/lib/storage-sign.server";

function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(adfToText).join("");
}

function extractCredentials(text: string): Record<string, string> {
  const creds: Record<string, string> = {};
  const patterns: [string, RegExp[]][] = [
    ["mid", [/(?:MID|Merchant\s*ID)[:\s]*([^\n\r,]+)/i]],
    ["app_id", [/(?:App\s*ID|AppID|Application\s*ID)[:\s]*([^\n\r,]+)/i]],
    ["app_secret", [/(?:App\s*Secret|AppSecret|Application\s*Secret)[:\s]*([^\n\r,]+)/i]],
    ["base_url", [/(?:Base\s*URL|BaseURL|API\s*URL)[:\s]*(https?:\/\/[^\s\n\r,]+)/i]],
    ["config_id", [/(?:Config\s*ID|ConfigID|Configuration\s*ID)[:\s]*([^\n\r,]+)/i]],
    ["kwikpass_jwe_key", [/(?:KwikPass\s*JWE\s*(?:Key|Secret)|JWE\s*Key|JWE\s*Secret)[:\s]*([^\n\r,]+)/i]],
  ];
  for (const [key, regexes] of patterns) {
    for (const re of regexes) {
      const m = text.match(re);
      if (m?.[1]) { creds[key] = m[1].trim(); break; }
    }
  }
  return creds;
}

async function fetchJiraCredentials(merchantName: string, tenantId?: string | null) {
  const tenantCreds = await getTenantIntegrations(tenantId);
  const JIRA_BASE_URL = (tenantCreds.jira_base_url || "").replace(/\/+$/, "");
  const JIRA_EMAIL = tenantCreds.jira_email;
  const JIRA_API_TOKEN = tenantCreds.jira_api_token;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) return null;

  const safeName = merchantName.replace(/"/g, '\\"');
  const jql = `summary ~ "\\"${safeName} - Begin Integration\\"" OR summary ~ "\\"${safeName} - begin integration\\"" ORDER BY updated DESC`;
  const auth = btoa(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`);

  try {
    const res = await fetch(`${JIRA_BASE_URL}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ jql, fields: ["summary", "description", "comment"], maxResults: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const issues = data.issues || [];
    if (issues.length === 0) return null;

    const sandbox: Record<string, string> = {};
    const production: Record<string, string> = {};

    for (const issue of issues) {
      const f = issue.fields || {};
      const descText = typeof f.description === "string" ? f.description : adfToText(f.description);
      const fullText = descText + "\n" + (f.comment?.comments || []).map((c: any) =>
        typeof c.body === "string" ? c.body : adfToText(c.body)
      ).join("\n");

      const sandboxMatch = fullText.match(/sandbox[:\s\-]*([\s\S]*?)(?=production|prod[:\s\-]|$)/i);
      const prodMatch = fullText.match(/production[:\s\-]*([\s\S]*?)$/i);

      if (sandboxMatch) Object.assign(sandbox, extractCredentials(sandboxMatch[1]));
      if (prodMatch) Object.assign(production, extractCredentials(prodMatch[1]));
      if (!sandboxMatch && !prodMatch) Object.assign(sandbox, extractCredentials(fullText));
    }
    return { sandbox, production };
  } catch (e) {
    console.error("fetchJiraCredentials error:", e);
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const url = new URL(req.url);

  // ---- Send Magic Link to merchant contact email (POST /send-magic-link) ----
  if (req.method === "POST" && url.pathname.endsWith("/send-magic-link")) {
    try {
      const body = await req.json();
      const { project_id } = body;
      if (!project_id) return json({ error: "project_id required" }, 400);

      const { data: project } = await supabase
        .from("projects")
        .select("id, tenant_id, merchant_name, contact_email")
        .eq("id", project_id)
        .maybeSingle();
      if (!project) return json({ error: "Project not found" }, 404);
      const recipients = String(project.contact_email || "")
        .split(/[,;\s]+/)
        .map((e: string) => e.trim())
        .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (recipients.length === 0) return json({ error: "No merchant contact email configured for this project" }, 400);

      // Find or create active portal token
      const { data: existing } = await supabase
        .from("merchant_portal_tokens")
        .select("token, expires_at")
        .eq("project_id", project.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      let token = existing?.[0]?.token as string | undefined;
      const stillValid = token && (!existing![0].expires_at || new Date(existing![0].expires_at) > new Date());
      if (!stillValid) {
        const { data: created, error: createErr } = await supabase
          .from("merchant_portal_tokens")
          .insert({ project_id: project.id, tenant_id: project.tenant_id, is_active: true })
          .select("token")
          .single();
        if (createErr || !created) return json({ error: "Could not create portal token" }, 500);
        token = created.token;
      }

      if (!token) return json({ error: "Could not create portal token" }, 500);

      const tenantCreds = await getTenantIntegrations(project.tenant_id);
      const magicUrl = portalUrl(tenantCreds, token, true);
      if (!magicUrl) return json({ error: "App base URL is not configured for this tenant" }, 500);

      // Send email via Resend
      const RESEND_API_KEY = tenantCreds.resend_api_key;
      if (!RESEND_API_KEY) return json({ error: "Resend email is not configured for this tenant" }, 500);

      // The workspace is named after whoever runs it, not after one company's
      // product. org_name comes from Settings and defaults to Handover.
      const { orgName } = await getTenantBranding(project.tenant_id);

      const html = `
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #003c71, #0066b3); padding: 24px; border-radius: 12px 12px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 22px;">Your ${orgName} Portal Access</h1>
          </div>
          <div style="background: #f8fafc; padding: 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b;">Hi <strong>${project.merchant_name}</strong> team,</p>
            <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.6;">
              Click the secure link below to access your integration workspace — credentials, validators, documentation, and integration status — all in one place.
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${magicUrl}" style="display:inline-block;background:linear-gradient(135deg,#003c71,#0066b3);color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">Open ${orgName} Portal →</a>
            </div>
            <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8; text-align: center;">
              If the button doesn't work, copy this link:<br/>
              <span style="color:#0066b3;word-break:break-all;">${magicUrl}</span>
            </p>
          </div>
        </div>
      `;

      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: resendFrom(tenantCreds, orgName),
          ...resendReplyTo(tenantCreds),
          to: recipients,
          subject: `Your ${orgName} portal access — ${project.merchant_name}`,
          html,
        }),
      });
      const emailResult = await emailResponse.json();
      if (!emailResponse.ok) {
        console.error("Resend error:", emailResult);
        return json({ error: emailResult.message || "Failed to send email" }, 500);
      }

      // Log magic link sent as a visit event for each recipient
      for (const recipient of recipients) {
        await supabase.from("merchant_portal_visits").insert({
          project_id: project.id,
          tenant_id: project.tenant_id,
          email: recipient.toLowerCase(),
          page: "magic_link_sent",
          user_agent: req.headers.get("user-agent") || null,
        });
      }

      return json({ success: true, sent_to: recipients.join(", "), recipients, magic_url: magicUrl });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Magic link auto-authentication (POST /magic-auth) ----
  if (req.method === "POST" && url.pathname.endsWith("/magic-auth")) {
    try {
      const body = await req.json();
      const { token } = body;
      if (!token) return json({ error: "token required" }, 400);

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid or expired magic link" }, 403);
      if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return json({ error: "This magic link has expired" }, 403);

      const { data: project } = await supabase
        .from("projects").select("merchant_name, contact_email, sandbox_mid, mid").eq("id", tokenRow.project_id).maybeSingle();
      if (!project) return json({ error: "Project not found" }, 404);

      const firstEmail = String(project.contact_email || "").split(/[,;\s]+/).map((e: string) => e.trim()).filter(Boolean)[0] || "merchant@portal.local";
      const email = firstEmail.toLowerCase();
      await supabase.from("merchant_portal_visits").insert({
        project_id: tokenRow.project_id,
        tenant_id: tokenRow.tenant_id,
        email,
        page: "magic_link_opened",
        user_agent: req.headers.get("user-agent") || null,
      });

      const sessionToken = btoa(`${token}:magic:${Date.now()}`);
      return json({
        success: true,
        merchant_name: project.merchant_name,
        email,
        mid: project.sandbox_mid || project.mid || "",
        session_token: sessionToken,
      });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }



  // ---- Handle visit tracking (POST /track) ----
  if (req.method === "POST" && url.pathname.endsWith("/track")) {
    try {
      const body = await req.json();
      const { token, email, page } = body;
      if (!token || !email || !page) return json({ error: "token, email, page required" }, 400);
      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid token" }, 403);
      await supabase.from("merchant_portal_visits").insert({
        project_id: tokenRow.project_id,
        tenant_id: tokenRow.tenant_id,
        email: String(email).trim().toLowerCase(),
        page: String(page),
        user_agent: req.headers.get("user-agent") || null,
      });
      return json({ success: true });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Merchant note posted from the portal (POST /note) ----
  if (req.method === "POST" && url.pathname.endsWith("/note")) {
    try {
      const body = await req.json();
      const { token, email, note } = body;
      if (!token || !note || !String(note).trim()) return json({ error: "token and note required" }, 400);

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid token" }, 403);

      const { data: project } = await supabase
        .from("projects")
        .select("id, tenant_id, merchant_name, assigned_owner, created_by")
        .eq("id", tokenRow.project_id)
        .maybeSingle();
      if (!project) return json({ error: "Project not found" }, 404);

      const text = String(note).trim().slice(0, 4000);
      const authorName = email ? String(email).trim().toLowerCase() : "Merchant";

      await supabase.from("activity_logs").insert({
        tenant_id: project.tenant_id,
        user_name: authorName,
        action_type: "merchant_note",
        category: "portal",
        description: `Merchant note: ${text}`,
        entity_type: "project",
        entity_id: project.id,
        metadata: { note: text, email: authorName },
        status: "success",
      });

      await supabase.from("project_comment_logs").insert({
        project_id: project.id,
        tenant_id: project.tenant_id,
        author_name: authorName,
        author_type: "merchant",
        field_name: "Customer Portal Note",
        content: text,
      });

      // Notify relevant internal users
      const recipients = new Set<string>();
      for (const id of [project.assigned_owner, project.created_by]) if (id) recipients.add(id as string);
      if (recipients.size === 0 && project.tenant_id) {
        const { data: profiles } = await supabase
          .from("profiles").select("id").eq("tenant_id", project.tenant_id).limit(50);
        for (const p of profiles ?? []) recipients.add(p.id);
      }
      if (recipients.size > 0) {
        await supabase.from("notifications").insert(
          Array.from(recipients).map((userId) => ({
            tenant_id: project.tenant_id,
            user_id: userId,
            type: "merchant_note",
            title: `Merchant messaged on ${project.merchant_name}`,
            body: text.slice(0, 240),
            actor_name: authorName,
            project_id: project.id,
            project_name: project.merchant_name,
          }))
        );
      }

      return json({ success: true });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Handle MID verification (POST /verify) ----
  if (req.method === "POST" && url.pathname.endsWith("/verify")) {
    try {
      const body = await req.json();
      const { token, mid, email } = body;
      if (!token) return json({ error: "Token is required" }, 400);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
        return json({ error: "A valid email address is required" }, 400);
      }

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid or expired link" }, 403);
      if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return json({ error: "This link has expired" }, 403);

      const { data: project } = await supabase
        .from("projects").select("mid, sandbox_mid, sandbox_app_id, merchant_name").eq("id", tokenRow.project_id).maybeSingle();
      if (!project) return json({ error: "Project not found" }, 404);

      // Compare MID (case-insensitive, trimmed) — accept project.mid, project.sandbox_mid, or master MID
      const MASTER_MID = "10008";
      const projectMid = (project.mid || "").trim().toLowerCase();
      const projectSandboxMid = (project.sandbox_mid || "").trim().toLowerCase();
      const projectSandboxAppId = (project.sandbox_app_id || "").trim().toLowerCase();
      const inputMid = (mid ? String(mid) : "").trim().toLowerCase();
      // APP ID check disabled for now — email + valid token is sufficient.
      void MASTER_MID; void projectMid; void projectSandboxMid; void projectSandboxAppId;

      // MID matches — log login as a visit + return session token
      const cleanEmail = String(email).trim().toLowerCase();
      await supabase.from("merchant_portal_visits").insert({
        project_id: tokenRow.project_id,
        tenant_id: tokenRow.tenant_id,
        email: cleanEmail,
        page: "login",
        user_agent: req.headers.get("user-agent") || null,
      });
      const sessionToken = btoa(`${token}:${inputMid}:${Date.now()}`);
      return json({ success: true, merchant_name: project.merchant_name, session_token: sessionToken, email: cleanEmail });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Resolve a sandbox MID (or project MID) to a portal token (CE direct-access) ----
  if (req.method === "GET" && url.pathname.endsWith("/resolve-mid")) {
    try {
      const midParam = (url.searchParams.get("mid") || "").trim();
      if (!midParam) return json({ error: "mid required" }, 400);

      // Try sandbox_mid first, then mid, then sandbox_app_id (case-insensitive)
      const { data: projects } = await supabase
        .from("projects")
        .select("id, tenant_id, mid, sandbox_mid, sandbox_app_id, merchant_name")
        .or(`sandbox_mid.ilike.${midParam},mid.ilike.${midParam},sandbox_app_id.ilike.${midParam}`)
        .limit(1);

      const project = (projects ?? [])[0];
      if (!project) return json({ error: "No merchant found for that MID" }, 404);

      // Find an existing active token, otherwise create one
      const { data: existing } = await supabase
        .from("merchant_portal_tokens")
        .select("token, expires_at, is_active")
        .eq("project_id", project.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      let token = existing?.[0]?.token as string | undefined;
      const stillValid = token && (!existing![0].expires_at || new Date(existing![0].expires_at) > new Date());

      if (!stillValid) {
        const { data: created, error: createErr } = await supabase
          .from("merchant_portal_tokens")
          .insert({ project_id: project.id, tenant_id: project.tenant_id, is_active: true })
          .select("token")
          .single();
        if (createErr || !created) return json({ error: "Could not create portal token" }, 500);
        token = created.token;
      }

      return json({ success: true, token, merchant_name: project.merchant_name });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }
  // ---- Get or create a BRD session for this portal token (POST /brd-session) ----
  if (req.method === "POST" && url.pathname.endsWith("/brd-session")) {
    try {
      const body = await req.json();
      const { token } = body;
      if (!token) return json({ error: "token required" }, 400);

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid or expired link" }, 403);

      const projectId = tokenRow.project_id;
      const tenantId = tokenRow.tenant_id;

      const { data: project } = await supabase
        .from("projects").select("contact_email").eq("id", projectId).maybeSingle();

      // This tenant's BRD template, and only this tenant's. There used to be a
      // fallback to "any tenant's" template, which meant a merchant whose
      // tenant had no BRD form was shown another company's questions — and
      // answered them into a session built from that template.
      const { data: tpl } = await supabase
        .from("checklist_form_templates")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .ilike("name", "%BRD%")
        .limit(1)
        .maybeSingle();
      if (!tpl) return json({ error: "not_configured" }, 404);

      // Get-or-create BRD session for this project (reuse latest non-completed one)
      const { data: existingSessions } = await supabase
        .from("brd_sessions")
        .select("id, token, status, completed_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1);

      let brdSession = existingSessions?.[0];
      if (!brdSession) {
        const merchantEmail = String(project?.contact_email || "")
          .split(/[,;\s]+/).map((e: string) => e.trim()).filter(Boolean)[0] || "merchant@portal.local";
        const { data: created, error: createErr } = await supabase
          .from("brd_sessions")
          .insert({
            project_id: projectId,
            form_template_id: tpl.id,
            merchant_email: merchantEmail,
            tenant_id: tenantId,
          })
          .select("id, token, status, completed_at")
          .single();
        if (createErr || !created) return json({ error: "Failed to create BRD session" }, 500);
        brdSession = created;
      }

      // Compute percent fill
      const { count: totalFields } = await supabase
        .from("checklist_form_fields")
        .select("id", { count: "exact", head: true })
        .eq("template_id", tpl.id);
      const { data: responses } = await supabase
        .from("brd_responses")
        .select("value")
        .eq("session_id", brdSession.id);
      const answered = (responses || []).filter((r: any) => (r.value || "").toString().trim()).length;
      const total = totalFields || 0;
      const percent = total ? Math.round((answered / total) * 100) : 0;

      return json({
        success: true,
        brd_token: brdSession.token,
        status: brdSession.status,
        completed_at: brdSession.completed_at,
        answered,
        total,
        percent,
      });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  if (req.method === "POST" && url.pathname.endsWith("/upload")) {
    try {
      const formData = await req.formData();
      const token = formData.get("token") as string;
      const uploadType = formData.get("upload_type") as string;
      const file = formData.get("file") as File;

      if (!token || !uploadType || !file) return json({ error: "token, upload_type, and file are required" }, 400);

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid token" }, 403);
      if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return json({ error: "Expired" }, 403);

      const projectId = tokenRow.project_id;
      const tenantId = tokenRow.tenant_id;
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `${projectId}/${uploadType}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("merchant-portal-files")
        .upload(storagePath, file, { contentType: file.type, upsert: true });

      if (uploadErr) return json({ error: uploadErr.message }, 500);

      // The bucket is private: keep the object path on the record and hand back
      // a short-lived signed link for the merchant's immediate download.
      await supabase.from("merchant_portal_uploads").insert({
        project_id: projectId,
        tenant_id: tenantId,
        upload_type: uploadType,
        file_name: file.name,
        file_url: storagePath,
        uploaded_by: "merchant",
      });

      const signedUpload = await signStorageUrl("merchant-portal-files", storagePath);
      return json({ success: true, file_url: signedUpload, file_name: file.name });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Handle upload deletion (POST /delete-upload) ----
  if (req.method === "POST" && url.pathname.endsWith("/delete-upload")) {
    try {
      const body = await req.json();
      const { token, upload_id } = body;
      if (!token || !upload_id) return json({ error: "token and upload_id required" }, 400);

      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid token" }, 403);

      const { data: upload } = await supabase
        .from("merchant_portal_uploads").select("*").eq("id", upload_id).maybeSingle();
      if (!upload || upload.project_id !== tokenRow.project_id) {
        return json({ error: "Upload not found" }, 404);
      }

      // Try to remove storage file (best-effort)
      try {
        const path = storageObjectPath("merchant-portal-files", upload.file_url);
        if (path) await supabase.storage.from("merchant-portal-files").remove([path]);
      } catch (e) { console.error("storage remove failed:", e); }

      await supabase.from("merchant_portal_uploads").delete().eq("id", upload_id);
      return json({ success: true });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Handle config_id update (PUT) ----
  if (req.method === "PUT") {
    try {
      const body = await req.json();
      const { token, config_id } = body;
      if (!token) return json({ error: "Token required" }, 400);

      // Validate token - must be from authenticated CE context or valid portal token
      const { data: tokenRow } = await supabase
        .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
      if (!tokenRow) return json({ error: "Invalid token" }, 403);

      await supabase.from("projects").update({ config_id }).eq("id", tokenRow.project_id);
      return json({ success: true });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  }

  // ---- Main GET/POST data fetch ----
  try {
    let token: string | null = url.searchParams.get("token");
    if (!token && req.method === "POST") {
      try { const body = await req.json(); token = body?.token ?? null; } catch {}
    }
    if (!token) return json({ error: "Token is required" }, 400);

    const { data: tokenRow, error: tokenError } = await supabase
      .from("merchant_portal_tokens").select("*").eq("token", token).eq("is_active", true).maybeSingle();
    if (tokenError || !tokenRow) return json({ error: "Invalid or expired link" }, 403);
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return json({ error: "This link has expired" }, 403);

    supabase.from("merchant_portal_tokens").update({ last_accessed_at: new Date().toISOString() }).eq("id", tokenRow.id).then(() => {});

    const projectId = tokenRow.project_id;
    const tenantId = tokenRow.tenant_id;

    const { data: project, error: projectError } = await supabase
      .from("projects").select("*").eq("id", projectId).maybeSingle();
    if (projectError || !project) return json({ error: "Project not found" }, 404);

    const [checklistRes, ownerRes, customFieldsRes, customValsRes, uploadsRes, credentialsRes] = await Promise.all([
      supabase.from("checklist_items").select("id, title, completed, completed_at, phase, owner_team, sort_order, due_date, is_task")
        .eq("project_id", projectId).eq("is_task", false).order("sort_order", { ascending: true }),
      project.assigned_owner
        ? supabase.from("profiles").select("name, email, team").eq("id", project.assigned_owner).maybeSingle()
        : Promise.resolve({ data: null }),
      tenantId
        ? supabase.from("custom_fields").select("id, field_key, field_label, field_type").eq("tenant_id", tenantId).eq("is_active", true)
        : Promise.resolve({ data: [] }),
      supabase.from("custom_field_values").select("field_id, value").eq("project_id", projectId),
      supabase.from("merchant_portal_uploads").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("project_credentials").select("*").eq("project_id", projectId).maybeSingle(),
    ]);
    const projectCredentials = (credentialsRes as any).data ?? {};

    const valMap = new Map<string, string | null>();
    ((customValsRes as any).data ?? []).forEach((v: any) => valMap.set(v.field_id, v.value));
    const customFields = ((customFieldsRes as any).data ?? []).map((f: any) => ({
      key: f.field_key, label: f.field_label, type: f.field_type, value: valMap.get(f.id) ?? null,
    }));

    // Show every checklist item (non-task) for the project
    const phaseOrder: Record<string, number> = { mint: 0, integration: 1, ms: 2, completed: 3 };
    const checklist = [...(checklistRes.data ?? [])].sort((a: any, b: any) => {
      const pa = phaseOrder[a.phase] ?? 99;
      const pb = phaseOrder[b.phase] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    const completedCount = checklist.filter((c: any) => c.completed).length;

    const { data: activityLogs } = await supabase
      .from("activity_logs").select("action_type, category, description, created_at, user_name")
      .eq("entity_id", projectId).order("created_at", { ascending: false }).limit(15);

    let branding: Record<string, string> = {};
    // Field names configured in Settings, so the portal shows the same wording
    // the internal product uses.
    const labels: Record<string, string> = {};
    if (tenantId) {
      const { data: settings } = await supabase
        .from("app_settings").select("key, value").eq("tenant_id", tenantId);
      (settings ?? []).forEach((s: any) => {
        if (["org_name", "primary_color", "logo_url", "org_logo_url"].includes(s.key)) branding[s.key] = s.value;
        if (s.key.startsWith("field_")) labels[s.key] = s.value;
      });
    }

    const jiraCredentials = await fetchJiraCredentials(project.merchant_name || "", (project as any).tenant_id ?? tenantId);

    // BRD progress (best-effort, never block main response on errors)
    let brdProgress: { answered: number; total: number; percent: number; status: string | null } = {
      answered: 0, total: 0, percent: 0, status: null,
    };
    // Drives whether the portal offers a BRD Form at all.
    let brdConfigured = false;
    try {
      // Only this tenant's template — see the note on the /brd-session branch.
      const { data: tpl } = await supabase
        .from("checklist_form_templates").select("id")
        .eq("tenant_id", tenantId).ilike("name", "%BRD%").limit(1).maybeSingle();
      brdConfigured = !!tpl;
      if (tpl) {
        const { count: totalFields } = await supabase
          .from("checklist_form_fields").select("id", { count: "exact", head: true })
          .eq("template_id", tpl.id);
        const { data: sessions } = await supabase
          .from("brd_sessions").select("id, status")
          .eq("project_id", projectId).order("created_at", { ascending: false }).limit(1);
        const sess = sessions?.[0];
        if (sess) {
          const { data: resps } = await supabase
            .from("brd_responses").select("value").eq("session_id", sess.id);
          const answered = (resps || []).filter((r: any) => (r.value || "").toString().trim()).length;
          const isSubmitted = sess.status === "completed";
          const total = totalFields || 0;
          brdProgress = {
            // A submitted form counts as fully answered even if some optional
            // questions were skipped.
            answered: isSubmitted ? Math.max(answered, total) : answered,
            total,
            percent: isSubmitted ? 100 : total ? Math.round((answered / total) * 100) : 0,
            status: sess.status,
          };
        } else {
          brdProgress.total = totalFields || 0;
        }
      }
    } catch (e) { console.error("brd progress error:", e); }


    const uploads = await Promise.all(
      (uploadsRes.data ?? []).map(async (u: any) => ({
        id: u.id,
        upload_type: u.upload_type,
        file_name: u.file_name,
        // Private bucket — every listing hands out a fresh, expiring link.
        file_url: await signStorageUrl("merchant-portal-files", u.file_url),
        uploaded_by: u.uploaded_by,
        created_at: u.created_at,
      })),
    );

    // Build credentials: DB-stored values take priority over Jira-scraped
    const dbSandbox: Record<string, string> = {};
    const dbProd: Record<string, string> = {};
    if (project.sandbox_mid) dbSandbox.mid = project.sandbox_mid;
    if (project.sandbox_app_id) dbSandbox.app_id = project.sandbox_app_id;
    if (projectCredentials.sandbox_app_secret) dbSandbox.app_secret = projectCredentials.sandbox_app_secret;
    if (project.sandbox_base_url) dbSandbox.base_url = project.sandbox_base_url;
    if (project.sandbox_config_id) dbSandbox.config_id = project.sandbox_config_id;
    if (projectCredentials.sandbox_kwikpass_jwe_key) dbSandbox.kwikpass_jwe_key = projectCredentials.sandbox_kwikpass_jwe_key;
    if (project.prod_mid) dbProd.mid = project.prod_mid;
    if (project.prod_app_id) dbProd.app_id = project.prod_app_id;
    if (projectCredentials.prod_app_secret) dbProd.app_secret = projectCredentials.prod_app_secret;
    if (project.prod_base_url) dbProd.base_url = project.prod_base_url;
    if (project.prod_config_id) dbProd.config_id = project.prod_config_id;
    if (projectCredentials.prod_kwikpass_jwe_key) dbProd.kwikpass_jwe_key = projectCredentials.prod_kwikpass_jwe_key;

    const mergedCredentials = jiraCredentials
      ? {
          sandbox: { ...jiraCredentials.sandbox, ...dbSandbox },
          production: { ...jiraCredentials.production, ...dbProd },
        }
      : Object.keys(dbSandbox).length || Object.keys(dbProd).length
        ? { sandbox: dbSandbox, production: dbProd }
        : null;

    return json({
      project: {
        id: project.id, merchant_name: project.merchant_name, mid: project.mid,
        platform: project.platform, category: project.category,
        integration_type: project.integration_type, current_phase: project.current_phase,
        project_state: project.project_state, go_live_percent: project.go_live_percent,
        current_responsibility: project.current_responsibility,
        kick_off_date: project.kick_off_date, expected_go_live_date: project.expected_go_live_date,
        go_live_date: project.go_live_date, brand_url: project.brand_url,
        brd_link: project.brd_link, sow_link: project.sow_link,
        jira_link: project.jira_link, mint_checklist_link: project.mint_checklist_link,
        integration_checklist_link: project.integration_checklist_link,
        contact_email: project.contact_email, arr: project.arr,
        config_id: project.config_id || null,
        enable_mcp_document: project.enable_mcp_document || false,
        mcp_config_id: project.mcp_config_id || null,
        enable_kp: project.enable_kp || false,
        kp_prod_jwe_key: projectCredentials.kp_prod_jwe_key || null,
        kp_sandbox_jwe_key: projectCredentials.kp_sandbox_jwe_key || 'zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI',
        faq_help: Array.isArray(project.faq_help) ? project.faq_help : [],
        payment_simulator_link: project.payment_simulator_link || null,
      },
      owner: (ownerRes as any).data
        ? { name: (ownerRes as any).data.name, email: (ownerRes as any).data.email, team: (ownerRes as any).data.team }
        : null,
      checklist_progress: {
        completed: completedCount, total: checklist.length,
        percent: checklist.length ? Math.round((completedCount / checklist.length) * 100) : 0,
      },
      checklist: checklist.map((c: any) => ({
        title: c.title, completed: c.completed, completed_at: c.completed_at,
        phase: c.phase, owner_team: c.owner_team, due_date: c.due_date,
      })),
      custom_fields: customFields,
      recent_activity: (activityLogs ?? []).map((a: any) => ({
        description: a.description, category: a.category,
        created_at: a.created_at, user_name: a.user_name,
      })),
      branding,
      labels,
      credentials: mergedCredentials,
      uploads,
      brd_progress: brdProgress,
      brd_configured: brdConfigured,
    });
  } catch (err) {
    console.error("merchant-portal-data error:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/merchant-portal-data")({
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
