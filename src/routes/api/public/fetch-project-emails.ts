import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred } from "@/lib/tenant-integrations.server";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The internal Gmail account whose mailbox we read.
const INTERNAL_EMAIL = "akhil.pandey@gokwik.co";

// Decode base64url (Gmail) -> UTF-8 string
function decodeBase64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

// Recursively walk MIME parts to extract text/plain and text/html bodies
function extractBodies(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  const walk = (part: any) => {
    if (!part) return;
    const mimeType = part.mimeType || "";
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mimeType === "text/plain" && !text) text = decoded;
      else if (mimeType === "text/html" && !html) html = decoded;
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };

  walk(payload);
  return { text, html };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
    const __body0 = await req.clone().json().catch(() => ({} as any));
    const creds = await getTenantIntegrations(await tenantIdFromRequest(req, __body0.tenant_id));
    const GOOGLE_MAIL_API_KEY = creds.google_mail_api_key || process.env['GOOGLE_MAIL_API_KEY'];

    if (!LOVABLE_API_KEY || !GOOGLE_MAIL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gmail connector not linked. Please connect Gmail in project settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gatewayHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
    };

    const body = await req.json().catch(() => ({}));
    const { project_id, tenant_id } = body;

    if (!project_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: "project_id and tenant_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, merchant_name, mid, contact_email")
      .eq("id", project_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!project.merchant_name && !project.contact_email) {
      return new Response(
        JSON.stringify({ threads: [], message: "No merchant_name or contact_email set for this project." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Search Gmail threads — by merchant name in subject (primary), with contact emails as fallback.
    const merchantName = project.merchant_name;
    const contactEmails = String(project.contact_email || "")
      .split(/[,;\s]+/)
      .map((e: string) => e.trim())
      .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const contactEmail = contactEmails[0];
    const clauses: string[] = [];
    if (merchantName) clauses.push(`subject:"${merchantName.replace(/"/g, '\\"')}"`);
    for (const em of contactEmails) {
      clauses.push(`from:${em}`);
      clauses.push(`to:${em}`);
      clauses.push(`cc:${em}`);
    }
    const query = `(${clauses.join(" OR ")}) newer_than:180d`;
    const searchUrl = `https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`;

    console.log(`[fetch-project-emails] mailbox=${INTERNAL_EMAIL} query=${query}`);

    const searchRes = await fetch(searchUrl, {
      headers: gatewayHeaders,
    });
    const searchData = await searchRes.json();

    if (searchData.error) {
      console.error("Gmail API error:", searchData.error);
      return new Response(
        JSON.stringify({ error: `Gmail API error: ${searchData.error.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const threads = searchData.threads || [];
    const searchLabel = merchantName || contactEmail;
    console.log(`Found ${threads.length} threads for ${searchLabel}`);

    if (threads.length === 0) {
      return new Response(
        JSON.stringify({ threads: [], message: "No email threads found in the last 180 days." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Fetch FULL thread bodies (format=full)
    const threadDetails: any[] = [];

    for (const thread of threads.slice(0, 20)) {
      try {
        const threadUrl = `https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/threads/${thread.id}?format=full`;
        const threadRes = await fetch(threadUrl, {
          headers: gatewayHeaders,
        });
        const threadData = await threadRes.json();

        if (threadData.error) {
          console.error(`Error fetching thread ${thread.id}:`, threadData.error);
          continue;
        }

        const messages = threadData.messages || [];
        if (messages.length === 0) continue;

        const getHeader = (msg: any, name: string): string =>
          msg?.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];

        const subject = getHeader(firstMsg, "Subject") || "(No subject)";
        const latestDate = getHeader(lastMsg, "Date");

        // Build full message array with bodies
        const messageRecords = messages.map((msg: any) => {
          const { text, html } = extractBodies(msg.payload);
          return {
            id: msg.id,
            from: getHeader(msg, "From"),
            to: getHeader(msg, "To"),
            cc: getHeader(msg, "Cc"),
            date: getHeader(msg, "Date"),
            subject: getHeader(msg, "Subject"),
            snippet: msg.snippet || "",
            body_text: text,
            body_html: html,
          };
        });

        // Collect unique participants
        const participantSet = new Set<string>();
        for (const m of messageRecords) {
          [m.from, m.to, m.cc]
            .filter(Boolean)
            .flatMap((v: string) => v.split(","))
            .map((e: string) => e.trim())
            .filter(Boolean)
            .forEach((e: string) => participantSet.add(e));
        }

        threadDetails.push({
          gmail_thread_id: thread.id,
          gmail_message_id: lastMsg?.id || firstMsg?.id || "",
          project_id,
          tenant_id,
          subject,
          snippet: threadData.snippet || lastMsg?.snippet || "",
          participants: Array.from(participantSet),
          thread_date: latestDate ? new Date(latestDate).toISOString() : new Date().toISOString(),
          message_count: messages.length,
          raw_headers: {
            subject,
            from: getHeader(firstMsg, "From"),
            to: getHeader(firstMsg, "To"),
          },
          messages: messageRecords,
          bodies_fetched_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`Error processing thread ${thread.id}:`, err);
      }
    }

    if (threadDetails.length > 0) {
      const { error: upsertError } = await supabase
        .from("project_emails")
        .upsert(threadDetails, { onConflict: "gmail_thread_id,project_id" });

      if (upsertError) {
        console.error("Error upserting project_emails:", upsertError);
      }
    }

    return new Response(
      JSON.stringify({
        threads: threadDetails.map((t) => ({ ...t, messages: undefined })),
        total: threadDetails.length,
        message: `Fetched ${threadDetails.length} thread(s) for ${searchLabel}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-project-emails:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

export const Route = createFileRoute("/api/public/fetch-project-emails")({
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
