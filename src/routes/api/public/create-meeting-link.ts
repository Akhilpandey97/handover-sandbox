import { createFileRoute } from "@tanstack/react-router";
import { userCaller } from "@/lib/api-auth.server";
import { getTenantIntegrations, requireCred } from "@/lib/tenant-integrations.server";

/**
 * Creates a real meeting in the tenant's own provider account and hands back
 * the join link, so the scheduler no longer needs a link pasted by hand.
 *
 * Every credential is read per tenant from tenant_integrations; a tenant that
 * has not configured a provider simply gets a clear error and keeps using the
 * manual link box.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Body {
  provider?: string;
  title?: string;
  agenda?: string;
  scheduled_at?: string;
  duration_minutes?: number;
  attendees?: string[];
}

async function failText(res: Response, label: string): Promise<never> {
  const text = await res.text();
  throw new Error(`${label} failed [${res.status}]: ${text.slice(0, 400)}`);
}

async function zoomLink(
  creds: Awaited<ReturnType<typeof getTenantIntegrations>>,
  body: Required<Pick<Body, "title" | "scheduled_at" | "duration_minutes">> & { agenda?: string },
) {
  const accountId = requireCred(creds, "zoom_account_id", "Zoom Account ID");
  const clientId = requireCred(creds, "zoom_client_id", "Zoom Client ID");
  const clientSecret = requireCred(creds, "zoom_client_secret", "Zoom Client Secret");

  const tokenRes = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
    },
  );
  if (!tokenRes.ok) await failText(tokenRes, "Zoom token");
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const user = creds.zoom_user_id || "me";
  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(user)}/meetings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: body.title,
      type: 2,
      start_time: new Date(body.scheduled_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: body.duration_minutes,
      timezone: "UTC",
      agenda: body.agenda || undefined,
      settings: { join_before_host: true, auto_recording: "cloud" },
    }),
  });
  if (!res.ok) await failText(res, "Zoom meeting create");
  const data = (await res.json()) as { join_url: string; id: number };
  return { join_url: data.join_url, provider_meeting_id: String(data.id) };
}

async function googleMeetLink(
  creds: Awaited<ReturnType<typeof getTenantIntegrations>>,
  body: Required<Pick<Body, "title" | "scheduled_at" | "duration_minutes">> & {
    agenda?: string;
    attendees?: string[];
  },
) {
  const clientId = requireCred(creds, "google_oauth_client_id", "Google OAuth Client ID");
  const clientSecret = requireCred(
    creds,
    "google_oauth_client_secret",
    "Google OAuth Client Secret",
  );
  const refreshToken =
    creds.google_calendar_refresh_token ||
    requireCred(creds, "google_calendar_refresh_token", "Google Calendar Refresh Token");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok) await failText(tokenRes, "Google token");
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const start = new Date(body.scheduled_at);
  const end = new Date(start.getTime() + body.duration_minutes * 60_000);

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: body.title,
        description: body.agenda || undefined,
        start: { dateTime: start.toISOString(), timeZone: "UTC" },
        end: { dateTime: end.toISOString(), timeZone: "UTC" },
        attendees: (body.attendees || []).map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );
  if (!res.ok) await failText(res, "Google Calendar event create");
  const data = (await res.json()) as {
    hangoutLink?: string;
    id?: string;
    conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
  };
  const link =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  if (!link) throw new Error("Google returned no Meet link for the event");
  return { join_url: link, provider_meeting_id: data.id ?? null };
}

async function teamsLink(
  creds: Awaited<ReturnType<typeof getTenantIntegrations>>,
  body: Required<Pick<Body, "title" | "scheduled_at" | "duration_minutes">>,
) {
  const tenant = requireCred(creds, "teams_tenant_id", "Microsoft Tenant ID");
  const clientId = requireCred(creds, "teams_client_id", "Microsoft Client ID");
  const clientSecret = requireCred(creds, "teams_client_secret", "Microsoft Client Secret");
  const organiser = requireCred(
    creds,
    "teams_organizer_user_id",
    "Microsoft Teams Organiser User ID",
  );

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!tokenRes.ok) await failText(tokenRes, "Microsoft token");
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const start = new Date(body.scheduled_at);
  const end = new Date(start.getTime() + body.duration_minutes * 60_000);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser)}/onlineMeetings`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: body.title,
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
      }),
    },
  );
  if (!res.ok) await failText(res, "Teams meeting create");
  const data = (await res.json()) as { joinWebUrl: string; id: string };
  return { join_url: data.joinWebUrl, provider_meeting_id: data.id };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const caller = await userCaller(req);
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  const provider = body.provider;
  const title = (body.title || "").trim();
  const scheduled_at = body.scheduled_at;
  const duration_minutes = body.duration_minutes || 30;

  if (!provider || !title || !scheduled_at) {
    return json({ error: "provider, title and scheduled_at are required" }, 400);
  }

  try {
    const creds = await getTenantIntegrations(caller.tenantId);
    const input = { title, scheduled_at, duration_minutes, agenda: body.agenda };

    if (provider === "zoom") return json(await zoomLink(creds, input));
    if (provider === "google_meet")
      return json(await googleMeetLink(creds, { ...input, attendees: body.attendees }));
    if (provider === "teams") return json(await teamsLink(creds, input));

    return json({ error: `Unknown provider: ${provider}` }, 400);
  } catch (err) {
    const message = (err as Error).message;
    console.error("create-meeting-link error:", message);
    return json({ error: message }, 400);
  }
}

export const Route = createFileRoute("/api/public/create-meeting-link")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
