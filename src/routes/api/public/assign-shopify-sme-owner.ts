import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

const ALLOWED_OWNERS = [
  "ankit@gokwik.co",
  "rohit.singh@gokwik.co",
  "deepak.sharma@gokwik.co",
];

function gmailHeaders() {
  const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
  const GOOGLE_MAIL_API_KEY = process.env['GOOGLE_MAIL_API_KEY'];
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GOOGLE_MAIL_API_KEY) throw new Error("Gmail connector not linked");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getHeader(headers: any[], name: string): string {
  const h = headers?.find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { id, owner_email } = await req.json();
    if (!id || !owner_email) {
      return new Response(JSON.stringify({ error: "id and owner_email are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_OWNERS.includes(owner_email)) {
      return new Response(JSON.stringify({ error: "Invalid owner" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    );

    const { data: row, error: rowErr } = await supabase
      .from("shopify_sme_merchants")
      .select("id, gmail_message_id, brand_name")
      .eq("id", id)
      .single();

    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Merchant not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gHeaders = gmailHeaders();

    // Fetch original message to get thread + headers
    const msgRes = await fetch(
      `${GATEWAY_URL}/users/me/messages/${row.gmail_message_id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-Id&metadataHeaders=References`,
      { headers: gHeaders },
    );
    if (!msgRes.ok) {
      const t = await msgRes.text();
      return new Response(JSON.stringify({ error: "Failed to fetch email", details: t }), {
        status: msgRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = await msgRes.json();
    const headers = msg.payload?.headers || [];
    const from = getHeader(headers, "From");
    const to = getHeader(headers, "To");
    const cc = getHeader(headers, "Cc");
    let subject = getHeader(headers, "Subject") || "";
    if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
    const msgId = getHeader(headers, "Message-Id") || getHeader(headers, "Message-ID");
    const references = getHeader(headers, "References");
    const threadId = msg.threadId;

    // Put the assigned owner on To; move original From + To + Cc to Cc (dedup, skip owner)
    const replyTo = owner_email;
    const ccSet = new Set<string>();
    const addAddresses = (raw: string) => {
      if (!raw) return;
      raw.split(",").forEach((part) => {
        const trimmed = part.trim();
        if (!trimmed) return;
        const emailMatch = trimmed.match(/<([^>]+)>/);
        const email = (emailMatch ? emailMatch[1] : trimmed).toLowerCase();
        if (email && email !== owner_email.toLowerCase()) ccSet.add(trimmed);
      });
    };
    addAddresses(from);
    addAddresses(to);
    addAddresses(cc);
    const replyCcParts = Array.from(ccSet).join(", ");


    // Gmail renders "+email@domain" as an @mention chip for Workspace users
    const ownerName = owner_email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const mentionHtml = `<a href="mailto:${owner_email}">+${ownerName}</a>`;
    const bodyHtml = `<div dir="ltr">Hi Team,<br><br>${mentionHtml} (${owner_email}) will lead the integration.<br><br>Thanks.</div>`;
    const bodyText = `Hi Team,\r\n\r\n+${ownerName} (${owner_email}) will lead the integration.\r\n\r\nThanks.`;

    const boundary = `bnd_${crypto.randomUUID().replace(/-/g, "")}`;
    const headerLines: string[] = [
      `To: ${replyTo}`,
    ];
    if (replyCcParts) headerLines.push(`Cc: ${replyCcParts}`);
    headerLines.push(`Subject: ${subject}`);
    if (msgId) {
      headerLines.push(`In-Reply-To: ${msgId}`);
      headerLines.push(`References: ${references ? references + " " : ""}${msgId}`);
    }
    headerLines.push(`MIME-Version: 1.0`);
    headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const rfc2822Lines =
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
      body: JSON.stringify({ raw: b64url(rfc2822Lines), threadId }),
    });
    if (!sendRes.ok) {
      const t = await sendRes.text();
      return new Response(JSON.stringify({ error: "Failed to send reply", details: t }), {
        status: sendRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("shopify_sme_merchants")
      .update({ assigned_owner_email: owner_email, status: "reviewed" })
      .eq("id", id);

    return new Response(JSON.stringify({ success: true, message: `Assigned to ${owner_email} and replied on thread.` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/assign-shopify-sme-owner")({
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
