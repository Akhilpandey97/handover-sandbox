import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred } from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gmailHeaders(googleKey?: string | null) {
  const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
  const GOOGLE_MAIL_API_KEY = googleKey || process.env['GOOGLE_MAIL_API_KEY'];
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GOOGLE_MAIL_API_KEY) throw new Error("Gmail connector is not linked");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };
}

const hdr = (headers: any[], name: string) =>
  headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

const INTERNAL_DOMAIN = "@gokwik.co";

function b64url(data: string) {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

// Recursively collect text/plain (fallback text/html) body of a message payload.
// Bodies are capped so huge HTML emails don't burn the function's CPU budget.
const MAX_BODY_CHARS = 8000;
function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data)
    return b64url(payload.body.data).slice(0, MAX_BODY_CHARS);
  if (payload.parts?.length) {
    for (const p of payload.parts) {
      const t = extractBody(p);
      if (t) return t;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return b64url(payload.body.data)
      .slice(0, MAX_BODY_CHARS * 3)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, MAX_BODY_CHARS);
  }
  return "";
}

// Parse "Onboarding Manager" row from the welcome email body
function parseOnboardingManager(text: string): { name: string; email: string } {
  if (!text) return { name: "", email: "" };
  const flat = text.replace(/\*/g, "").replace(/\s+/g, " ");
  const idx = flat.toLowerCase().indexOf("onboarding manager");
  if (idx === -1) return { name: "", email: "" };
  // window after the label up to the next role row
  const after = flat.slice(idx + "onboarding manager".length, idx + 400);
  const cut = after.search(/Operations Manager|Account Executive|Merchant.s Details/i);
  const win = cut > -1 ? after.slice(0, cut) : after;

  const emailMatch = win.match(/[A-Za-z0-9._%+-]+@gokwik\.co/i);
  const email = emailMatch ? emailMatch[0].toLowerCase() : "";

  let name = "";
  // Canonicalise on the email so the same person groups under one filter value
  if (email) {
    name = email
      .split("@")[0]
      .replace(/\d+$/, "")
      .split(/[._]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(" ");
  } else {
    const nameMatch = win.match(/Merchant Onboarding\s+(.+?)\s+(?:Main point of contact|$)/i);
    if (nameMatch) {
      name = nameMatch[1]
        .trim()
        .split(/\s+/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return { name: name.replace(/\s{2,}/g, " ").trim(), email };
}

// A thread is "already live" if any message carries the account-activation copy
const LIVE_MARKERS = [
  "delighted to welcome you to gokwik",
  "your account has been successfully activated",
];
function isLiveThread(texts: string[]): boolean {
  const flat = texts
    .join(" ")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return LIVE_MARKERS.every((m) => flat.includes(m));
}

const emailOf = (from: string) =>
  (from?.match(/<([^>]+)>/)?.[1] || from || "").trim().toLowerCase();

// Merchant names appear in several generations of onboarding subject templates.
// Examples: "Welcome to GoKwik (Freshlynn)", "Freshlynn | Welcome to GoKwik",
// and "Freshlynn <> GoKwik – Let's Begin Your Onboarding Journey".
function parseMerchantName(subject: string): string {
  if (!subject) return "";
  const s = subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const clean = (value: string) => value
    .replace(/^[\s|<>:\-–—]+|[\s|<>:\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Parenthesised templates place the merchant either immediately after
  // "GoKwik" or at the end of "Let's Begin Your Onboarding Journey".
  const inParens = s.match(/welcome\s+to\s+gokwik\s*\(([^)]+)\)/i);
  if (inParens?.[1]) return clean(inParens[1]);
  const journeyParens = s.match(/let(?:'|’)?s\s+begin\s+your\s+onboarding\s+journey\s*\(([^)]+)\)/i);
  if (journeyParens?.[1]) return clean(journeyParens[1]);

  // Merchant-led templates: Merchant | Welcome to GoKwik / Merchant <> GoKwik.
  const beforeWelcome = s.match(/^(.+?)\s*(?:\||<>|<->)\s*welcome\s+to\s+gokwik\b/i);
  if (beforeWelcome?.[1]) return clean(beforeWelcome[1]);
  const beforeGokwik = s.match(/^(.+?)\s*(?:<>|<->)\s*gokwik\b/i);
  if (beforeGokwik?.[1]) return clean(beforeGokwik[1]);

  // Less common dash/colon variants in either direction.
  const welcomeThenMerchant = s.match(/welcome\s+to\s+gokwik\s*(?:\||:|\-|–|—)\s*(?!let(?:'|’)?s\s+begin)(.+?)(?=\s*(?:\||<>|\-|–|—)\s*let(?:'|’)?s\s+begin|$)/i);
  if (welcomeThenMerchant?.[1]) return clean(welcomeThenMerchant[1]);
  const merchantThenWelcome = s.match(/^(.+?)\s*(?:\||:|\-|–|—)\s*welcome\s+to\s+gokwik\b/i);
  if (merchantThenWelcome?.[1]) return clean(merchantThenWelcome[1]);

  // Reversed onboarding title: Let's Begin Your Onboarding Journey | Merchant.
  const afterJourney = s.match(/let(?:'|’)?s\s+begin\s+your\s+onboarding\s+journey\s*(?:\||:|\-|–|—)\s*(.+)$/i);
  if (afterJourney?.[1]) return clean(afterJourney[1]);
  return "";
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    // days === 0 means "entire inbox" (no date filter)
    const days = body.days === 0 || body.days === "0" ? 0 : Number(body.days) || 7;
    const startedAt = Date.now();
    // No hard thread cap — the time budget below is the only guard.
    const mailbox = (body.mailbox || "integration@gokwik.co").trim();
    // includeLive: keep already-live threads in the result (flagged isLive) instead of excluding them
    const includeLive = body.includeLive === true || body.includeLive === "true";
    // light: metadata-only thread fetches (no body parsing). Far cheaper on CPU,
    // so entire-inbox scans stay within the worker resource budget. Used by the
    // sheet-match pool. OM parsing and body-based live detection are skipped.
    const light = body.light === true || body.light === "true";
    // All-time scans get a longer budget since they walk the full mailbox history
    const TIME_BUDGET_MS = days === 0 ? (light ? 125000 : 100000) : 45000;

    let headers: Record<string, string>;
    try {
      const creds = await getTenantIntegrations(await tenantIdFromRequest(req, body.tenant_id));
      headers = gmailHeaders(creds.google_mail_api_key);
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- AI account matching: map uploaded sheet account names to known merchant names ----
    if (body.action === "match") {
      const accountNames: string[] = Array.isArray(body.accountNames)
        ? body.accountNames.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 300)
        : [];
      const merchantNames: string[] = Array.isArray(body.merchantNames)
        ? body.merchantNames.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 1500)
        : [];
      if (!accountNames.length || !merchantNames.length) {
        return new Response(JSON.stringify({ error: "accountNames and merchantNames required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
      const prompt =
        `You are matching account names from a user's spreadsheet to merchant brand names extracted from email subjects.\n` +
        `For EACH account name, return the single best matching merchant name from the candidate list, or null if there is no reasonable match.\n` +
        `Be smart about variations: abbreviations, punctuation and symbols between words (e.g. "ADORE-A-BOO" = "Adoreaboo" = "Adore A Boo"), suffixes like "Pvt Ltd"/"LLP", domain names, spacing, casing.\n` +
        `Always return the merchant name EXACTLY as it appears in the candidate list.\n` +
        `Only match when you are reasonably confident they refer to the same brand. When in doubt, return null.\n\n` +
        `Account names:\n${accountNames.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\n` +
        `Candidate merchant names:\n${merchantNames.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\n` +
        `Return ONLY valid JSON: {"matches":{"<account name>":"<merchant name>"|null, ...}} — include EVERY account name as a key, exactly as given.`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0,
          messages: [
            { role: "system", content: "You are a precise entity-matching assistant. Return only valid JSON." },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again in a moment" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!aiRes.ok) {
        return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiRes.json();
      const content: string = aiData.choices?.[0]?.message?.content || "";
      let matches: Record<string, string | null> = {};
      try {
        const jsonText = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(jsonText.slice(jsonText.indexOf("{"), jsonText.lastIndexOf("}") + 1));
        if (parsed?.matches && typeof parsed.matches === "object") {
          // Symbol-insensitive canonicalisation: map both lowercase and fully
          // normalised (symbols/spaces stripped) forms back to the exact candidate
          const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const byLower = new Map(merchantNames.map((m) => [m.toLowerCase(), m]));
          const byNorm = new Map(merchantNames.map((m) => [normKey(m), m]));
          for (const [k, v] of Object.entries(parsed.matches)) {
            if (typeof v === "string") {
              const hit = byLower.get(v.toLowerCase()) || byNorm.get(normKey(v));
              matches[k] = hit || null;
            } else {
              matches[k] = null;
            }
          }
        }
      } catch {
        matches = {};
      }

      return new Response(JSON.stringify({ matches }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- AI summary mode: summarize the VERY LATEST message of each given thread ----
    if (body.action === "summarize") {
      const threadIds: string[] = Array.isArray(body.threadIds)
        ? body.threadIds.filter((x: any) => typeof x === "string").slice(0, 10)
        : [];
      if (!threadIds.length) {
        return new Response(JSON.stringify({ error: "threadIds required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const items = await Promise.all(
        threadIds.map(async (id) => {
          try {
            const tRes = await fetch(`${GATEWAY_URL}/users/me/threads/${id}?format=full`, { headers });
            const tData = await tRes.json();
            if (!tRes.ok || tData.error) return null;
            const msgs = tData.messages || [];
            if (!msgs.length) return null;
            const last = msgs[msgs.length - 1];
            const subject = hdr(msgs[0].payload?.headers, "Subject");
            const from = hdr(last.payload?.headers, "From");
            const text = `${last.snippet || ""} ${extractBody(last.payload)}`
              .replace(/\s+/g, " ").trim().slice(0, 1500);
            if (!text) return null;
            return { threadId: id, subject, from, text };
          } catch {
            return null;
          }
        }),
      );
      const valid = items.filter(Boolean) as any[];
      if (!valid.length) {
        return new Response(JSON.stringify({ summaries: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
      const STATUSES = [
        "CE - Merchant Live",
        "CE - Button Implementation",
        "CE - Preview link to be shared",
        "CE - Awaiting feedback from merchant",
        "CE - Merchant Dependency",
        "CE - QC in Progress",
        "CE - No Shopify Access",
        "CE - Dashboard Setup in progress",
        "CE - Awaiting Merchant Go ahead",
        "CE - Working on the Feedback",
        "TECH - Break-Fix Support",
        "OPS - Payment Gateway Pending",
        "Sales - Pre Kickoff",
        "Sales - Merchant Unresponsive",
        "Onhold",
        "Needs Review",
      ];

      const prompt =
        `You are an analyst for an internal merchant-onboarding dashboard. Accuracy matters more than ` +
        `completeness: a wrong status is worse than "Needs Review".\n\n` +
        `For EACH thread below, read ONLY that thread's latest message and return:\n` +
        `1. "summary": 1-2 crisp lines on the current state — what the latest message says, any blocker, and who ` +
        `must act next. Only describe facts present in THAT thread. Never mention a merchant/brand name that does ` +
        `not appear in that thread's subject or message.\n` +
        `2. "merchantName": the merchant/brand this thread is about, taken from the subject line. "" if unclear.\n` +
        `3. "status": EXACTLY one value from this list: ${STATUSES.map((s) => `"${s}"`).join(", ")}.\n` +
        `4. "evidence": a short verbatim quote (max 20 words) from the latest message that justifies the status. ` +
        `If you cannot quote supporting text, the status MUST be "Needs Review".\n` +
        `5. "confidence": "high" | "medium" | "low".\n\n` +
        `HARD RULES:\n` +
        `- "CE - Merchant Live" ONLY when the message explicitly confirms the account is activated/live in ` +
        `production (e.g. "successfully activated", "you are live", "go-live done"). Preparatory steps — test theme ` +
        `built, BRD sent, testing pending, app install pending — are NOT live.\n` +
        `- Decide who owes the next move from the message content, NOT from who sent it last. If GoKwik/a GoKwik ` +
        `person must act (share next steps, fix, configure, respond), use "CE - Working on the Feedback". If the ` +
        `merchant must act (test, install, approve, share creds/go-ahead), use "CE - Awaiting Merchant Go ahead".\n` +
        `- "Sales - Merchant Unresponsive" needs explicit evidence of no response / unreachable / follow-ups ignored. ` +
        `A normal first outreach is NOT unresponsive.\n` +
        `- "CE - No Shopify Access" needs an explicit access/collaborator-request blocker.\n` +
        `- "OPS - Payment Gateway Pending" needs an explicit payment-gateway blocker.\n` +
        `- If the message is ambiguous, off-topic, or evidence is thin: status "Needs Review", confidence "low".\n\n` +
        `Return ONLY valid JSON: {"summaries":[{"threadId":"...","summary":"...","merchantName":"...","status":"...",` +
        `"evidence":"...","confidence":"..."}]}\n\n` +
        valid
          .map(
            (v) =>
              `### Thread ${v.threadId}\nSubject: ${v.subject}\nLatest message from: ${v.from}\nLatest message:\n${v.text}`,
          )
          .join("\n\n");

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, summaries will retry later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!aiRes.ok) {
        return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiRes.json();
      const content: string = aiData.choices?.[0]?.message?.content || "";
      let summaries: any[] = [];
      try {
        const jsonText = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(jsonText.slice(jsonText.indexOf("{"), jsonText.lastIndexOf("}") + 1));
        summaries = Array.isArray(parsed?.summaries) ? parsed.summaries : [];
      } catch {
        summaries = [];
      }

      const subjectById = new Map(valid.map((v) => [v.threadId, String(v.subject || "")]));
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      summaries = summaries
        .filter((s) => s && typeof s.threadId === "string" && typeof s.summary === "string" && s.summary.trim())
        .map((s) => {
          let status = STATUSES.includes(s.status) ? s.status : "Needs Review";
          const evidence = typeof s.evidence === "string" ? s.evidence.trim() : "";
          let confidence = ["high", "medium", "low"].includes(s.confidence) ? s.confidence : "low";

          // No quotable evidence => never assert a status.
          if (!evidence) {
            status = "Needs Review";
            confidence = "low";
          }
          // "Live" requires explicit activation wording in the evidence itself.
          if (
            status === "CE - Merchant Live" &&
            !/successfully activated|is now live|you are live|went live|go.?live (is )?(done|complete)|account (has been )?activated/i.test(
              evidence,
            )
          ) {
            status = "Needs Review";
            confidence = "low";
          }
          // Guard against summaries attributed to the wrong merchant.
          const subj = norm(subjectById.get(s.threadId) || "");
          const mName = typeof s.merchantName === "string" ? s.merchantName.trim() : "";
          if (mName && subj && !subj.includes(norm(mName))) {
            status = "Needs Review";
            confidence = "low";
          }

          return {
            threadId: s.threadId,
            summary: s.summary.trim(),
            merchantName: mName,
            status,
            evidence,
            confidence,
          };
        });

      return new Response(JSON.stringify({ summaries }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const afterEpoch = Math.floor((Date.now() - days * 86400000) / 1000);
    // Base query WITHOUT any date filter — used for the all-time "already live" lookup
    const baseQ = `(subject:"Welcome to GoKwik" OR subject:"Let's Begin Your Onboarding Journey" OR subject:"Let’s Begin Your Onboarding Journey") (to:${mailbox} OR from:${mailbox} OR cc:${mailbox})`;
    // days === 0 → entire inbox, no after: filter
    const q = days > 0 ? `${baseQ} after:${afterEpoch}` : baseQ;

    // Paginate through ALL matching threads (Gmail caps each page at 500)
    const allThreads: any[] = [];
    let pageToken: string | undefined = undefined;
    for (let page = 0; page < 20; page++) {
      const url = `${GATEWAY_URL}/users/me/threads?q=${encodeURIComponent(q)}&maxResults=500${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`;
      const listRes = await fetch(url, { headers });
      const listData = await listRes.json();
      if (!listRes.ok || listData.error) {
        const details = listData?.error?.message || JSON.stringify(listData);
        console.error(`Gmail list failed [${listRes.status}]: ${details}`);
        if (allThreads.length === 0) {
          return new Response(JSON.stringify({ error: "Gmail request failed", details }), {
            status: listRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;
      }
      allThreads.push(...(listData.threads || []));
      pageToken = listData.nextPageToken;
      if (!pageToken) break;
      
    }

    // Gmail-side lookup of threads that already got the activation ("live") email.
    // Searched across ALL TIME (no date filter) so a thread that went live before the
    // selected window is still excluded, and shorter windows stay subsets of longer ones.
    const liveThreadIds = new Set<string>();
    try {
      const liveQ = `${baseQ} "successfully activated"`;
      let livePageToken: string | undefined = undefined;
      for (let page = 0; page < 20; page++) {
        const liveRes = await fetch(
          `${GATEWAY_URL}/users/me/threads?q=${encodeURIComponent(liveQ)}&maxResults=500${
            livePageToken ? `&pageToken=${encodeURIComponent(livePageToken)}` : ""
          }`,
          { headers },
        );
        const liveData = await liveRes.json();
        if (!liveRes.ok || liveData.error) break;
        for (const t of liveData.threads || []) liveThreadIds.add(t.id);
        livePageToken = liveData.nextPageToken;
        if (!livePageToken) break;
      }
    } catch (_) { /* non-fatal */ }

    const threadsToLoad = includeLive
      ? allThreads
      : allThreads.filter((t: any) => !liveThreadIds.has(t.id));
    const now = Date.now();

    // Fetch thread details in batches to avoid overwhelming the gateway
    const rows: any[] = [];
    let truncated = allThreads.length > threadsToLoad.length;
    const CHUNK = light ? 20 : 5;
    for (let i = 0; i < threadsToLoad.length; i += CHUNK) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { truncated = true; break; }
      const chunk = threadsToLoad.slice(i, i + CHUNK);
      const res = await Promise.all(
        chunk.map(async (t: any) => {
        try {
          const tRes = await fetch(
            `${GATEWAY_URL}/users/me/threads/${t.id}?${light ? "format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date" : "format=full"}`,
            { headers },
          );
          const tData = await tRes.json();
          if (!tRes.ok || tData.error) return null;
          const msgs = tData.messages || [];
          if (!msgs.length) return null;

          const first = msgs[0];
          const last = msgs[msgs.length - 1];
          const subject = hdr(first.payload?.headers, "Subject");
          const lastFrom = hdr(last.payload?.headers, "From");
          const lastTs = Number(last.internalDate) || Date.parse(hdr(last.payload?.headers, "Date"));
          const firstTs = Number(first.internalDate) || Date.parse(hdr(first.payload?.headers, "Date"));

          // Safety net: check only the first/last message bodies for the activation copy
          // (skipped in light mode — liveThreadIds from the Gmail-side lookup is authoritative)
          const firstText = light ? (first.snippet || "") : `${first.snippet || ""} ${extractBody(first.payload)}`;
          const lastText = !light && msgs.length > 1 ? `${last.snippet || ""} ${extractBody(last.payload)}` : "";
          const liveDetected =
            liveThreadIds.has(t.id) ||
            (!light && (isLiveThread([firstText]) ||
            (lastText ? isLiveThread([lastText]) : false)));
          if (liveDetected && !includeLive) return null;

          // Onboarding Manager comes from the welcome email body (not available in light mode)
          let om = light ? { name: "", email: "" } : parseOnboardingManager(firstText);
          if (!light && !om.email && lastText) om = parseOnboardingManager(lastText);



          const lastEmail = emailOf(lastFrom);
          const isInternal = lastEmail.includes(INTERNAL_DOMAIN);
          const lastReplyRole = om.email && lastEmail === om.email
            ? "Onboarding Manager"
            : isInternal
              ? "GoKwik (Other)"
              : "Merchant";

          return {
            threadId: t.id,
            isLive: liveDetected,
            subject,
            merchantName: parseMerchantName(subject),
            firstSentAt: firstTs ? new Date(firstTs).toISOString() : null,
            messageCount: msgs.length,
            lastReplyFrom: lastFrom,
            lastReplyEmail: lastEmail,
            lastReplyAt: lastTs ? new Date(lastTs).toISOString() : null,
            ageingDays: lastTs ? Math.floor((now - lastTs) / 86400000) : null,
            lastReplyIsInternal: isInternal,
            lastReplyRole,
            onboardingManager: om.name || "",
            onboardingManagerEmail: om.email || "",
            awaitingMerchant: isInternal,
            snippet: last.snippet || t.snippet || "",
            url: `https://mail.google.com/mail/u/0/#all/${t.id}`,
          };
        } catch {
          return null;
        }
      }),
      );
      rows.push(...res);
    }

    const data = rows.filter(Boolean).sort((a: any, b: any) =>
      (b.lastReplyAt || "").localeCompare(a.lastReplyAt || ""));

    return new Response(JSON.stringify({ query: q, count: data.length, truncated, threads: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("shopify-lt-email-comms error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/shopify-lt-email-comms")({
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
