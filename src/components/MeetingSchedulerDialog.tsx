import { useMemo, useState, useEffect } from "react";
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
import { invokeApi } from "@/lib/api-invoke";
import { toast } from "sonner";
import {
  MEETING_PROVIDERS,
  MeetingProvider,
  useAddChecklistMeeting,
} from "@/hooks/useChecklistMeetings";
import { Video, Plus, Loader2, X, Mail, Wand2 } from "lucide-react";

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

/**
 * Scheduling a meeting, and nothing else.
 *
 * The meetings themselves are listed on the Meetings tab, so repeating them here only
 * asked which of the two lists was the real one.
 */
export const MeetingSchedulerDialog = ({
  open,
  onOpenChange,
  checklistItemId,
  checklistItemTitle,
  projectId,
  projectName,
}: MeetingSchedulerDialogProps) => {
  const addMeeting = useAddChecklistMeeting();

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

  // A reopened dialog starts on a fresh form, not on the last thing typed.
  useEffect(() => {
    if (open) resetForm();
  }, [open]);

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
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Video className="h-4 w-4 text-muted-foreground" />
            Schedule a meeting
          </DialogTitle>
          <p className="truncate text-xs text-muted-foreground">{checklistItemTitle}</p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-3">
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
                  <Select value={provider} onValueChange={(v) => setProvider(v as MeetingProvider)}>
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
                <Checkbox checked={sendInvite} onCheckedChange={(v) => setSendInvite(v === true)} />
                <Mail className="h-3 w-3" />
                Email the invitation now, with a calendar attachment
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
