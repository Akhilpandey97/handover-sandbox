import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { invokeApi } from "@/lib/api-invoke";
import { toast } from "sonner";
import {
  MEETING_PROVIDERS,
  MeetingProvider,
  ChecklistMeeting,
  useChecklistMeetingsByItem,
  useAddChecklistMeeting,
  useDeleteChecklistMeeting,
  useAnalyseMeeting,
} from "@/hooks/useChecklistMeetings";
import {
  Video,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Wand2,
} from "lucide-react";

interface MeetingSchedulerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistItemId: string;
  checklistItemTitle: string;
  projectId: string;
  projectName?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `datetime-local` wants local wall-clock time, not the ISO string we store. */
const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const defaultStart = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60 - (d.getMinutes() % 30), 0, 0);
  return toLocalInput(d);
};

const statusStyles: Record<ChecklistMeeting["analysis_status"], string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-pending-soft text-pending-strong",
  done: "bg-success-soft text-success-strong",
  failed: "bg-destructive-soft text-destructive-strong",
};

export const MeetingSchedulerDialog = ({
  open,
  onOpenChange,
  checklistItemId,
  checklistItemTitle,
  projectId,
  projectName,
}: MeetingSchedulerDialogProps) => {
  const { data: meetings = [], isLoading } = useChecklistMeetingsByItem(checklistItemId);
  const addMeeting = useAddChecklistMeeting();
  const deleteMeeting = useDeleteChecklistMeeting();
  const analyse = useAnalyseMeeting();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [provider, setProvider] = useState<MeetingProvider>("google_meet");
  const [joinUrl, setJoinUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultStart);
  const [duration, setDuration] = useState("30");
  const [attendeeInput, setAttendeeInput] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [transcriptFor, setTranscriptFor] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState("");

  const providerMeta = useMemo(
    () => MEETING_PROVIDERS.find((p) => p.value === provider)!,
    [provider],
  );

  const resetForm = () => {
    setTitle("");
    setAgenda("");
    setJoinUrl("");
    setScheduledAt(defaultStart());
    setDuration("30");
    setAttendeeInput("");
    setAttendees([]);
    setSendInvite(true);
    setGenerating(false);
    setShowForm(false);
  };

  /** Accepts one address or a pasted comma/space separated list. */
  const commitAttendees = (raw: string) => {
    const found = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const valid = found.filter((e) => EMAIL_RE.test(e));
    if (valid.length > 0) {
      setAttendees((prev) => Array.from(new Set([...prev, ...valid])));
      setAttendeeInput(found.filter((e) => !EMAIL_RE.test(e)).join(" "));
    }
  };

  const canSave = title.trim().length > 0 && scheduledAt.length > 0;

  /**
   * Ask the tenant's own provider account for a real meeting. Returns null when
   * that tenant has no credentials for the provider, leaving the manual box.
   */
  const generateLink = async (silent = false): Promise<string | null> => {
    setGenerating(true);
    try {
      const { data, error } = await invokeApi<{ join_url: string }>("create-meeting-link", {
        body: {
          provider,
          title: title.trim() || checklistItemTitle,
          agenda: agenda.trim() || undefined,
          scheduled_at: new Date(scheduledAt).toISOString(),
          duration_minutes: Number(duration) || 30,
          attendees,
        },
      });
      if (error || !data?.join_url) {
        if (!silent) toast.error(error?.message || "Could not create the link");
        return null;
      }
      setJoinUrl(data.join_url);
      if (!silent) toast.success("Link created");
      return data.join_url;
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    // A trailing address typed but not yet committed should still count.
    const pending = attendeeInput.trim().toLowerCase();
    const finalAttendees =
      pending && EMAIL_RE.test(pending) ? Array.from(new Set([...attendees, pending])) : attendees;

    let link = joinUrl.trim();
    if (!link) {
      link = (await generateLink(true)) || "";
      if (!link) {
        toast.error(
          `Add a ${providerMeta.label} link, or set up ${providerMeta.label} under Settings → Integrations to create one automatically.`,
        );
        return;
      }
    }

    await addMeeting.mutateAsync({
      checklist_item_id: checklistItemId,
      project_id: projectId,
      title: title.trim(),
      agenda: agenda.trim() || undefined,
      provider,
      join_url: link,
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_minutes: Number(duration) || 30,
      attendees: finalAttendees,
      send_invite: sendInvite,
      project_name: projectName,
      checklist_item_title: checklistItemTitle,
    });
    resetForm();
  };

  const handleAnalyse = async (meetingId: string) => {
    await analyse.mutateAsync({
      meetingId,
      transcript: transcriptText.trim() || undefined,
    });
    setTranscriptFor(null);
    setTranscriptText("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            Meetings
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{checklistItemTitle}</p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-3">
            {isLoading && (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading meetings…</p>
            )}

            {!isLoading && meetings.length === 0 && !showForm && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No meetings yet. Schedule one and the minutes come back here after the call.
              </p>
            )}

            {meetings.map((meeting) => {
              const when = new Date(meeting.scheduled_at);
              const providerLabel =
                MEETING_PROVIDERS.find((p) => p.value === meeting.provider)?.label ??
                meeting.provider;
              return (
                <div key={meeting.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{meeting.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {when.toLocaleString()} · {meeting.duration_minutes} min · {providerLabel}
                      </p>
                      {meeting.attendees.length > 0 && (
                        <p className="mt-1 truncate text-2xs text-muted-foreground">
                          {meeting.attendees.join(", ")}
                          {meeting.invite_sent_at && (
                            <span className="ml-1 text-success-strong">
                              · invited
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" asChild>
                        <a href={meeting.join_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3 w-3" />
                          Join
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => deleteMeeting.mutate(meeting.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className={cn("text-2xs", statusStyles[meeting.analysis_status])}>
                      {meeting.analysis_status === "done" && (
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                      )}
                      {meeting.analysis_status === "failed" && (
                        <AlertTriangle className="mr-1 h-3 w-3" />
                      )}
                      {meeting.analysis_status === "done"
                        ? "Minutes posted"
                        : meeting.analysis_status === "failed"
                          ? "Analysis failed"
                          : meeting.transcript
                            ? "Transcript received"
                            : "Awaiting transcript"}
                    </Badge>
                    {meeting.transcript_source && (
                      <span className="text-2xs text-muted-foreground">
                        via {meeting.transcript_source.replace("_", " ")}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 gap-1 px-2 text-xs"
                      onClick={() =>
                        setTranscriptFor(transcriptFor === meeting.id ? null : meeting.id)
                      }
                    >
                      <Sparkles className="h-3 w-3" />
                      {meeting.analysis_status === "done" ? "Re-run" : "Analyse"}
                    </Button>
                  </div>

                  {meeting.analysis_error && (
                    <p className="mt-2 text-2xs text-destructive">{meeting.analysis_error}</p>
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
                        className="min-h-[100px] text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setTranscriptFor(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={
                            analyse.isPending || (!meeting.transcript && !transcriptText.trim())
                          }
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
              );
            })}

            {showForm ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Integration kick-off"
                    className="h-9"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Provider</Label>
                    <Select
                      value={provider}
                      onValueChange={(v) => setProvider(v as MeetingProvider)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEETING_PROVIDERS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Duration</Label>
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["15", "30", "45", "60", "90"].map((d) => (
                          <SelectItem key={d} value={d}>
                            {d} minutes
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Join link</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-2xs"
                      disabled={generating || !scheduledAt}
                      onClick={() => generateLink()}
                    >
                      {generating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wand2 className="h-3 w-3" />
                      )}
                      Generate with {providerMeta.label}
                    </Button>
                  </div>
                  <Input
                    value={joinUrl}
                    onChange={(e) => setJoinUrl(e.target.value)}
                    placeholder={providerMeta.hint}
                    className="h-9"
                  />
                  <p className="text-2xs text-muted-foreground">
                    Left blank, the link is created in your {providerMeta.label} account on save.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Starts</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Invite</Label>
                  <Input
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onBlur={() => commitAttendees(attendeeInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "," || e.key === " ") {
                        e.preventDefault();
                        commitAttendees(attendeeInput);
                      }
                    }}
                    placeholder="name@merchant.com — press Enter after each"
                    className="h-9"
                  />
                  {attendees.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {attendees.map((email) => (
                        <Badge key={email} variant="secondary" className="gap-1 text-2xs">
                          {email}
                          <button
                            type="button"
                            onClick={() => setAttendees((prev) => prev.filter((e) => e !== email))}
                            className="hover:text-destructive"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Agenda (optional)</Label>
                  <Textarea
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                    placeholder="What this call needs to settle"
                    className="min-h-[60px] text-sm"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={sendInvite}
                    onCheckedChange={(v) => setSendInvite(v === true)}
                  />
                  <Mail className="h-3 w-3" />
                  Email the invitation now, with a calendar attachment
                </label>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={!canSave || addMeeting.isPending || generating}
                    onClick={handleSave}
                  >
                    {addMeeting.isPending || generating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Schedule
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                onClick={() => setShowForm(true)}
              >
                <Plus className="h-3 w-3" />
                Schedule a meeting
              </Button>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
