import { useMemo, useState } from "react";
import { Project } from "@/data/projectsData";
import { useChecklistMeetings } from "@/hooks/useChecklistMeetings";
import { MeetingSchedulerDialog } from "@/components/MeetingSchedulerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarDays, ExternalLink, FileText, Search, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const shortDateTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-info/10 text-info-strong",
  completed: "bg-success/15 text-success-strong",
  cancelled: "bg-muted text-muted-foreground",
};

export const WorkspaceMeetingsPanel = ({ project }: { project: Project }) => {
  const { data: meetings = [], isLoading } = useChecklistMeetings(project.id);
  const [dialog, setDialog] = useState<{ checklistItemId: string; checklistItemTitle: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const [search, setSearch] = useState("");

  const itemTitle = useMemo(() => {
    const map = new Map<string, string>();
    project.checklist.forEach((item) => map.set(item.id, item.title));
    return map;
  }, [project.checklist]);

  const now = Date.now();
  const upcomingCount = meetings.filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now).length;
  const pastCount = meetings.length - upcomingCount;

  const filtered = useMemo(() => {
    let result = meetings;
    if (filter === "upcoming") result = result.filter((m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now);
    else if (filter === "past") result = result.filter((m) => !(m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= now));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((m) => m.title.toLowerCase().includes(q));
    }
    return result.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }, [meetings, filter, search, now]);

  const firstChecklistItem = project.checklist[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-border/50 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Meetings</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{meetings.length} total</span>
              {upcomingCount > 0 && (
                <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info-strong">{upcomingCount} upcoming</span>
              )}
              {pastCount > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{pastCount} past</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search meetings..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-0 border rounded-lg overflow-hidden">
              {(["all", "upcoming", "past"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                    filter === f ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            {firstChecklistItem && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setDialog({ checklistItemId: firstChecklistItem.id, checklistItemTitle: firstChecklistItem.title })}
              >
                <Video className="h-3 w-3" />Schedule
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">Loading meetings…</p>
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Video className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No meetings yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Schedule a meeting from a checklist step and the join link is created for you
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">No meetings match the current filter</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-background">
              <tr className="border-b border-border/50">
                <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground">Meeting</th>
                <th className="w-40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date &amp; Time</th>
                <th className="w-20 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Duration</th>
                <th className="w-28 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Attendees</th>
                <th className="w-40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Checklist step</th>
                <th className="w-24 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="w-20 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((meeting) => {
                const isUpcoming = meeting.status === "scheduled" && new Date(meeting.scheduled_at).getTime() >= now;
                return (
                  <tr
                    key={meeting.id}
                    className="border-b border-border/20 transition-colors hover:bg-muted/10"
                  >
                    <td className="px-5 py-2.5 align-middle">
                      <div className="flex items-center gap-2">
                        <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">{meeting.title}</span>
                        {meeting.transcript && <span title="Transcript available"><FileText className="h-3 w-3 shrink-0 text-muted-foreground" /></span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3 shrink-0" />
                        {shortDateTime(meeting.scheduled_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-xs text-muted-foreground">
                      {meeting.duration_minutes}m
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      {meeting.attendees?.length ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3 shrink-0" />
                          {meeting.attendees.length}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="truncate text-xs text-muted-foreground" title={itemTitle.get(meeting.checklist_item_id)}>
                        {itemTitle.get(meeting.checklist_item_id) || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[meeting.status] || STATUS_TONE.scheduled)}>
                        {STATUS_LABEL[meeting.status] || meeting.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      {meeting.join_url ? (
                        <a
                          href={meeting.join_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Join <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>

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
