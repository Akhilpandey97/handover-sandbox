import { useState, useMemo } from "react";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjectActivityHistory, ActivityEntry } from "@/hooks/useProjectActivityHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Activity,
  ArrowRight,
  ArrowLeftRight,
  CheckSquare,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Search,
  ShieldAlert,
  Ticket,
  User,
  Globe,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

interface ProjectActivityHistoryPanelProps {
  projectId: string;
  height?: string;
}

const CATEGORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "project", label: "Project" },
  { key: "checklist", label: "Checklist" },
  { key: "transfer", label: "Transfer" },
  { key: "comment", label: "Comments" },
  { key: "risk", label: "Risks" },
  { key: "email", label: "Emails" },
  { key: "jira", label: "Jira" },
  { key: "portal", label: "Portal" },
];

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "project": return FileText;
    case "checklist": return CheckSquare;
    case "transfer": return ArrowLeftRight;
    case "comment": return MessageSquare;
    case "risk": return ShieldAlert;
    case "email": return Mail;
    case "jira": return Ticket;
    case "portal": return Globe;
    default: return Activity;
  }
};

const getCategoryColor = (category: string) => {
  switch (category) {
    case "project": return "bg-info/10 text-info-strong";
    case "checklist": return "bg-success/15 text-success-strong";
    case "transfer": return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    case "comment": return "bg-warning/15 text-warning-strong";
    case "risk": return "bg-destructive/10 text-destructive-strong";
    case "email": return "bg-info/10 text-info-strong";
    case "jira": return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300";
    case "portal": return "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300";
    default: return "bg-muted text-muted-foreground";
  }
};

const getTimelineColor = (category: string) => {
  switch (category) {
    case "project": return "bg-info";
    case "checklist": return "bg-success";
    case "transfer": return "bg-purple-500";
    case "comment": return "bg-warning";
    case "risk": return "bg-destructive";
    case "email": return "bg-info";
    case "jira": return "bg-indigo-500";
    case "portal": return "bg-teal-500";
    default: return "bg-muted-foreground";
  }
};

const withTeamNames = (text: string, teamLabels: Record<string, string>) =>
  text.replace(/\(([a-z_]+)\)$/, (whole, slug) => (teamLabels[slug] ? `(${teamLabels[slug]})` : whole));

export const ProjectActivityHistoryPanel = ({
  projectId,
  height,
}: ProjectActivityHistoryPanelProps) => {
  const { teamLabels } = useLabels();
  const { data: entries = [], isLoading } = useProjectActivityHistory(projectId);
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = entries;
    if (activeFilter !== "all") {
      result = result.filter((e) => e.category === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          (e.userName || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [entries, activeFilter, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, ActivityEntry[]> = {};
    for (const entry of filtered) {
      const dateKey = format(new Date(entry.timestamp), "yyyy-MM-dd");
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-border/50 px-5 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Activity</h2>
            <span className="text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5 font-medium">
              {entries.length} events
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search activity..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {CATEGORY_FILTERS.map((f) => {
            const count = f.key === "all" ? entries.length : entries.filter((e) => e.category === f.key).length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  activeFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50",
                )}
              >
                {f.label}
                {count > 0 && (
                  <span className={cn("text-2xs tabular-nums", activeFilter === f.key ? "opacity-80" : "opacity-50")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Activity className="mb-3 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No activity found</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {activeFilter !== "all" ? "Try a different filter" : "Activity will appear here as changes are made"}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([dateKey, items]) => (
                <div key={dateKey}>
                  <div className="sticky top-0 z-10 bg-white/95 dark:bg-background/95 backdrop-blur-sm pb-2 mb-2">
                    <p className="text-2xs font-semibold text-muted-foreground tracking-normal">
                      {format(new Date(dateKey), "EEEE, MMM d, yyyy")}
                    </p>
                  </div>

                  <div className="relative pl-6">
                    <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />

                    <div className="space-y-3">
                      {items.map((entry) => {
                        const Icon = getCategoryIcon(entry.category);
                        return (
                          <div key={entry.id} className="relative flex gap-3">
                            <div
                              className={`absolute -left-6 top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-white dark:ring-background ${getTimelineColor(entry.category)}`}
                            />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2">
                                <div className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${getCategoryColor(entry.category)}`}>
                                  <Icon className="h-3.5 w-3.5" />
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className="text-sm leading-snug text-foreground break-words">
                                    {withTeamNames(entry.description, teamLabels)}
                                  </p>

                                  {entry.metadata?.changes && Array.isArray(entry.metadata.changes) && entry.metadata.changes.length > 0 && (
                                    <div className="mt-1.5 space-y-0.5">
                                      {entry.metadata.changes.map((c: { field: string; from: string; to: string }, ci: number) => (
                                        <div key={ci} className="flex items-center gap-1.5 text-2xs">
                                          <span className="font-medium text-muted-foreground">{c.field}:</span>
                                          {c.from && (
                                            <span className="line-through text-destructive-strong/70 max-w-[120px] truncate" title={c.from}>
                                              {c.from}
                                            </span>
                                          )}
                                          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                                          <span className="text-success-strong max-w-[200px] truncate" title={c.to}>
                                            {c.to || "—"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {entry.userName && (
                                      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                                        <User className="h-3 w-3" />
                                        {entry.userName}
                                      </span>
                                    )}
                                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {format(new Date(entry.timestamp), "h:mm a")}
                                      <span className="opacity-60">
                                        ({formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })})
                                      </span>
                                    </span>
                                    <Badge variant="outline" className="text-2xs px-1.5 py-0 h-4 capitalize">
                                      {entry.category}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
