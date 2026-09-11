import { createFileRoute } from "@tanstack/react-router";
import { adminClient, getTenantIntegrations } from "@/lib/tenant-integrations.server";
import {
  hmacHex,
  recordTranscript,
  timingSafeEqual,
  vttToPlainText,
} from "@/lib/meeting-transcripts.server";
import { analyseMeeting } from "./analyse-meeting";

/**
 * Zoom's native transcript delivery.
 *
 * Zoom calls this when a cloud recording's transcript finishes processing. The
 * request is authenticated by Zoom's own signature rather than by our API auth,
 * so this route is deliberately outside requireInternalCaller — the signature
 * check below is what makes it safe.
 *
 * Set the endpoint in the Zoom app's Event Subscriptions and subscribe to
 * "Recording Transcript files have completed". The secret token from that same
 * screen goes in Settings → Integrations, or in ZOOM_WEBHOOK_SECRET.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Only the parts of Zoom's event payload this route reads. */
interface ZoomEvent {
  event?: string;
  /** Short-lived token for downloading the recording files in this event. */
  download_token?: string;
  payload?: {
    plainToken?: string;
    object?: {
      id?: string | number;
      recording_files?: {
        file_type?: string;
        file_extension?: string;
        download_url?: string;
      }[];
    };
  };
}

/**
 * The tenant is not known until the meeting is found, and the meeting id comes
 * from the unverified body — so the id is used only to choose which secret to
 * check the signature against. Nothing is trusted until that check passes.
 */
async function secretsForMeeting(zoomMeetingId: string | null): Promise<string[]> {
  const secrets: string[] = [];
  const platform = process.env["ZOOM_WEBHOOK_SECRET"];
  if (platform) secrets.push(platform);

  if (zoomMeetingId) {
    const { data } = await adminClient()
      .from("checklist_meetings")
      .select("tenant_id")
      .eq("provider", "zoom")
      .eq("provider_meeting_id", zoomMeetingId)
      .maybeSingle();
    if (data?.tenant_id) {
      const { zoom_webhook_secret } = await getTenantIntegrations(data.tenant_id);
      if (zoom_webhook_secret) secrets.push(zoom_webhook_secret);
    }
  }
  return secrets;
}

async function verifySignature(req: Request, rawBody: string, secrets: string[]): Promise<boolean> {
  const signature = req.headers.get("x-zm-signature") || "";
  const timestamp = req.headers.get("x-zm-request-timestamp") || "";
  if (!signature || !timestamp) return false;

  // Reject replays of a captured request.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  for (const secret of secrets) {
    const expected = `v0=${await hmacHex(secret, `v0:${timestamp}:${rawBody}`)}`;
    if (timingSafeEqual(signature, expected)) return true;
  }
  return false;
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  let body: ZoomEvent;
  try {
    body = JSON.parse(rawBody) as ZoomEvent;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const event: string = body.event || "";
  const object = body.payload?.object || {};
  const zoomMeetingId = object.id ? String(object.id) : null;
  const secrets = await secretsForMeeting(zoomMeetingId);

  if (secrets.length === 0) {
    console.error("zoom-webhook: no webhook secret configured");
    return json({ error: "Zoom webhook secret is not configured" }, 503);
  }

  // Zoom proves it owns the endpoint by asking us to sign a token with the secret.
  if (event === "endpoint.url_validation") {
    const plainToken = body.payload?.plainToken;
    if (!plainToken) return json({ error: "Missing plainToken" }, 400);
    return json({ plainToken, encryptedToken: await hmacHex(secrets[0], plainToken) });
  }

  if (!(await verifySignature(req, rawBody, secrets))) {
    return json({ error: "Invalid signature" }, 401);
  }

  if (event !== "recording.transcript_completed") {
    // Subscribed-but-uninteresting events are acknowledged so Zoom does not retry.
    return json({ ignored: event });
  }

  try {
    if (!zoomMeetingId) return json({ error: "No meeting id on the event" }, 400);

    const { data: meeting } = await adminClient()
      .from("checklist_meetings")
      .select("id, transcript")
      .eq("provider", "zoom")
      .eq("provider_meeting_id", zoomMeetingId)
      .maybeSingle();

    // A call that was not scheduled from a checklist item is not ours to store.
    if (!meeting) return json({ ignored: "meeting not tracked", zoom_meeting_id: zoomMeetingId });
    if (meeting.transcript) return json({ ignored: "transcript already stored" });

    const file = (object.recording_files || []).find(
      (f) => f.file_type === "TRANSCRIPT" || f.file_extension === "VTT",
    );
    if (!file?.download_url) return json({ ignored: "no transcript file in the event" });

    // The short-lived download token arrives with the event itself.
    const downloadToken: string | undefined = body.download_token;
    const res = await fetch(file.download_url, {
      headers: downloadToken ? { Authorization: `Bearer ${downloadToken}` } : {},
    });
    if (!res.ok) {
      console.error("zoom-webhook: transcript download failed", res.status);
      return json({ error: `Transcript download failed: ${res.status}` }, 502);
    }

    const transcript = vttToPlainText(await res.text());
    if (!transcript) return json({ ignored: "transcript was empty" });

    await recordTranscript(meeting.id, transcript, "zoom");

    // Analysis failing must not make Zoom retry a transcript we already stored.
    try {
      await analyseMeeting(meeting.id, transcript);
    } catch (err) {
      console.error("zoom-webhook: analysis failed", (err as Error).message);
    }

    return json({ success: true, meeting_id: meeting.id });
  } catch (error) {
    console.error("zoom-webhook error:", error);
    return json({ error: (error as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/zoom-webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
});
