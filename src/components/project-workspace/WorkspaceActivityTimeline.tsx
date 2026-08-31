import { useMemo } from "react";
import {
  Project,
  projectStateLabels,
} from "@/data/projectsData";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLabels } from "@/contexts/LabelsContext";
import { hexToRgba } from "@/utils/colorUtils";
import {
  Activity,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";

type ActivityEntryKind = "system" | "user" | "handoff" | "milestone";

interface ActivityEntry {
  id: string;
  kind: ActivityEntryKind;
  title: string;
  source: string;
  description?: string;
  actor?: string;
  timestamp: number;
  timestampLabel: string;
}

interface WorkspaceActivityTimelineProps {
  project: Project;
}

const formatTimestamp = (value?: string) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    timestamp: date.getTime(),
    label: new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  };
};

export const WorkspaceActivityTimeline = ({ project }: WorkspaceActivityTimelineProps) => {
  const { labels, teamLabels, phaseLabels, responsibilityLabels, stateLabels } = useLabels();
  const metricBackground = labels.color_workspace_metric_bg || "#ffffff";
  const metricBorder = labels.color_workspace_metric_border || "#dce4ee";
  const sectionBorder = labels.color_workspace_section_border || "#dbe5ef";

  const events = useMemo(() => {
    const timeline: ActivityEntry[] = [];

    const addEvent = (entry: Omit<ActivityEntry, "timestamp" | "timestampLabel"> & { date?: string }) => {
      const parsed = formatTimestamp(entry.date);
      if (!parsed) return;

      timeline.push({
        ...entry,
        timestamp: parsed.timestamp,
        timestampLabel: parsed.label,
      });
    };

    addEvent({
      id: `${project.id}-kickoff`,
      kind: "milestone",
      title: "Kickoff scheduled",
      source: "Project milestone",
      description: `Project workspace opened for ${project.merchantName}.`,
      actor: "System",
      date: project.dates.kickOffDate,
    });

    addEvent({
      id: `${project.id}-expected-live`,
      kind: "milestone",
      title: "Expected go-live target set",
      source: "Project milestone",
      description: `Target state: ${stateLabels[project.projectState] || projectStateLabels[project.projectState]}.`,
      actor: "System",
      date: project.dates.expectedGoLiveDate,
    });

    addEvent({
      id: `${project.id}-live`,
      kind: "milestone",
      title: "Project marked live",
      source: "Lifecycle milestone",
      description: "Merchant went live successfully.",
      actor: "System",
      date: project.dates.goLiveDate,
    });

    project.transferHistory.forEach((transfer) => {
      if (transfer.notes?.startsWith("OWNER_CHANGE:")) {
        const ownerName = transfer.notes.replace("OWNER_CHANGE:", "").trim() || "Unassigned";
        addEvent({
          id: `owner-change-${transfer.id}`,
          kind: "user",
          title: `Owner changed to ${ownerName}`,
          source: "Owner assignment",
          description: `Ownership assignment updated for ${project.merchantName}.`,
          actor: transfer.transferredBy,
          date: transfer.transferredAt,
        });
        return;
      }

      addEvent({
        id: `transfer-${transfer.id}`,
        kind: "handoff",
        title: `Transferred from ${teamLabels[transfer.fromTeam] || transfer.fromTeam} to ${teamLabels[transfer.toTeam] || transfer.toTeam}`,
        source: "Team handoff",
        description: transfer.notes || "Project ownership moved to the next operational team.",
        actor: transfer.transferredBy,
        date: transfer.transferredAt,
      });

      addEvent({
        id: `transfer-accepted-${transfer.id}`,
        kind: "user",
        title: `Transfer accepted by ${transfer.acceptedBy || teamLabels[transfer.toTeam] || transfer.toTeam}`,
        source: "Team handoff",
        description: `Project is now active with ${teamLabels[transfer.toTeam] || transfer.toTeam}.`,
        actor: transfer.acceptedBy,
        date: transfer.acceptedAt,
      });
    });

    project.responsibilityLog.forEach((log) => {
      addEvent({
        id: `project-responsibility-start-${log.id}`,
        kind: "system",
        title: `${responsibilityLabels[log.party] || log.party} responsibility started`,
        source: `${phaseLabels[log.phase] || log.phase} phase`,
        description: `Project-level execution moved to ${responsibilityLabels[log.party] || log.party}.`,
        actor: "System",
        date: log.startedAt,
      });

      addEvent({
        id: `project-responsibility-end-${log.id}`,
        kind: "system",
        title: `${responsibilityLabels[log.party] || log.party} responsibility closed`,
        source: `${phaseLabels[log.phase] || log.phase} phase`,
        description: "A new responsibility owner or execution state replaced this window.",
        actor: "System",
        date: log.endedAt,
      });
    });

    project.checklist.forEach((item) => {
      addEvent({
        id: `checklist-complete-${item.id}`,
        kind: "user",
        title: `${item.title} completed`,
        source: `${teamLabels[item.ownerTeam] || item.ownerTeam} checklist`,
        description: `Responsibility at completion: ${responsibilityLabels[item.currentResponsibility] || item.currentResponsibility}.`,
        actor: item.completedBy,
        date: item.completedAt,
      });

      addEvent({
        id: `checklist-comment-${item.id}`,
        kind: "user",
        title: `Comment added on ${item.title}`,
        source: `${teamLabels[item.ownerTeam] || item.ownerTeam} checklist`,
        description: item.comment,
        actor: item.commentBy,
        date: item.commentAt,
      });

      item.responsibilityLog.forEach((log) => {
        addEvent({
          id: `checklist-responsibility-start-${log.id}`,
          kind: "system",
          title: `${item.title} moved to ${responsibilityLabels[log.party] || log.party}`,
          source: `${teamLabels[item.ownerTeam] || item.ownerTeam} execution`,
          description: "Checklist responsibility changed for this task.",
          actor: "System",
          date: log.startedAt,
        });

        addEvent({
          id: `checklist-responsibility-end-${log.id}`,
          kind: "system",
          title: `${item.title} responsibility window closed`,
          source: `${teamLabels[item.ownerTeam] || item.ownerTeam} execution`,
          description: `Previous owner: ${responsibilityLabels[log.party] || log.party}.`,
          actor: "System",
          date: log.endedAt,
        });
      });
    });

    return timeline.sort((a, b) => b.timestamp - a.timestamp);
  }, [project, teamLabels, phaseLabels, responsibilityLabels, stateLabels]);

  const userEvents = events.filter((event) => event.kind === "user").length;
  const systemEvents = events.filter((event) => event.kind === "system").length;

  const getIcon = (kind: ActivityEntryKind) => {
    switch (kind) {
      case "handoff":
        return <ArrowRightLeft className="h-4 w-4" />;
      case "milestone":
        return <CalendarClock className="h-4 w-4" />;
      case "user":
        return <CheckCircle2 className="h-4 w-4" />;
      case "system":
      default:
        return <ShieldCheck className="h-4 w-4" />;
    }
  };

  const getKindLabel = (kind: ActivityEntryKind) => {
    switch (kind) {
      case "handoff":
        return "Handoff";
      case "milestone":
        return "Milestone";
      case "user":
        return "User";
      case "system":
      default:
        return "System";
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex flex-wrap items-center gap-2 px-6 py-4"
        style={{ borderBottom: `1px solid ${hexToRgba(sectionBorder, 0.5)}` }}
      >
        <Badge variant="secondary" className="px-3 py-1 text-xs font-semibold">
          <Activity className="mr-1 h-3.5 w-3.5" />
          {events.length} events
        </Badge>
        <Badge variant="outline" className="px-3 py-1 text-xs font-semibold">
          {userEvents} user actions
        </Badge>
        <Badge variant="outline" className="px-3 py-1 text-xs font-semibold">
          {systemEvents} system updates
        </Badge>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
          <div className="max-w-sm space-y-2">
            <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">No activity has been captured yet.</p>
            <p className="text-sm leading-6 text-muted-foreground">
              User actions, handoffs, checklist progress, and system milestones will appear here automatically.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="h-[720px]">
          <div className="p-6">
            {events.slice(0, 24).map((event, index) => (
              <div key={event.id} className="relative pl-16">
                {index < Math.min(events.length, 24) - 1 ? (
                  <div
                    className="absolute left-[21px] top-12 w-px"
                    style={{
                      bottom: "-8px",
                      backgroundColor: hexToRgba(sectionBorder, 0.58),
                    }}
                  />
                ) : null}

                <div
                  className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-2xl text-primary"
                  style={{
                    backgroundColor: hexToRgba(metricBorder, 0.08),
                    border: `1px solid ${hexToRgba(metricBorder, 0.58)}`,
                  }}
                >
                  {getIcon(event.kind)}
                </div>

                <div
                  className="mb-4 rounded-[1.5rem] p-4"
                  style={{
                    backgroundColor: hexToRgba(metricBackground, 0.96),
                    border: `1px solid ${hexToRgba(metricBorder, 0.78)}`,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold tracking-[-0.02em] text-foreground">{event.title}</p>
                        <Badge variant={event.kind === "user" ? "secondary" : "outline"} className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                          {getKindLabel(event.kind)}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{event.source}</p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-muted-foreground">{event.timestampLabel}</p>
                      <p className="mt-1 text-xs font-semibold text-foreground">{event.actor || "System"}</p>
                    </div>
                  </div>

                  {event.description ? (
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{event.description}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};