import { createFileRoute } from "@tanstack/react-router";
import {
  adminClient,
  getTenantIntegrations,
  requireCred,
  resendFrom,
  resendReplyTo,
} from "@/lib/tenant-integrations.server";
import { requireInternalCaller } from "@/lib/api-auth.server";

/**
 * Emails the invitation for a checklist meeting.
 *
 * The meeting itself lives in the organiser's own provider — we hold the join
 * link, not the calendar entry — so the invite carries a real .ics attachment.
 * That is what puts the call in each attendee's calendar, reminders included,
 * without this app needing calendar write access anywhere.
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

const PROVIDER_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** iCalendar folds long lines at 75 octets; unfolded lines are silently dropped by some clients. */
const foldIcsLine = (line: string): string => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
};

const icsEscape = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const icsStamp = (iso: string) =>
  `${new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;

function buildIcs(
  meeting: {
    id: string;
    title: string;
    agenda: string | null;
    join_url: string;
    scheduled_at: string;
    duration_minutes: number;
    attendees: string[];
    provider: string;
  },
  organiser: string,
): string {
  const end = new Date(
    new Date(meeting.scheduled_at).getTime() + meeting.duration_minutes * 60_000,
  ).toISOString();

  const description = [
    meeting.agenda || "",
    "",
    `Join (${PROVIDER_LABEL[meeting.provider] || meeting.provider}): ${meeting.join_url}`,
  ]
    .join("\n")
    .trim();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Handover//Checklist Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@handover`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(meeting.scheduled_at)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(meeting.join_url)}`,
    `URL:${icsEscape(meeting.join_url)}`,
    `ORGANIZER:mailto:${organiser}`,
    ...meeting.attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a}`),
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldIcsLine).join("\r\n");
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const meetingId: string = body.meeting_id;
    if (!meetingId) return json({ error: "meeting_id is required" }, 400);

    const supabase = adminClient();
    const { data: meeting, error } = await supabase
      .from("checklist_meetings")
      .select("*")
      .eq("id", meetingId)
      .maybeSingle();
    if (error) throw error;
    if (!meeting) return json({ error: "Meeting not found" }, 404);

    const attendees: string[] = Array.isArray(meeting.attendees) ? meeting.attendees : [];
    if (attendees.length === 0) return json({ error: "This meeting has no attendees" }, 400);

    const creds = await getTenantIntegrations(meeting.tenant_id);
    const resendKey = requireCred(creds, "resend_api_key", "Resend email");
    const from = resendFrom(creds, "Handover");

    const projectName: string =
      body.project_name ||
      (
        await supabase
          .from("projects")
          .select("merchant_name")
          .eq("id", meeting.project_id)
          .maybeSingle()
      ).data?.merchant_name ||
      "";

    const when = new Date(meeting.scheduled_at).toLocaleString("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
    });
    const providerLabel = PROVIDER_LABEL[meeting.provider] || meeting.provider;

    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
        <h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(meeting.title)}</h2>
        ${projectName ? `<p style="margin:0 0 16px;color:#546978;font-size:13px">${escapeHtml(projectName)}</p>` : ""}
        <p style="margin:0 0 4px"><strong>When:</strong> ${escapeHtml(when)} (${meeting.duration_minutes} min)</p>
        <p style="margin:0 0 16px"><strong>Where:</strong> ${escapeHtml(providerLabel)}</p>
        ${meeting.agenda ? `<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(meeting.agenda)}</p>` : ""}
        <p style="margin:0 0 20px">
          <a href="${escapeHtml(meeting.join_url)}"
             style="background:#24598a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
            Join ${escapeHtml(providerLabel)}
          </a>
        </p>
        <p style="margin:0;color:#546978;font-size:12px">
          The calendar invitation is attached. Minutes are posted back to the project checklist after the call.
        </p>
      </div>`;

    const ics = buildIcs(
      { ...meeting, attendees } as Parameters<typeof buildIcs>[0],
      creds.from_email || "no-reply@handover",
    );

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        ...resendReplyTo(creds),
        to: attendees,
        subject: `Invitation: ${meeting.title}${projectName ? ` — ${projectName}` : ""}`,
        html,
        attachments: [
          {
            filename: "invite.ics",
            content: btoa(unescape(encodeURIComponent(ics))),
            content_type: "text/calendar; method=REQUEST",
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Resend invite failed:", res.status, text);
      return json({ error: `Invite could not be sent: ${text.slice(0, 200)}` }, 502);
    }

    await supabase
      .from("checklist_meetings")
      .update({ invite_sent_at: new Date().toISOString() })
      .eq("id", meetingId);

    return json({ success: true, sent_to: attendees });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/send-meeting-invite")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
