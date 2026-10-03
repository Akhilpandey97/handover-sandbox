import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChecklistMeeting,
  useDeleteChecklistMeeting,
  useAnalyseMeeting,
} from "@/hooks/useChecklistMeetings";
import {
  Trash2,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const statusStyles: Record<ChecklistMeeting["analysis_status"], string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-pending-soft text-pending-strong",
  done: "bg-success-soft text-success-strong",
  failed: "bg-destructive-soft text-destructive-strong",
};

const statusLabel = (meeting: ChecklistMeeting) => {
  if (meeting.analysis_status === "done") return "Minutes posted";
  if (meeting.analysis_status === "failed") return "Analysis failed";
  return meeting.transcript ? "Transcript received" : "Awaiting transcript";
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The meetings held against one checklist step, with the two things only this list
 * can do: delete one, and turn a transcript into posted minutes.
 */
export const ChecklistItemMeetings = ({ meetings }: { meetings: ChecklistMeeting[] }) => {
  const deleteMeeting = useDeleteChecklistMeeting();
  const analyse = useAnalyseMeeting();

  const [transcriptFor, setTranscriptFor] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState("");

  const handleAnalyse = async (meetingId: string) => {
    await analyse.mutateAsync({ meetingId, transcript: transcriptText.trim() || undefined });
    setTranscriptFor(null);
    setTranscriptText("");
  };

  return (
    <div className="space-y-1">
      {meetings.map((meeting) => (
        <div
          key={meeting.id}
          className="group rounded-md border border-border/50 bg-card px-2 py-1.5 transition-colors hover:border-primary/30"
        >
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-foreground">{meeting.title}</span>
            {meeting.join_url && (
              <a
                href={meeting.join_url}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-0.5 text-2xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Join
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete meeting "${meeting.title}"`}
              className="h-5 w-5 shrink-0 p-0 text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => deleteMeeting.mutate(meeting.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-2xs text-muted-foreground">
              {when(meeting.scheduled_at)} · {meeting.duration_minutes}m
            </span>
            <Badge className={cn("text-2xs", statusStyles[meeting.analysis_status])}>
              {meeting.analysis_status === "done" && <CheckCircle2 className="mr-1 h-2.5 w-2.5" />}
              {meeting.analysis_status === "failed" && (
                <AlertTriangle className="mr-1 h-2.5 w-2.5" />
              )}
              {statusLabel(meeting)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-2xs"
              onClick={() => setTranscriptFor(transcriptFor === meeting.id ? null : meeting.id)}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {meeting.analysis_status === "done" ? "Re-run" : "Analyse"}
            </Button>
          </div>

          {meeting.analysis_error && (
            <p className="mt-1 text-2xs text-destructive">{meeting.analysis_error}</p>
          )}

          {transcriptFor === meeting.id && (
            <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-2">
              <p className="text-2xs text-muted-foreground">
                {meeting.transcript
                  ? "A transcript is already stored. Paste a replacement below, or run the analysis on what is there."
                  : "Paste the transcript to analyse it now. Otherwise it arrives from the provider on its own."}
              </p>
              <Textarea
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Paste the call transcript…"
                className="min-h-[80px] text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTranscriptFor(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={analyse.isPending || (!meeting.transcript && !transcriptText.trim())}
                  onClick={() => handleAnalyse(meeting.id)}
                >
                  {analyse.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Post minutes
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
