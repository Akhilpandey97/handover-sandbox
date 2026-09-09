import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred } from "@/lib/tenant-integrations.server";

import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const PLATFORMS = ["Aasaan", "Zoho", "Shoppachino", "Shoopy", "Zen Zen", "Tradexa"] as const;
type Platform = typeof PLATFORMS[number];

const PLATFORM_MATCHERS: { key: string; value: Platform }[] = [
  { key: "aasaan", value: "Aasaan" },
  { key: "asaan", value: "Aasaan" },
  { key: "zoho", value: "Zoho" },
  { key: "shoppachino", value: "Shoppachino" },
  { key: "shopachino", value: "Shoppachino" },
  { key: "shoopy", value: "Shoopy" },
  { key: "zen zen", value: "Zen Zen" },
  { key: "zenzen", value: "Zen Zen" },
  { key: "tradexa", value: "Tradexa" },
];

const PLATFORM_DEFAULT_CC: Partial<Record<Platform, string[]>> = {
  Aasaan: [
    "pramod@aasaan.app",
    "murali@aasaan.app",
    "akhil.pandey@gokwik.co",
    "rishabh.jain1@gokwik.co",
    "nishant@gokwik.co",
    "lavpratap.singh@gokwik.co",
    "ritik.arora@gokwik.co",
  ],
  Shoopy: [
    "indar@shoopy.in",
    "akhil.pandey@gokwik.co",
    "nishant@gokwik.co",
    "ritik.arora@gokwik.co",
    "rahul.kumar1@gokwik.co",
    "animisha.parmar@gokwik.co",
  ],
};

// Platform -> { owner, csm } email mapping used for auto-assignment
const PLATFORM_TEAM: Partial<Record<Platform, { owner?: string; csm?: string }>> = {
  Aasaan: { owner: "rishabh.jain1@gokwik.co", csm: "lavpratap.singh@gokwik.co" },
  Zoho: { owner: "abhishek.yadav@gokwik.co", csm: "ritik.arora@gokwik.co" },
  Shoppachino: { owner: "piyush.shastri@gokwik.co", csm: "animisha.parmar@gokwik.co" },
  Shoopy: { owner: "rahul.kumar1@gokwik.co", csm: "animisha.parmar@gokwik.co" },
  "Zen Zen": { owner: "abhishek.yadav@gokwik.co", csm: "lavpratap.singh@gokwik.co" },
  Tradexa: { owner: "animisha.parmar@gokwik.co", csm: "animisha.parmar@gokwik.co" },
};

const DEFAULT_TEMP_PASSWORD =
  "Please reset your password using : https://dashboard.gokwik.co/forgot-password";

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

function collectBodies(payload: any): { html: string; text: string } {
  let html = "";
  let text = "";
  const walk = (part: any) => {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) html += decodeBase64Url(part.body.data);
    if (part.mimeType === "text/plain" && part.body?.data) text += decodeBase64Url(part.body.data);
    if (part.parts) part.parts.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

// Pull "Label: value" from the handover email body (bullet list format)
function pickLabel(text: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}\\s*:\\s*([^\\n]*)`, "i");
  const m = text.match(re);
  if (!m) return "";
  return m[1].replace(/\*/g, "").trim();
}

// Section-scoped label lookup (e.g. "Name" under "Merchant Contacts")
function pickInSection(text: string, section: string, label: string): string {
  const idx = text.toLowerCase().indexOf(section.toLowerCase());
  if (idx === -1) return "";
  const slice = text.slice(idx, idx + 600);
  return pickLabel(slice, label);
}

function firstEmail(str: string): string {
  const m = String(str || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].replace(/\.$/, "") : "";
}

function toPlatform(raw: string): Platform | null {
  const l = (raw || "").toLowerCase();
  for (const p of PLATFORM_MATCHERS) if (l.includes(p.key)) return p.value;
  return null;
}

function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  let m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // DD/MM/YYYY
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
}

function cleanBrand(raw: string): string {
  return (raw || "")
    .replace(/\s*[-–—]\s*store\s*front\s*$/i, "")
    .replace(/\s*[-–—]\s*storefront\s*$/i, "")
    .replace(/[\[\]]/g, "")
    .trim();
}

function parseNum(str: string): number {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^0-9.\-]/g, "");
  return parseFloat(cleaned) || 0;
}

function parseEmailTable(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gis;
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const key = m[1].replace(/<[^>]*>/g, "").replace(/\s*:\s*$/, "").trim();
    const value = m[2].replace(/<[^>]*>/g, "").trim();
    if (key) fields[key] = value;
  }
  return fields;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id;
    const lookbackDays = Number(body.lookback_days ?? 2);
    const sendEmail = body.send_email !== false;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenant_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let headers: Record<string, string>;
    try {
      const creds = await getTenantIntegrations(tenantId);
      headers = gmailHeaders(creds.google_mail_api_key);
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const afterEpoch = Math.floor((Date.now() - lookbackDays * 86400000) / 1000);
    const query = `subject:("Brand Live" "Handover to CSM") after:${afterEpoch}`;
    const searchUrl = `${GATEWAY_URL}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;
    console.log("[poll-platform-golive] query:", query);

    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();
    if (!searchRes.ok || searchData.error) {
      return new Response(
        JSON.stringify({ error: `Gmail API error: ${searchData?.error?.message || JSON.stringify(searchData)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messages = searchData.messages || [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ message: "No handover emails found", query }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await supabase
      .from("platform_merchants")
      .select("id, merchant_name, platform, gmail_message_id, gmail_thread_id")
      .eq("tenant_id", tenantId);

    const existingMsg = new Set((existing || []).map((e: any) => e.gmail_message_id).filter(Boolean));
    const existingThread = new Set((existing || []).map((e: any) => e.gmail_thread_id).filter(Boolean));
    const existingName = new Set(
      (existing || []).map((e: any) => `${(e.merchant_name || "").toLowerCase().trim()}|${(e.platform || "").toLowerCase()}`)
    );
    const seenThisRun = new Set<string>();

    // Profile lookup for auto owner/CSM assignment
    const teamEmails = Array.from(
      new Set(
        Object.values(PLATFORM_TEAM)
          .flatMap((t) => [t.owner, t.csm])
          .filter((e): e is string => !!e)
      )
    );
    const { data: teamProfiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("email", teamEmails);
    const profileByEmail = new Map<string, string>(
      (teamProfiles || []).map((p: any) => [String(p.email).toLowerCase(), p.id])
    );
    const assignmentFor = (p: Platform) => {
      const t = PLATFORM_TEAM[p];
      if (!t) return { owner_id: null, csm_id: null };
      return {
        owner_id: (t.owner && profileByEmail.get(t.owner)) || null,
        csm_id: (t.csm && profileByEmail.get(t.csm)) || null,
      };
    };

    const created: any[] = [];
    const skipped: any[] = [];

    for (const msg of messages) {
      try {
        if (existingMsg.has(msg.id) || existingThread.has(msg.threadId)) continue;

        const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${msg.id}?format=full`, { headers });
        const msgData = await msgRes.json();
        if (!msgRes.ok || msgData.error) continue;

        const hdrs = msgData.payload?.headers || [];
        const subject = hdrs.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
        if (!/handover to csm/i.test(subject)) continue;

        const { html, text } = collectBodies(msgData.payload);
        const bodyText = (text && text.trim().length > 40 ? text : htmlToText(html)) || htmlToText(html);

        // Brand + platform: prefer body, fall back to subject "… | [Platform] | [Brand]"
        let brand = cleanBrand(pickLabel(bodyText, "Brand Name"));
        let platformRaw = pickLabel(bodyText, "Platform");
        const subjParts = subject.split("|").map((s) => s.trim());
        if (!brand && subjParts.length >= 3) brand = cleanBrand(subjParts[2]);
        if (!platformRaw && subjParts.length >= 2) platformRaw = subjParts[1].replace(/[\[\]]/g, "");

        const platform = toPlatform(platformRaw) || toPlatform(subjParts[1] || "");
        if (!brand || !platform) {
          skipped.push({ subject, reason: `Unrecognised brand/platform (${brand} / ${platformRaw})` });
          continue;
        }

        const nameKey = `${brand.toLowerCase()}|${platform.toLowerCase()}`;
        if (existingName.has(nameKey) || seenThisRun.has(nameKey)) {
          skipped.push({ subject, reason: "Duplicate merchant" });
          continue;
        }
        seenThisRun.add(nameKey);

        const website = pickLabel(bodyText, "Website");
        const goLiveDate = parseDate(pickLabel(bodyText, "Go-Live Date")) || new Date().toISOString().split("T")[0];
        const mid = pickLabel(bodyText, "MID");
        const paymentGateway = pickLabel(bodyText, "Payment Gateway");
        const features = pickLabel(bodyText, "Other Features Enabled");
        const pending = pickLabel(bodyText, "Pending Items");

        const merchantName = pickInSection(bodyText, "Merchant Contacts", "Name");
        const merchantEmail = firstEmail(pickInSection(bodyText, "Merchant Contacts", "Email"));
        const merchantPhone = pickInSection(bodyText, "Merchant Contacts", "Phone");
        const platformPocName = pickInSection(bodyText, "Platform POC", "Name");
        const platformPocEmail = firstEmail(pickInSection(bodyText, "Platform POC", "Email"));

        // ==== Enrich from the matching "New Brand On Board" email ====
        let arr: number | null = null;
        let nboBrandPoc = "";
        let nboEmail = "";
        let nboPhone = "";
        try {
          const nboQuery = `subject:("New Brand On Board") "${brand}"`;
          const nboRes = await fetch(
            `${GATEWAY_URL}/users/me/messages?q=${encodeURIComponent(nboQuery)}&maxResults=5`,
            { headers }
          );
          const nboData = await nboRes.json();
          const nboMsg = (nboData.messages || [])[0];
          if (nboMsg) {
            const nboFullRes = await fetch(`${GATEWAY_URL}/users/me/messages/${nboMsg.id}?format=full`, { headers });
            const nboFull = await nboFullRes.json();
            const nboBodies = collectBodies(nboFull.payload);
            const fields = parseEmailTable(nboBodies.html);
            const pick = (...keys: string[]) => {
              for (const k of keys) if (fields[k] && String(fields[k]).trim()) return String(fields[k]).trim();
              return "";
            };
            const arrRaw = parseNum(pick("Expected ARR"));
            if (arrRaw > 0) arr = arrRaw;
            nboBrandPoc = pick("Merchant POC Name");
            nboEmail = firstEmail(pick("Merchant Email"));
            nboPhone = pick("Merchant Contact Number");
          }
        } catch (err) {
          console.error("NBO enrichment failed for", brand, err);
        }

        let brandPocName = merchantName || nboBrandPoc || brand;
        // Guard: never use the platform POC as the brand contact name
        if (platformPocName && brandPocName.toLowerCase() === platformPocName.toLowerCase()) {
          brandPocName = nboBrandPoc || brand;
        }

        const brandEmail = merchantEmail || nboEmail;
        const brandPocEmails = brandEmail ? [brandEmail] : [];
        const platformPocEmails = Array.from(
          new Set([...(PLATFORM_DEFAULT_CC[platform] || []), ...(platformPocEmail ? [platformPocEmail] : [])])
        );

        const notesLines = [
          mid ? `MID: ${mid}` : "",
          paymentGateway ? `Payment Gateway: ${paymentGateway}` : "",
          features ? `Features: ${features}` : "",
          platformPocName ? `Platform POC: ${platformPocName}${platformPocEmail ? ` (${platformPocEmail})` : ""}` : "",
          pending ? `Pending: ${pending}` : "",
          "Auto-created from Handover to CSM email",
        ].filter(Boolean);

        const { data: inserted, error: insertErr } = await supabase
          .from("platform_merchants")
          .insert({
            tenant_id: tenantId,
            platform,
            merchant_name: brand,
            status: "live",
            ...assignmentFor(platform),
            arr,
            go_live_date: goLiveDate,
            notes: notesLines.join("\n"),
            brand_poc_name: brandPocName,
            brand_poc_emails: brandPocEmails,
            platform_poc_emails: platformPocEmails,
            login_email: brandEmail || null,
            temp_password: DEFAULT_TEMP_PASSWORD,
            mid: mid || null,
            website: website || null,
            merchant_phone: merchantPhone || nboPhone || null,
            platform_poc_name: platformPocName || null,
            gmail_message_id: msg.id,
            gmail_thread_id: msg.threadId || null,
            auto_created: true,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          console.error("Insert failed:", insertErr);
          skipped.push({ subject, reason: insertErr?.message || "Insert failed" });
          continue;
        }

        let emailSent = false;
        let emailError: string | null = null;
        if (sendEmail && brandPocEmails.length > 0) {
          try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/send-platform-welcome`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                brandName: brand,
                brandPocName,
                brandPocEmails,
                platformPocEmails,
                loginEmail: brandEmail,
                tempPassword: DEFAULT_TEMP_PASSWORD,
                senderName: "MINT Team",
                senderMobile: "",
              }),
            });
            const out = await res.json().catch(() => ({}));
            if (res.ok) {
              emailSent = true;
              await supabase
                .from("platform_merchants")
                .update({ welcome_email_sent_at: new Date().toISOString() })
                .eq("id", inserted.id);
            } else {
              emailError = out?.error || "Welcome email failed";
            }
          } catch (err) {
            emailError = (err as Error).message;
          }
        } else if (brandPocEmails.length === 0) {
          emailError = "No brand POC email found in emails";
        }

        created.push({ id: inserted.id, brand, platform, go_live_date: goLiveDate, emailSent, emailError });
      } catch (err) {
        console.error("Error processing handover message:", err);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Created ${created.length} platform merchant(s)`,
        total_found: messages.length,
        created,
        skipped,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("poll-platform-golive-emails error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/poll-platform-golive-emails")({
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
