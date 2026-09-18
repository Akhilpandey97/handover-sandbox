import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, tenantIdFromRequest, requireCred, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";
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
    const creds = await getTenantIntegrations(await tenantIdFromRequest(req));
    const RESEND_API_KEY = requireCred(creds, "resend_api_key", "Resend email");

    const {
      brandName,
      brandPocName,
      brandPocEmails = [],
      platformPocEmails = [],
      csmEmail,
      loginEmail,
      tempPassword,
      dashboardUrl = "https://dashboard.gokwik.co",
      helpLink = "https://help.gokwik.co",
      senderName,
      senderMobile,
    } = await req.json();

    // Was two personal addresses, hardcoded — so every tenant's welcome email
    // to its own merchants copied the same two people at another company. The
    // tenant's configured Reply-To stands in for "keep us in the loop".
    const GLOBAL_CC = creds.reply_to ? [creds.reply_to] : [];
    // Where merchants should reply: the tenant's configured Reply-To, then its
    // From Address, rather than a support inbox belonging to one company.
    const supportEmail = creds.reply_to || creds.from_email || "";
    const branding = await getTenantBranding(await tenantIdFromRequest(req));
    const { orgName } = branding;
    // The team that answers merchants is the third-stage team, named by the workspace.
    const teamName = branding.teamLabel("ms");
    const to = (brandPocEmails as string[]).filter(Boolean);
    const ccSet = new Set<string>((platformPocEmails as string[]).filter(Boolean));
    if (csmEmail && typeof csmEmail === "string" && csmEmail.trim()) ccSet.add(csmEmail.trim());
    GLOBAL_CC.forEach(e => ccSet.add(e));
    // Ensure no overlap between To and CC
    to.forEach(e => ccSet.delete(e));
    const cc = Array.from(ccSet);

    if (to.length === 0) {
      throw new Error("At least one Brand POC email is required");
    }

    const subject = `Welcome to ${orgName}, ${brandName}! | Dashboard Access & Next Steps`;

    const walkthroughVideos = [
      { title: "Executive Dashboard", url: "https://app.trupeer.ai/view/PAwyCbXEk/go-kwik-dashboard-overview-executive-summary" },
      { title: "Orders Page", url: "https://app.trupeer.ai/view/cFxn7rVKw/order-management-dashboard-guide" },
      { title: "Kwik Store Analytics (Checkout & Payments)", url: "https://app.trupeer.ai/view/wf5AhcccA/kwik-store-analytics-checkout-payments-guide" },
      { title: "Kwik Checkout - Abandoned Cart", url: "https://app.trupeer.ai/view/BXcrkFbAP/kwik-checkout-abandoned-cart-recovery-guide" },
      { title: "Kwik Checkout Settings", url: "https://app.trupeer.ai/view/b5NWMncU8/kwik-checkout-settings-user-guide" },
      { title: "Kwik Payments - Transactions", url: "https://app.trupeer.ai/view/98KnDu0v5/kwik-payments-transactions-guide" },
      { title: "Kwik Payments - Payment links", url: "https://app.trupeer.ai/view/BYGDiTZsO/kwik-payments-payment-links-user-guide" },
      { title: "Kwik Payments - Settlements", url: "https://app.trupeer.ai/view/JQjFSSEef/kwik-payments-settlement-tracking-guide" },
      { title: "Kwik Payments - Refunds", url: "https://app.trupeer.ai/embed/BYGDiTZsO" },
      { title: "Kwik Payments - Settings", url: "https://app.trupeer.ai/view/eKWhUWMIv/kwik-payment-settings-guide" },
      { title: "Kwik RTO - Summary & Deep Dive", url: "https://app.trupeer.ai/view/3HT0jULmA/go-kwik-rto-dashboard-summary-deep-dive-user-guide" },
      { title: "Kwik RTO - RCA", url: "https://app.trupeer.ai/view/FWW9PX09O/rto-rca-view-analysis-user-guide" },
      { title: "Kwik Flows", url: "https://app.trupeer.ai/view/ktEt8sq5K/kwik-flows-dashboard-user-guide" },
    ];

    const videosText = walkthroughVideos.map((v, i) => `${i + 1}. ${v.title}\n   ${v.url}`).join("\n");
    const videosHtml = walkthroughVideos
      .map((v) => `<li style="margin-bottom:6px;"><a href="${v.url}">${v.title}</a></li>`)
      .join("");

    const text = `Hi ${brandPocName || "there"},

Welcome aboard! We're thrilled to have ${brandName} live on ${orgName}.
Here's everything you need to get started.

YOUR DASHBOARD ACCESS
- Dashboard URL : ${dashboardUrl}
- Login Email   : ${loginEmail || "[Brand Email]"}
- Password      : ${tempPassword || "[Temporary password — please reset on first login]"}

GETTING STARTED — Walkthrough Videos
${videosText}

These videos will cover every section of the Dashboard and show you how to read your metrics.

SUPPORT
For any queries, write to ${supportEmail} and our Merchant Success team will connect with you directly.

We look forward to partnering with you.

Warm regards,
${senderName || "[POC Name]"} | ${orgName}
${senderMobile || ""}`;

    const html = `
      <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color:#11263b;">
        <p>Hi <strong>${brandPocName || "there"}</strong>,</p>
        <p>Welcome aboard! We're thrilled to have <strong>${brandName}</strong> live on ${orgName}.<br/>
        Here's everything you need to get started.</p>

        <h3 style="margin-top:24px;">YOUR DASHBOARD ACCESS</h3>
        <ul style="line-height:1.7;">
          <li><strong>Dashboard URL</strong>: <a href="${dashboardUrl}">${dashboardUrl}</a></li>
          <li><strong>Login Email</strong>: ${loginEmail || "[Brand Email]"}</li>
          <li><strong>Password</strong>: ${tempPassword || "[Temporary password — please reset on first login]"}</li>
        </ul>

        <h3 style="margin-top:24px;">GETTING STARTED — Walkthrough Videos</h3>
        <ol style="line-height:1.7; padding-left:20px;">${videosHtml}</ol>
        <p>These videos will cover every section of the Dashboard and show you how to read your metrics.</p>

        <h3 style="margin-top:24px;">SUPPORT</h3>
        <p>For any queries, write to <a href="mailto:${supportEmail}">${supportEmail}</a> and our ${teamName} team will connect with you directly.</p>

        <p>We look forward to partnering with you.</p>

        <p style="margin-top:24px;">Warm regards,<br/>
        <strong>${senderName || "[POC Name]"}</strong> | ${orgName}<br/>
        ${senderMobile || ""}</p>
      </div>
    `;


    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(creds, "MINT Updates"),
        ...resendReplyTo(creds),
        to,
        cc: cc.length ? cc : undefined,
        subject,
        html,
        text,
      }),
    });

    const result = await emailResponse.json();
    if (!emailResponse.ok) {
      console.error("Resend error:", result);
      throw new Error(result.message || "Failed to send welcome email");
    }

    return new Response(JSON.stringify({ success: true, id: result.id, to, cc }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-platform-welcome error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/send-platform-welcome")({
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
