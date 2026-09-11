import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logActivity } from "@/hooks/useActivityLogs";
import { apiAuthHeaders } from "@/lib/api-invoke";

/**
 * checklist_meetings is in the generated types now; the loose client is kept
 * only so the row shape below stays the single contract for this hook.
 */
const db = supabase as unknown as SupabaseClient;


export type MeetingProvider = "google_meet" | "zoom" | "teams";

export const MEETING_PROVIDERS: { value: MeetingProvider; label: string; hint: string }[] = [
  { value: "google_meet", label: "Google Meet", hint: "meet.google.com/abc-defg-hij" },
  { value: "zoom", label: "Zoom", hint: "yourorg.zoom.us/j/85012345678" },
  { value: "teams", label: "Microsoft Teams", hint: "teams.microsoft.com/l/meetup-join/..." },
];

export interface ChecklistMeeting {
  id: string;
  tenant_id: string | null;
  project_id: string;
  checklist_item_id: string;
  title: string;
  agenda: string | null;
  provider: MeetingProvider;
  join_url: string;
  scheduled_at: string;
  duration_minutes: number;
  attendees: string[];
  status: "scheduled" | "completed" | "cancelled";
  invite_sent_at: string | null;
  provider_meeting_id: string | null;
  transcript: string | null;
  transcript_source: string | null;
  transcript_received_at: string | null;
  analysis_status: "pending" | "processing" | "done" | "failed";
  analysis_error: string | null;
  analysed_at: string | null;
  mom_comment_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The provider's own id for a call, read out of the join link where the link
 * contains it. It is how a webhook or a transcript poller finds this meeting
 * again, so it is worth capturing at schedule time rather than waiting for the
 * provider to tell us.
 */
export const providerMeetingIdFromUrl = (
  provider: MeetingProvider,
  joinUrl: string,
): string | null => {
  try {
    const url = new URL(joinUrl);
    if (provider === "zoom") {
      // https://<host>.zoom.us/j/85012345678?pwd=...
      const match = url.pathname.match(/\/j\/(\d+)/);
      return match ? match[1] : null;
    }
    if (provider === "google_meet") {
      // https://meet.google.com/abc-defg-hij
      const code = url.pathname.replace(/^\//, "").split("/")[0];
      return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code) ? code.toLowerCase() : null;
    }
    // Teams join links carry an encoded thread id rather than a stable meeting
    // id; the Graph poller resolves it, so leave it unset here.
    return null;
  } catch {
    return null;
  }
};

const parseAttendees = (row: { attendees: unknown }): string[] =>
  Array.isArray(row.attendees) ? (row.attendees as string[]) : [];

const asMeeting = (row: Record<string, unknown>): ChecklistMeeting =>
  ({ ...row, attendees: parseAttendees(row as { attendees: unknown }) }) as ChecklistMeeting;

export const useChecklistMeetings = (projectId?: string) => {
  return useQuery({
    queryKey: ["checklist-meetings", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db
        .from("checklist_meetings")
        .select("*")
        .eq("project_id", projectId!)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(asMeeting);
    },
  });
};

export const useChecklistMeetingsByItem = (checklistItemId?: string) => {
  return useQuery({
    queryKey: ["checklist-meetings-item", checklistItemId],
    enabled: !!checklistItemId,
    queryFn: async () => {
      const { data, error } = await db
        .from("checklist_meetings")
        .select("*")
        .eq("checklist_item_id", checklistItemId!)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(asMeeting);
    },
  });
};

const invalidate = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ["checklist-meetings"] });
  queryClient.invalidateQueries({ queryKey: ["checklist-meetings-item"] });
};

export interface NewMeeting {
  checklist_item_id: string;
  project_id: string;
  title: string;
  agenda?: string;
  provider: MeetingProvider;
  join_url: string;
  scheduled_at: string;
  duration_minutes: number;
  attendees: string[];
  /** Email the invitation as soon as the meeting is saved. */
  send_invite: boolean;
  project_name?: string;
  checklist_item_title?: string;
}

export const useAddChecklistMeeting = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async (meeting: NewMeeting) => {
      const { send_invite, project_name, checklist_item_title, ...payload } = meeting;

      const { data, error } = await db
        .from("checklist_meetings")
        .insert({
          ...payload,
          attendees: payload.attendees,
          provider_meeting_id: providerMeetingIdFromUrl(payload.provider, payload.join_url),
          created_by: currentUser?.id ?? null,
          created_by_name: currentUser?.name ?? null,
          tenant_id: currentUser?.tenantId || null,
        })
        .select()
        .single();
      if (error) throw error;

      const created = asMeeting(data as Record<string, unknown>);

      if (send_invite && created.attendees.length > 0) {
        // A failed invite must not lose the meeting, so it is reported on its
        // own rather than failing the mutation.
        try {
          const res = await fetch("/api/public/send-meeting-invite", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await apiAuthHeaders()) },
            body: JSON.stringify({ meeting_id: created.id, project_name, checklist_item_title }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || "Invite could not be sent");
        } catch (err) {
          toast.warning(`Meeting saved, but the invite failed: ${(err as Error).message}`);
        }
      }

      return created;
    },
    onSuccess: (created) => {
      invalidate(queryClient);
      toast.success("Meeting scheduled");
      logActivity({
        action_type: "user",
        category: "checklist",
        description: `Scheduled meeting "${created.title}"`,
        entity_type: "project",
        entity_id: created.project_id,
      });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to schedule meeting"),
  });
};

export const useUpdateChecklistMeeting = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ChecklistMeeting> & { id: string }) => {
      const { error } = await db.from("checklist_meetings").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(queryClient),
    onError: (err: Error) => toast.error(err.message || "Failed to update meeting"),
  });
};

export const useDeleteChecklistMeeting = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("checklist_meetings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate(queryClient);
      toast.success("Meeting removed");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove meeting"),
  });
};

/**
 * Hand a transcript to the AI layer. Used by the paste box and by the "re-run"
 * action; providers reach the same pipeline through the intake endpoint.
 */
export const useAnalyseMeeting = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ meetingId, transcript }: { meetingId: string; transcript?: string }) => {
      const res = await fetch("/api/public/analyse-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await apiAuthHeaders()) },
        body: JSON.stringify({ meeting_id: meetingId, transcript }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Analysis failed");
      return body as { risks_created: number; comment_id: string | null };
    },
    onSuccess: (result) => {
      invalidate(queryClient);
      queryClient.invalidateQueries({ queryKey: ["checklist-comments"] });
      queryClient.invalidateQueries({ queryKey: ["project-risks"] });
      toast.success(
        result.risks_created > 0
          ? `Minutes posted, ${result.risks_created} risk(s) flagged`
          : "Minutes posted by Meeting AI",
      );
    },
    onError: (err: Error) => toast.error(err.message || "Analysis failed"),
  });
};
