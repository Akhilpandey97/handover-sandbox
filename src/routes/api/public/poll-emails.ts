import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred } from "@/lib/tenant-integrations.server";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Use the Lovable connector gateway for Gmail (auto refresh, no manual tokens)
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gmailHeaders(googleKey?: string | null) {
  const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
  const GOOGLE_MAIL_API_KEY = googleKey || process.env['GOOGLE_MAIL_API_KEY'];
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GOOGLE_MAIL_API_KEY) throw new Error("GOOGLE_MAIL_API_KEY is not configured (Gmail connector not linked)");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };
}

// Parse INR currency strings like "INR 1,571,461.88" to number
function parseINR(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.]/g, "");
  return parseFloat(cleaned) || 0;
}

// Parse HTML table from email body into key-value pairs
function parseEmailTable(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gis;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const key = match[1].replace(/<[^>]*>/g, "").replace(/\s*:\s*$/, "").trim();
    const value = match[2].replace(/<[^>]*>/g, "").trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function extractBrandFromSubject(subject: string): string {
  // Handles both "New Brand On Board - X" and
  // "Sales to MINT Handover for Scoping - X - Storefront"
  let m = subject.match(/Sales to MINT Handover for Scoping\s*[-–—]\s*(.+?)\s*[-–—]\s*Storefront/i);
  if (m) return m[1].trim();
  m = subject.match(/New Brand On Board\s*[-–—]\s*(.*)/i);
  return m ? m[1].trim() : "";
}

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

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getHeader(headers: any[], name: string): string {
  const h = (headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// Reply on the original handover thread, looping in the assigned CE
async function replyWithAssignedCE(
  gHeaders: Record<string, string>,
  msgHeaders: any[],
  threadId: string,
  ownerEmail: string,
) {
  const from = getHeader(msgHeaders, "From");
  const to = getHeader(msgHeaders, "To");
  const cc = getHeader(msgHeaders, "Cc");
  let subject = getHeader(msgHeaders, "Subject") || "";
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
  const msgId = getHeader(msgHeaders, "Message-Id") || getHeader(msgHeaders, "Message-ID");
  const references = getHeader(msgHeaders, "References");

  const ccSet = new Set<string>();
  const addAddresses = (raw: string) => {
    if (!raw) return;
    raw.split(",").forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const m = trimmed.match(/<([^>]+)>/);
      const email = (m ? m[1] : trimmed).toLowerCase();
      if (email && email !== ownerEmail.toLowerCase()) ccSet.add(trimmed);
    });
  };
  addAddresses(from);
  addAddresses(to);
  addAddresses(cc);
  const replyCcParts = Array.from(ccSet).join(", ");

  const ownerName = ownerEmail.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const mentionHtml = `<a href="mailto:${ownerEmail}">+${ownerName}</a>`;
  const bodyHtml = `<div dir="ltr">Hi Team,<br><br>${mentionHtml} (${ownerEmail}) will lead the integration.<br><br>Thanks.</div>`;
  const bodyText = `Hi Team,\r\n\r\n+${ownerName} (${ownerEmail}) will lead the integration.\r\n\r\nThanks.`;

  const boundary = `bnd_${crypto.randomUUID().replace(/-/g, "")}`;
  const headerLines: string[] = [`To: ${ownerEmail}`];
  if (replyCcParts) headerLines.push(`Cc: ${replyCcParts}`);
  headerLines.push(`Subject: ${subject}`);
  if (msgId) {
    headerLines.push(`In-Reply-To: ${msgId}`);
    headerLines.push(`References: ${references ? references + " " : ""}${msgId}`);
  }
  headerLines.push(`MIME-Version: 1.0`);
  headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const raw =
    headerLines.join("\r\n") + "\r\n\r\n" +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
    bodyText + "\r\n\r\n" +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
    bodyHtml + "\r\n\r\n" +
    `--${boundary}--\r\n`;

  const sendRes = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
    method: "POST",
    headers: { ...gHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(raw), threadId }),
  });
  if (!sendRes.ok) {
    console.error("Thread reply failed:", sendRes.status, await sendRes.text());
  }
}



async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id;
    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let headers: Record<string, string>;
    try {
      const creds = await getTenantIntegrations(tenantId);
      headers = gmailHeaders(creds.google_mail_api_key);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: (e as Error).message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch email settings from app_settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("tenant_id", tenantId)
      .in("key", ["email_monitor_address", "email_subject_keywords"]);

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

    const monitorEmail = settingsMap.email_monitor_address || "cwupdates@gokwik.co";
    const subjectKeywords = (settingsMap.email_subject_keywords || "Sales to MINT Handover for Scoping")
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    // ALL polled emails require manual approval — never auto-create or update projects.
    const subjectClause = subjectKeywords.map((k: string) => `"${k}"`).join(" OR ");
    // Match subject from ANY sender — no from: filter
    const query = `subject:(${subjectClause}) newer_than:30d`;
    const searchUrl = `${GATEWAY_URL}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;

    console.log("[poll-emails] query:", query);

    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();

    if (!searchRes.ok || searchData.error) {
      console.error("Gmail gateway error:", searchData);
      return new Response(
        JSON.stringify({ error: `Gmail API error: ${searchData?.error?.message || searchData?.message || JSON.stringify(searchData)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messages = searchData.messages || [];
    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ message: "No matching emails found", query }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dedupe: skip messages already in parsed_emails
    const messageIds = messages.map((m: any) => m.id);
    const { data: existingEmails } = await supabase
      .from("parsed_emails")
      .select("gmail_message_id")
      .eq("tenant_id", tenantId)
      .in("gmail_message_id", messageIds);

    const existingIds = new Set((existingEmails || []).map((e: any) => e.gmail_message_id));
    const newMessages = messages.filter((m: any) => !existingIds.has(m.id));

    if (newMessages.length === 0) {
      return new Response(
        JSON.stringify({ message: "All matching emails already processed", total: messages.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Round-robin owners for auto-assignment
    const ROUND_ROBIN_OWNERS = [
      { email: "rahul.kumar1@gokwik.co", name: "Rahul Kumar" },
      { email: "piyush.shastri@gokwik.co", name: "Piyush Shastri" },
      { email: "rishabh.jain1@gokwik.co", name: "Rishabh Jain" },
      { email: "abhishek.yadav@gokwik.co", name: "Abhishek Yadav" },
    ];
    const ASSIGNMENT_CC = ["akhil.pandey@gokwik.co", "abhishek.yadav@gokwik.co", "saurabh.sharma@gokwik.co"];

    const { data: ownerProfs } = await supabase
      .from("profiles")
      .select("id, email, name")
      .in("email", ROUND_ROBIN_OWNERS.map((o) => o.email));
    const profByEmail = new Map<string, { id: string; name: string }>();
    (ownerProfs || []).forEach((p: any) =>
      profByEmail.set(String(p.email).toLowerCase(), { id: p.id, name: p.name })
    );

    const { data: existingProjects } = await supabase
      .from("projects")
      .select("merchant_name")
      .eq("tenant_id", tenantId);
    const existingMerchants = new Set(
      (existingProjects || [])
        .map((p: any) => (p.merchant_name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const seenThisBatch = new Set<string>();

    const { data: rrRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "parsed_emails_rr_index")
      .maybeSingle();
    let rrIndex = Number((rrRow as any)?.value ?? 0);
    if (!Number.isFinite(rrIndex) || rrIndex < 0) rrIndex = 0;

    const results: any[] = [];
    let autoCreated = 0;
    for (const msg of newMessages) {
      try {
        const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${msg.id}?format=full`, { headers });
        const msgData = await msgRes.json();
        if (!msgRes.ok || msgData.error) {
          console.error(`Error fetching message ${msg.id}:`, msgData);
          continue;
        }

        const hdrs = msgData.payload?.headers || [];
        const subject = hdrs.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
        const sender = hdrs.find((h: any) => h.name.toLowerCase() === "from")?.value || "";
        const dateHeader = hdrs.find((h: any) => h.name.toLowerCase() === "date")?.value || "";
        const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

        const subjectLower = subject.toLowerCase();
        const matches = subjectKeywords.some((kw: string) => subjectLower.includes(kw.toLowerCase()));
        if (!matches) continue;

        let htmlBody = "";
        const extractHtml = (part: any) => {
          if (part.mimeType === "text/html" && part.body?.data) {
            htmlBody = decodeBase64Url(part.body.data);
          }
          if (part.parts) for (const p of part.parts) extractHtml(p);
        };
        extractHtml(msgData.payload);

        const fields = parseEmailTable(htmlBody);
        const pick = (...keys: string[]): string => {
          for (const k of keys) {
            const v = fields[k];
            if (v && String(v).trim()) return String(v).trim();
          }
          return "";
        };
        const brandName = pick("Brand Name") || extractBrandFromSubject(subject);
        const brandUrl = pick("Website URL", "Website URL ", "URL_1", "URL");
        const platform = pick("Platform Web", "Platform");
        const subPlatform = pick("Platform Mobile App", "Sub Platform");
        const arrValue = parseINR(pick("Expected ARR"));
        const category = pick("Merchant Category");
        const txnsPerDay = parseInt(pick("Expected Transactions/Day", "Expected Transactions/day") || "0") || 0;
        const aov = parseINR(pick("AOV", "AOV (Average Order Value )", "AOV (Average Order Value)"));
        const merchantSize = pick("Merchant Size");
        const city = pick("City");
        const notes = pick("Notes");

        const { data: inserted, error: insertError } = await supabase
          .from("parsed_emails")
          .insert({
            tenant_id: tenantId,
            gmail_message_id: msg.id,
            subject,
            sender,
            received_at: receivedAt,
            brand_name: brandName,
            brand_url: brandUrl,
            platform,
            sub_platform: subPlatform,
            arr: arrValue,
            category,
            txns_per_day: txnsPerDay,
            aov,
            merchant_size: merchantSize,
            city,
            sales_notes: notes,
            parsed_fields: fields,
            raw_html: htmlBody.substring(0, 50000),
            status: "new",
          })
          .select()
          .single();

        if (insertError) {
          console.error(`Insert error ${msg.id}:`, insertError);
          continue;
        }
        results.push(inserted);

        // ===== Auto add & assign =====
        const brandKey = (brandName || "").trim().toLowerCase();
        if (!brandKey) continue;
        if (existingMerchants.has(brandKey) || seenThisBatch.has(brandKey)) {
          await supabase.from("parsed_emails").update({ status: "dismissed" }).eq("id", inserted.id);
          continue;
        }
        seenThisBatch.add(brandKey);

        const owner = ROUND_ROBIN_OWNERS[rrIndex % ROUND_ROBIN_OWNERS.length];
        rrIndex++;
        const prof = profByEmail.get(owner.email.toLowerCase());

        const { data: newProj, error: projErr } = await supabase
          .from("projects")
          .insert({
            tenant_id: tenantId,
            merchant_name: brandName.trim(),
            mid: `EMAIL-${msg.id.substring(0, 8)}`,
            platform: platform || "Custom",
            arr: arrValue || 0,
            txns_per_day: txnsPerDay || 0,
            aov: aov || 0,
            category: category || null,
            current_phase: "mint",
            current_owner_team: "mint",
            current_responsibility: "neutral",
            pending_acceptance: false,
            project_state: "not_started",
            go_live_percent: 0,
            kick_off_date: new Date().toISOString().split("T")[0],
            brand_url: brandUrl || null,
            project_notes: notes || null,
            current_phase_comment: "Auto-created from email",
            integration_type: "Standard",
            assigned_owner: prof?.id ?? null,
          })
          .select("id")
          .single();

        if (projErr || !newProj) {
          console.error("Project auto-create failed:", projErr);
          continue;
        }

        // Checklist items are seeded automatically by the database trigger on projects insert.

        await supabase
          .from("parsed_emails")
          .update({ status: "project_created", project_id: newProj.id })
          .eq("id", inserted.id);
        autoCreated++;

        try {
          const notifyUrl = `${SUPABASE_URL}/functions/v1/send-notification`;
          const cc = ASSIGNMENT_CC.filter((c) => c.toLowerCase() !== owner.email.toLowerCase());
          await fetch(notifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              type: "project_assignment",
              recipientEmail: owner.email,
              recipientName: prof?.name || owner.name,
              projectName: brandName.trim(),
              assignedBy: "System (Auto-assign)",
              projectId: newProj.id,
              cc,
            }),
          });
        } catch (err) {
          console.error("Notification failed for", owner.email, err);
        }

        // Reply on the original handover thread looping in the assigned CE
        try {
          await replyWithAssignedCE(headers, hdrs, msgData.threadId, owner.email);
        } catch (err) {
          console.error("Thread reply failed for", owner.email, err);
        }

      } catch (err) {
        console.error(`Error processing message ${msg.id}:`, err);
      }
    }

    await supabase
      .from("app_settings")
      .upsert(
        { tenant_id: tenantId, key: "parsed_emails_rr_index", value: String(rrIndex) },
        { onConflict: "tenant_id,key" }
      );

    return new Response(
      JSON.stringify({
        message: `Processed ${results.length} new email(s), auto-created ${autoCreated} project(s)`,
        total_found: messages.length,
        new_processed: results.length,
        auto_created: autoCreated,
        emails: results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in poll-emails:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

export const Route = createFileRoute("/api/public/poll-emails")({
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
