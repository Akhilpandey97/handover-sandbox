import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gmailHeaders() {
  const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
  const GOOGLE_MAIL_API_KEY = process.env['GOOGLE_MAIL_API_KEY'];
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GOOGLE_MAIL_API_KEY) throw new Error("GOOGLE_MAIL_API_KEY is not configured (Gmail connector not linked)");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };
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

function extractBrandFromSubject(subject: string): string {
  const m = subject.match(/New Brand On Board\s*[-–—]\s*(.+?)\s*[-–—]\s*Store\s*Front/i);
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

const COMMERCIAL_KEYS = [
  "UPI %", "UPI on CC%", "COD %", "CC %", "BNPL %",
  "DC above 2k %", "DC below 2k %", "Net Banking %", "Amex %", "Diners %",
  "Corporate CC %", "Wallets %", "International Card %", "Cardless EMI %",
  "Card EMI %", "Snapmint %", "Twidpay %", "PPCOD %", "Minimum Guarantee",
  "Bharat X", "Platform Fee %", "COD Share %",
];

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenant_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let headers: Record<string, string>;
    try { headers = gmailHeaders(); }
    catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only ingest emails from yesterday onwards (ignore historical backlog)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const afterEpoch = Math.floor(since.getTime() / 1000);
    // Relaxed: enterprise emails don't include "Store Front" in subject. Filter by Merchant Size in body.
    const query = `subject:"New Brand On Board" after:${afterEpoch}`;
    const searchUrl = `${GATEWAY_URL}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`;

    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();
    if (!searchRes.ok || searchData.error) {
      return new Response(JSON.stringify({ error: `Gmail API error: ${searchData?.error?.message || JSON.stringify(searchData)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const messages = searchData.messages || [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ message: "No matching emails found", query }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const messageIds = messages.map((m: any) => m.id);
    const threadIds = Array.from(new Set(messages.map((m: any) => m.threadId).filter(Boolean)));
    const { data: existing } = await supabase
      .from("shopify_sme_merchants")
      .select("gmail_message_id, gmail_thread_id, shopify_url, brand_name, merchant_email")
      .eq("tenant_id", tenantId);
    const existingMsgIds = new Set((existing || []).map((e: any) => e.gmail_message_id));
    const existingThreadIds = new Set((existing || []).map((e: any) => e.gmail_thread_id).filter(Boolean));
    const existingShopUrls = new Set((existing || []).map((e: any) => (e.shopify_url || "").toLowerCase()).filter(Boolean));
    const existingBrandEmail = new Set((existing || []).map((e: any) => `${(e.brand_name || "").toLowerCase()}|${(e.merchant_email || "").toLowerCase()}`).filter((k: string) => k !== "|"));
    const newMessages = messages.filter((m: any) => !existingMsgIds.has(m.id) && !existingThreadIds.has(m.threadId));

    if (newMessages.length === 0) {
      return new Response(JSON.stringify({ message: "All matching emails already processed", total: messages.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: any[] = [];
    let skippedNonSme = 0;
    let skippedDuplicate = 0;
    // Track dedup keys within this run so multiple messages in the same batch don't insert twice.
    const seenThisRun = new Set<string>();

    for (const msg of newMessages) {
      try {
        const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${msg.id}?format=full`, { headers });
        const msgData = await msgRes.json();
        if (!msgRes.ok || msgData.error) continue;

        const hdrs = msgData.payload?.headers || [];
        const subject = hdrs.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
        const sender = hdrs.find((h: any) => h.name.toLowerCase() === "from")?.value || "";
        const dateHeader = hdrs.find((h: any) => h.name.toLowerCase() === "date")?.value || "";
        const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

        if (!/new brand on board/i.test(subject)) continue;


        let htmlBody = "";
        const extract = (part: any) => {
          if (part.mimeType === "text/html" && part.body?.data) htmlBody = decodeBase64Url(part.body.data);
          if (part.parts) for (const p of part.parts) extract(p);
        };
        extract(msgData.payload);

        const fields = parseEmailTable(htmlBody);
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const v = fields[k]; if (v && String(v).trim()) return String(v).trim();
          }
          return "";
        };

        const merchantSize = pick("Merchant Size");
        const sizeUpper = merchantSize.toUpperCase();
        if (sizeUpper !== "SME" && sizeUpper !== "ENTERPRISE" && sizeUpper !== "ENT") { skippedNonSme++; continue; }

        const commercials: Record<string, number | string> = {};
        for (const k of COMMERCIAL_KEYS) {
          const v = fields[k];
          if (v && String(v).trim()) commercials[k] = /^[0-9.\-]+$/.test(String(v).trim()) ? parseNum(v) : String(v).trim();
        }

        const brandName = pick("Brand Name") || extractBrandFromSubject(subject);
        const merchantEmail = pick("Merchant Email");
        const shopifyUrl = pick("Shopify URL");

        // Dedup: skip if we already have this shopify_url OR brand+email OR thread already processed in-run
        const shopKey = (shopifyUrl || "").toLowerCase();
        const beKey = `${brandName.toLowerCase()}|${merchantEmail.toLowerCase()}`;
        if (
          (shopKey && (existingShopUrls.has(shopKey) || seenThisRun.has(`s:${shopKey}`))) ||
          (beKey !== "|" && (existingBrandEmail.has(beKey) || seenThisRun.has(`b:${beKey}`))) ||
          (msg.threadId && seenThisRun.has(`t:${msg.threadId}`))
        ) {
          skippedDuplicate++;
          continue;
        }
        if (shopKey) seenThisRun.add(`s:${shopKey}`);
        if (beKey !== "|") seenThisRun.add(`b:${beKey}`);
        if (msg.threadId) seenThisRun.add(`t:${msg.threadId}`);

        const row = {
          tenant_id: tenantId,
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId || null,
          subject, sender, received_at: receivedAt,
          brand_name: brandName,
          merchant_poc_name: pick("Merchant POC Name"),
          merchant_email: merchantEmail,
          merchant_contact: pick("Merchant Contact Number"),
          shopify_url: shopifyUrl,
          website_url: pick("URL_1", "Website URL", "URL"),
          platform: pick("Platform") || "Shopify",
          sub_platform: pick("Sub Platform"),
          expected_arr: parseNum(pick("Expected ARR")),
          category: pick("Merchant Category"),
          txns_per_day: parseInt(pick("Expected Transactions/day", "Expected Transactions/Day") || "0") || 0,
          aov: parseNum(pick("AOV (Average Order Value)", "AOV")),
          merchant_size: merchantSize,
          city: pick("City"),
          rto_refund_amount: parseNum(pick("RTO Refund Amount")),
          rto_coverage_pct: parseNum(pick("RTO Coverage %")),
          mg_sheet_link: pick("MG Sheet link", "MG Sheet Link"),
          commercials,
          notes: pick("Notes"),
          merchant_id_ext: pick("Merchant ID"),
          merchant_id_text: pick("Merchant Id Text", "Merchant ID Text"),
          parsed_fields: fields,
          raw_html: htmlBody.substring(0, 50000),
          status: "new",
        };

        const { data: inserted, error: insertError } = await supabase
          .from("shopify_sme_merchants").insert(row).select().single();
        if (insertError) { console.error("Insert error:", insertError); continue; }
        results.push(inserted);

        // Auto-assign owner based on Merchant Size + Expected ARR bucket (in Lakhs)
        // ENT -> Ankit; SME < 15L -> Deepak; SME >= 15L -> Rohit
        // Skip entirely if no Shopify URL is present
        try {
          const arrRaw = Number(row.expected_arr) || 0;
          const arrL = arrRaw >= 1000 ? arrRaw / 100000 : arrRaw; // normalize to Lakhs
          let owner = "";
          if (!shopifyUrl || !String(shopifyUrl).trim()) {
            console.log("Skipping auto-assign: no Shopify URL for", row.brand_name);
          } else if (sizeUpper === "ENTERPRISE" || sizeUpper === "ENT") owner = "ankit@gokwik.co";
          else if (sizeUpper === "SME") owner = arrL < 15 ? "deepak.sharma@gokwik.co" : "rohit.singh@gokwik.co";


          if (owner) {
            const assignRes = await fetch(`${SUPABASE_URL}/functions/v1/assign-shopify-sme-owner`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({ id: inserted.id, owner_email: owner }),
            });
            if (!assignRes.ok) console.error("Auto-assign failed:", await assignRes.text());
          }
        } catch (assignErr) {
          console.error("Auto-assign error:", assignErr);
        }

      } catch (err) {
        console.error(`Error processing ${msg.id}:`, err);
      }
    }

    return new Response(JSON.stringify({
      message: `Processed ${results.length} new merchant(s); skipped ${skippedNonSme} non-SME/Ent, ${skippedDuplicate} duplicates`,
      total_found: messages.length,
      new_processed: results.length,
      skipped_non_sme: skippedNonSme,
      skipped_duplicate: skippedDuplicate,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error in poll-shopify-sme-emails:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

export const Route = createFileRoute("/api/public/poll-shopify-sme-emails")({
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
