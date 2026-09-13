import { createFileRoute } from "@tanstack/react-router";
import {
  adminClient,
  getTenantIntegrations,
  requireCred,
  resendFrom,
  resendReplyTo,
} from "@/lib/tenant-integrations.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Forgot-password mail sent through the tenant's own Resend account.
 *
 * Deliberately public and deliberately vague in its reply: it always answers
 * "ok" so the endpoint cannot be used to discover which addresses exist.
 */
async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      redirectTo?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return json({ error: "Email is required" }, 400);

    const origin = new URL(req.url).origin;
    const redirectTo = body.redirectTo || `${origin}/reset-password`;

    const admin = adminClient();

    const { data: profile } = await admin
      .from("profiles")
      .select("id, name, tenant_id")
      .ilike("email", email)
      .maybeSingle();
    const p = profile as { name?: string; tenant_id?: string | null } | null;
    if (!p) return json({ ok: true });

    const creds = await getTenantIntegrations(p.tenant_id ?? null);
    const apiKey = requireCred(creds, "resend_api_key", "Resend email");

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (linkError) throw linkError;
    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) return json({ ok: true });

    const name = p.name || "there";
    const html = `
      <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #0f172a; padding: 20px; border-radius: 12px 12px 0 0; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px;">Reset your password</h1>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 16px;">Hi <strong>${name}</strong>,</p>
          <p style="margin: 0 0 16px;">We received a request to reset your password. Click the button below to choose a new one. The link expires shortly and can be used once.</p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${actionLink}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">Reset password →</a>
          </div>
          <p style="margin: 0; color: #64748b; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(creds),
        to: [email],
        subject: "Reset your Handover password",
        html,
        ...resendReplyTo(creds),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("send-password-reset resend error:", res.status, text);
      return json({ error: "Could not send the reset email" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("send-password-reset error:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/send-password-reset")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
