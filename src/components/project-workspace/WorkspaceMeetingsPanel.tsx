import { useMemo, useState } from "react";
import { Project } from "@/data/projectsData";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, ExternalLink, FileText, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusTone: Record<string, string> = {
  scheduled: "border-info/30 bg-info-soft text-info-strong",
  completed: "border-success/30 bg-success-soft text-success-strong",
  cancelled: "border-border bg-muted text-muted-foreground",
};

/**
 * Every meeting on the project, upcoming first.
 *
 * Meetings are attached to a checklist step, so each row says which one — and whether a
 * transcript has arrived, since that is what Meeting AI needs before it can write minutes.
 */
export const WorkspaceMeetingsPanel = ({ project }: { project: Project }) => {
  const { data: meetings = [], isLoading } = useChecklistMeetings(project.id);
  const [dialog, setDialog] = useState<{ checklistItemId: string; checklistItemTitle: string } | null>(null);

  const itemTitle = useMemo(() => {
    const map = new Map<string, string>();
    project.checklist.forEach((item) => map.set(item.id, item.title));
    return map;
  }, [project.checklist]);

  const now = Date.now();
  const upcoming = meetings
    .filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const past = meetings
    .filter((m) => !(m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now))
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading meetings…</p>;

  const Row = ({ meeting }: { meeting: (typeof meetings)[number] }) => (
    <div className="flex items-start gap-3 rounded-md border border-border/50 bg-card px-3 py-2">
      <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{meeting.title}</span>
          <Badge variant="outline" className={cn("px-1.5 py-0 text-2xs", statusTone[meeting.status])}>
            {meeting.status}
          </Badge>
          {meeting.transcript ? (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <FileText className="h-2.5 w-2.5" />
              transcript
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {when(meeting.scheduled_at)} · {meeting.duration_minutes}m
          </span>
          {meeting.attendees?.length ? (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {meeting.attendees.length} invited
            </span>
          ) : null}
          <span className="truncate">{itemTitle.get(meeting.checklist_item_id) || "Checklist step"}</span>
        </div>
      </div>
      {meeting.join_url ? (
        <a
          href={meeting.join_url}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
        >
          Join
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Meetings</h2>
        <span className="text-xs text-muted-foreground">
          {upcoming.length} upcoming · {meetings.length} in total
        </span>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-6 text-center">
          <Video className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No meetings yet. Schedule one from a checklist step and the join link is created for you.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-1">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</p>
              {upcoming.map((m) => (
                <Row key={m.id} meeting={m} />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-1">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past</p>
              {past.map((m) => (
                <Row key={m.id} meeting={m} />
              ))}
            </section>
          )}
        </>
      )}

      {dialog && (
        <MeetingSchedulerDialog
          open={true}
          onOpenChange={(open) => !open && setDialog(null)}
          checklistItemId={dialog.checklistItemId}
          checklistItemTitle={dialog.checklistItemTitle}
          projectId={project.id}
          projectName={project.merchantName}
        />
      )}
    </div>
  );
};
