import { useState, useMemo } from "react";
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

interface ProjectActivityHistoryPanelProps {
  projectId: string;
  /** Height of the scrollable area, defaults to a comfortable inline height */
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
  { key: "portal", label: "Portal Visits" },
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
    case "project": return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "checklist": return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    case "transfer": return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    case "comment": return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "risk": return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    case "email": return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300";
    case "jira": return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300";
    case "portal": return "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300";
    default: return "bg-muted text-muted-foreground";
  }
};

const getTimelineColor = (category: string) => {
  switch (category) {
    case "project": return "bg-blue-500";
    case "checklist": return "bg-green-500";
    case "transfer": return "bg-purple-500";
    case "comment": return "bg-amber-500";
    case "risk": return "bg-red-500";
    case "email": return "bg-cyan-500";
    case "jira": return "bg-indigo-500";
    case "portal": return "bg-teal-500";
    default: return "bg-muted-foreground";
  }
};

export const ProjectActivityHistoryPanel = ({
  projectId,
  height = "calc(100vh - 320px)",
}: ProjectActivityHistoryPanelProps) => {
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
    <div className="flex flex-col rounded-xl border border-border/60 bg-card/80 overflow-hidden">
      <div className="px-4 pt-3 pb-3 border-b border-border/60 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 h-11 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={activeFilter === f.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
              {f.key !== "all" && (
                <span className="ml-1 opacity-60">
                  {entries.filter((e) => e.category === f.key).length}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="px-4 py-3" style={{ height }}>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No activity found</p>
            <p className="text-xs mt-1">
              {activeFilter !== "all" ? "Try a different filter" : "Activity will appear here as changes are made"}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([dateKey, items]) => (
              <div key={dateKey}>
                <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm pb-2 mb-2.5">
                  <p className="text-[11px] font-semibold text-muted-foreground tracking-normal">
                    {format(new Date(dateKey), "EEEE, MMM d, yyyy")}
                  </p>
                </div>

                <div className="relative pl-6">
                  <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

                  <div className="space-y-3">
                    {items.map((entry) => {
                      const Icon = getCategoryIcon(entry.category);
                      return (
                        <div key={entry.id} className="relative flex gap-3">
                          <div
                            className={`absolute -left-6 top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-background ${getTimelineColor(entry.category)}`}
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-2">
                              <div className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${getCategoryColor(entry.category)}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className="text-sm leading-snug text-foreground break-words">
                                  {entry.description}
                                </p>

                                {entry.metadata?.changes && Array.isArray(entry.metadata.changes) && entry.metadata.changes.length > 0 && (
                                  <div className="mt-1.5 space-y-0.5">
                                    {entry.metadata.changes.map((c: { field: string; from: string; to: string }, ci: number) => (
                                      <div key={ci} className="flex items-center gap-1.5 text-[11px]">
                                        <span className="font-medium text-muted-foreground">{c.field}:</span>
                                        {c.from && (
                                          <span className="line-through text-red-500/70 max-w-[120px] truncate" title={c.from}>
                                            {c.from}
                                          </span>
                                        )}
                                        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                                        <span className="text-green-600 dark:text-green-400 max-w-[200px] truncate" title={c.to}>
                                          {c.to || "—"}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {entry.userName && (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                      <User className="h-3 w-3" />
                                      {entry.userName}
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(entry.timestamp), "h:mm a")}
                                    <span className="opacity-60">
                                      ({formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })})
                                    </span>
                                  </span>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 capitalize">
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
      </ScrollArea>
    </div>
  );
};
