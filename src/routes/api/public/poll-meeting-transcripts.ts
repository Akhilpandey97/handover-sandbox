import { createFileRoute } from "@tanstack/react-router";
import {
  adminClient,
  getTenantIntegrations,
  type TenantIntegrations,
} from "@/lib/tenant-integrations.server";
import { requireInternalCaller } from "@/lib/api-auth.server";
import {
  meetingsAwaitingTranscript,
  recordTranscript,
  vttToPlainText,
} from "@/lib/meeting-transcripts.server";
import { analyseMeeting } from "./analyse-meeting";

/**
 * Fetches transcripts for finished Google Meet and Teams calls.
 *
 * Neither provider pushes a transcript the way Zoom does — Meet exposes it on
 * the conference record and Teams on the online meeting — so both are polled.
 * Runs per tenant from the scheduler; each meeting is attempted independently
 * so one provider outage cannot stall the rest.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-token",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Creds = TenantIntegrations;
const cred = (creds: Creds, key: keyof TenantIntegrations): string | null => {
  const value = creds[key];
  return value && value.trim() ? value.trim() : null;
};

/** Google hands out short-lived access tokens; the workspace stores the refresh token. */
async function googleAccessToken(creds: Creds): Promise<string> {
  const clientId = cred(creds, "google_oauth_client_id");
  const clientSecret = cred(creds, "google_oauth_client_secret");
  const refreshToken = cred(creds, "google_meet_refresh_token");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Meet transcripts are not configured for this workspace");
  }

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
    throw new Error(`Google token refresh failed: ${data.error_description || res.status}`);
  }
  return data.access_token as string;
}

/**
 * Meet keeps transcripts on the conference record for the space, so the meeting
 * code out of the join link is enough to find the right call.
 */
async function fetchMeetTranscript(meetingCode: string, token: string): Promise<string | null> {
  const auth = { Authorization: `Bearer ${token}` };

  const recordsRes = await fetch(
    `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(`space.meeting_code="${meetingCode}"`)}`,
    { headers: auth },
  );
  if (!recordsRes.ok) throw new Error(`Meet conference lookup failed: ${recordsRes.status}`);
  const records = await recordsRes.json();
  // Most recent first; a recurring code can have many.
  const record = (records.conferenceRecords || [])[0];
  if (!record?.name) return null;

  const transcriptsRes = await fetch(`https://meet.googleapis.com/v2/${record.name}/transcripts`, {
    headers: auth,
  });
  if (!transcriptsRes.ok)
    throw new Error(`Meet transcript lookup failed: ${transcriptsRes.status}`);
  const transcripts = await transcriptsRes.json();
  const transcript = (transcripts.transcripts || [])[0];
  if (!transcript?.name) return null;

  // Entries are per-utterance, already attributed to a participant.
  const entriesRes = await fetch(
    `https://meet.googleapis.com/v2/${transcript.name}/entries?pageSize=1000`,
    { headers: auth },
  );
  if (!entriesRes.ok) throw new Error(`Meet transcript entries failed: ${entriesRes.status}`);
  const entries = await entriesRes.json();

  const text = (entries.transcriptEntries || [])
    .map((e: Record<string, string>) => {
      const speaker = e.participant?.split("/").pop() || "Speaker";
      return `${speaker}: ${e.text}`;
    })
    .join("\n")
    .trim();

  return text || null;
}

/** Graph app-only token for the workspace's Azure app. */
async function graphAccessToken(creds: Creds): Promise<string> {
  const tenant = cred(creds, "teams_tenant_id");
  const clientId = cred(creds, "teams_client_id");
  const clientSecret = cred(creds, "teams_client_secret");
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Teams transcripts are not configured for this workspace");
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Graph token request failed: ${data.error_description || res.status}`);
  }
  return data.access_token as string;
}

/**
 * Graph reaches an online meeting through the organiser, so the transcript is
 * looked up as the person who scheduled it here.
 */
async function fetchTeamsTranscript(
  joinUrl: string,
  organiserEmail: string,
  token: string,
): Promise<string | null> {
  const auth = { Authorization: `Bearer ${token}` };

  const meetingRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiserEmail)}/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${joinUrl}'`)}`,
    { headers: auth },
  );
  if (!meetingRes.ok) throw new Error(`Teams meeting lookup failed: ${meetingRes.status}`);
  const meetings = await meetingRes.json();
  const onlineMeeting = (meetings.value || [])[0];
  if (!onlineMeeting?.id) return null;

  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiserEmail)}/onlineMeetings/${onlineMeeting.id}/transcripts`,
    { headers: auth },
  );
  if (!listRes.ok) throw new Error(`Teams transcript lookup failed: ${listRes.status}`);
  const list = await listRes.json();
  const transcriptId = (list.value || [])[0]?.id;
  if (!transcriptId) return null;

  const contentRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiserEmail)}/onlineMeetings/${onlineMeeting.id}/transcripts/${transcriptId}/content?$format=text/vtt`,
    { headers: auth },
  );
  if (!contentRes.ok) throw new Error(`Teams transcript download failed: ${contentRes.status}`);
  return vttToPlainText(await contentRes.text()) || null;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  const results: Record<string, unknown>[] = [];

  try {
    const supabase = adminClient();
    const meetings = [
      ...(await meetingsAwaitingTranscript("google_meet")),
      ...(await meetingsAwaitingTranscript("teams")),
    ];

    // Only consider calls whose scheduled end has passed.
    const finished = meetings.filter((m) => {
      const end = new Date(m.scheduled_at).getTime() + (m.duration_minutes || 30) * 60_000;
      return end < Date.now();
    });

    for (const meeting of finished) {
      try {
        const creds = await getTenantIntegrations(meeting.tenant_id);
        let transcript: string | null = null;

        if (meeting.provider === "google_meet") {
          const code = meeting.provider_meeting_id;
          if (!code) {
            results.push({ meeting: meeting.id, skipped: "no meeting code in the join link" });
            continue;
          }
          transcript = await fetchMeetTranscript(code, await googleAccessToken(creds));
        } else {
          const { data: organiser } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", meeting.created_by)
            .maybeSingle();
          if (!organiser?.email) {
            results.push({
              meeting: meeting.id,
              skipped: "no organiser email to query Graph with",
            });
            continue;
          }
          transcript = await fetchTeamsTranscript(
            meeting.join_url,
            organiser.email,
            await graphAccessToken(creds),
          );
        }

        if (!transcript) {
          results.push({ meeting: meeting.id, status: "not ready" });
          continue;
        }

        await recordTranscript(meeting.id, transcript, meeting.provider);
        try {
          const analysis = await analyseMeeting(meeting.id, transcript);
          results.push({ meeting: meeting.id, status: "analysed", ...analysis });
        } catch (err) {
          results.push({
            meeting: meeting.id,
            status: "stored",
            analysis_error: (err as Error).message,
          });
        }
      } catch (err) {
        results.push({ meeting: meeting.id, error: (err as Error).message });
      }
    }

    return json({ success: true, considered: finished.length, results });
  } catch (error) {
    return json({ error: (error as Error).message, results }, 500);
  }
}

export const Route = createFileRoute("/api/public/poll-meeting-transcripts")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
