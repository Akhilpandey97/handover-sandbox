/**
 * Gmail, talking to Google directly.
 *
 * This replaces Lovable's connector gateway, which held the Google tokens and refreshed
 * them for us. The app now does what it already does for Meet and Calendar: swap a
 * per-workspace refresh token for an access token, then call the Gmail API.
 *
 * Credentials live in tenant_integrations (Settings → Integrations):
 *   google_oauth_client_id / google_oauth_client_secret  — the Google Cloud OAuth client
 *   google_mail_refresh_token                            — the authorised mailbox
 */
import type { TenantIntegrations } from "@/lib/tenant-integrations.server";

/** The Gmail API itself, in place of connector-gateway.lovable.dev/google_mail/gmail/v1. */
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/** Access tokens last an hour; keep them in memory so each poll doesn't re-mint one. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function cred(creds: Partial<TenantIntegrations>, key: keyof TenantIntegrations): string | null {
  const fromDb = (creds as Record<string, string | null | undefined>)[key];
  return fromDb || null;
}

export async function gmailAccessToken(creds: Partial<TenantIntegrations>): Promise<string> {
  const clientId = cred(creds, "google_oauth_client_id") || process.env["GOOGLE_OAUTH_CLIENT_ID"] || null;
  const clientSecret =
    cred(creds, "google_oauth_client_secret") || process.env["GOOGLE_OAUTH_CLIENT_SECRET"] || null;
  const refreshToken =
    cred(creds, "google_mail_refresh_token") || process.env["GOOGLE_MAIL_REFRESH_TOKEN"] || null;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail is not configured for this workspace (Settings → Integrations: Google OAuth client and mail refresh token)",
    );
  }

  const cacheKey = `${clientId}:${refreshToken.slice(-12)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  tokenCache.set(cacheKey, {
    token: data.access_token as string,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });

  return data.access_token as string;
}

/** Headers for a Gmail API call, in place of the gateway's two-key header pair. */
export async function gmailHeaders(
  creds: Partial<TenantIntegrations>,
): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await gmailAccessToken(creds)}` };
}
