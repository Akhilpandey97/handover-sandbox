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
 * Which secrets this request could legitimately be signed with.
 *
 * The tenant is not known until the meeting is found, and the meeting id comes
 * from the unverified body — so the id is used only to choose which secret to
 * check the signature against. Nothing is trusted until that check passes.
 *
 * Zoom's validation handshake carries no meeting id, so a workspace secret was
 * unreachable at exactly the moment it was needed and the endpoint could never
 * be validated against one. Two routes out of that: `?tenant=` on the endpoint
 * URL names the workspace outright, and failing that a deployment serving one
 * configured workspace uses its secret, which is the common case.
 */
async function candidateSecrets(opts: {
  zoomMeetingId: string | null;
  tenantId: string | null;
  /** Validation carries no meeting, so it may fall back to the lone workspace. */
  allowSoleTenant: boolean;
}): Promise<string[]> {
  const secrets: string[] = [];
  const platform = process.env["ZOOM_WEBHOOK_SECRET"];
  if (platform) secrets.push(platform);

  const addTenant = async (tenantId: string) => {
    const { zoom_webhook_secret } = await getTenantIntegrations(tenantId);
    if (zoom_webhook_secret && !secrets.includes(zoom_webhook_secret)) {
      secrets.push(zoom_webhook_secret);
    }
  };

  if (opts.tenantId) await addTenant(opts.tenantId);

  if (opts.zoomMeetingId) {
    const { data } = await adminClient()
      .from("checklist_meetings")
      .select("tenant_id")
      .eq("provider", "zoom")
      .eq("provider_meeting_id", opts.zoomMeetingId)
      .maybeSingle();
    if (data?.tenant_id) await addTenant(data.tenant_id);
  }

  if (secrets.length === 0 && opts.allowSoleTenant) {
    const { data } = await adminClient()
      .from("tenant_integrations")
      .select("tenant_id, zoom_webhook_secret")
      .not("zoom_webhook_secret", "is", null)
      .limit(2);
    // Exactly one, or there is no way to know whose secret Zoom is using.
    if (data?.length === 1 && data[0]?.tenant_id) await addTenant(data[0].tenant_id);
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
  // Optional, and only ever used to pick which secret to check against.
  const tenantId = new URL(req.url).searchParams.get("tenant");
  const secrets = await candidateSecrets({
    zoomMeetingId,
    tenantId,
    allowSoleTenant: event === "endpoint.url_validation",
  });

  // Zoom proves it owns the endpoint by asking us to sign a token with the
  // secret. Answered before the signature check because the validation request
  // is how the secret gets confirmed in the first place.
  if (event === "endpoint.url_validation") {
    if (secrets.length === 0) {
      console.error("zoom-webhook: validation attempted with no webhook secret configured");
      return json({ error: "Zoom webhook secret is not configured" }, 503);
    }
    const plainToken = body.payload?.plainToken;
    if (!plainToken) return json({ error: "Missing plainToken" }, 400);
    return json({ plainToken, encryptedToken: await hmacHex(secrets[0], plainToken) });
  }

  // A missing secret and a wrong signature answer identically. They used to
  // differ — 503 against 401 — which told an unauthenticated caller whether a
  // given Zoom meeting id was tracked in this system.
  if (secrets.length === 0) {
    console.error("zoom-webhook: no webhook secret configured for this meeting");
    return json({ error: "Invalid signature" }, 401);
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

const methodNotAllowed = () =>
  json({ error: "Method not allowed. Zoom posts to this endpoint." }, 405);

export const Route = createFileRoute("/api/public/zoom-webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      // Without these a GET fell through to the page handler and answered 200
      // with HTML, which reads as "endpoint fine" while setting Zoom up.
      GET: () => methodNotAllowed(),
      PUT: () => methodNotAllowed(),
      DELETE: () => methodNotAllowed(),
    },
  },
});
