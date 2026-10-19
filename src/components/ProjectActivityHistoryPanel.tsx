import { useState, useMemo } from "react";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjectActivityHistory, ActivityEntry } from "@/hooks/useProjectActivityHistory";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Activity,
  ArrowRight,
  ArrowLeftRight,
  CheckSquare,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  Paperclip,
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

const MetadataDetails = ({ entry }: { entry: ActivityEntry }) => {
  const meta = entry.metadata;
  if (!meta) return null;

  const parts: React.ReactNode[] = [];

  if (meta.changes && Array.isArray(meta.changes) && meta.changes.length > 0) {
    parts.push(
      <div key="changes" className="mt-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
        <p className="text-2xs font-semibold text-muted-foreground mb-1">Changes</p>
        <div className="space-y-0.5">
          {meta.changes.map((c: { field: string; from: string; to: string }, ci: number) => (
            <div key={ci} className="flex items-center gap-1.5 text-xs">
              <span className="font-medium text-foreground/80 min-w-[80px]">{c.field}:</span>
              {c.from && (
                <span className="line-through text-destructive/70 max-w-[200px] truncate" title={c.from}>
                  {c.from}
                </span>
              )}
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span className="text-success-strong max-w-[300px] truncate" title={c.to}>
                {c.to || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (meta.notes || meta.note) {
    parts.push(
      <div key="notes" className="mt-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
        <p className="text-2xs font-semibold text-muted-foreground mb-0.5">Notes</p>
        <p className="text-xs text-foreground/80 whitespace-pre-line">{meta.notes || meta.note}</p>
      </div>
    );
  }

  if (meta.reason) {
    parts.push(
      <div key="reason" className="mt-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
        <p className="text-2xs font-semibold text-muted-foreground mb-0.5">Reason</p>
        <p className="text-xs text-foreground/80">{meta.reason}</p>
      </div>
    );
  }

  if (meta.comment || meta.body || meta.content || meta.message) {
    const text = meta.comment || meta.body || meta.content || meta.message;
    parts.push(
      <div key="comment" className="mt-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
        <p className="text-xs text-foreground/80 whitespace-pre-line">{text}</p>
      </div>
    );
  }

  if (meta.attachment) {
    parts.push(
      <a key="attachment" href={meta.attachment} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
        <Paperclip className="h-3 w-3" />Attachment
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    );
  }

  if (meta.page && entry.source === "portal_visit") {
    parts.push(
      <div key="portal" className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Page: <span className="font-medium text-foreground/80">{meta.page}</span></span>
        {meta.sessionId && <span>Session: <span className="font-mono text-foreground/60">{String(meta.sessionId).slice(0, 8)}…</span></span>}
      </div>
    );
  }

  if (meta.from_team || meta.to_team) {
    parts.push(
      <div key="transfer" className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {meta.from_team && <span>From: <span className="font-medium text-foreground/80">{meta.from_team}</span></span>}
        {meta.from_team && meta.to_team && <ArrowRight className="h-3 w-3" />}
        {meta.to_team && <span>To: <span className="font-medium text-foreground/80">{meta.to_team}</span></span>}
      </div>
    );
  }

  if (meta.assignee || meta.assigned_to) {
    parts.push(
      <div key="assignee" className="mt-1 text-xs text-muted-foreground">
        Assigned to: <span className="font-medium text-foreground/80">{meta.assignee || meta.assigned_to}</span>
      </div>
    );
  }

  if (meta.jira_key || meta.ticket_key) {
    parts.push(
      <div key="jira" className="mt-1 text-xs text-muted-foreground">
        Ticket: <span className="font-mono font-medium text-foreground/80">{meta.jira_key || meta.ticket_key}</span>
        {meta.jira_url && (
          <a href={meta.jira_url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-primary hover:underline">
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    );
  }

  const renderedKnownKeys = new Set([
    "changes", "notes", "note", "reason", "comment", "body", "content", "message",
    "attachment", "page", "sessionId", "from_team", "to_team", "assignee", "assigned_to",
    "jira_key", "ticket_key", "jira_url",
  ]);
  const extraKeys = Object.keys(meta).filter((k) => !renderedKnownKeys.has(k) && meta[k] != null && meta[k] !== "");
  if (extraKeys.length > 0) {
    parts.push(
      <div key="extra" className="mt-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 space-y-0.5">
        {extraKeys.map((k) => (
          <div key={k} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">{k}:</span>{" "}
            <span className="text-foreground/80">{typeof meta[k] === "object" ? JSON.stringify(meta[k]) : String(meta[k])}</span>
          </div>
        ))}
      </div>
    );
  }

  return parts.length > 0 ? <>{parts}</> : null;
};

export const ProjectActivityHistoryPanel = ({
  projectId,
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

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [entries]);

  const recentUsers = useMemo(() => {
    const seen = new Set<string>();
    const users: string[] = [];
    for (const e of entries) {
      if (e.userName && !seen.has(e.userName)) {
        seen.add(e.userName);
        users.push(e.userName);
      }
      if (users.length >= 10) break;
    }
    return users;
  }, [entries]);

  const todayCount = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return entries.filter((e) => format(new Date(e.timestamp), "yyyy-MM-dd") === today).length;
  }, [entries]);

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-background">
      {/* ── Left: Timeline ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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

        {/* Timeline content */}
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
                        <span className="ml-2 text-muted-foreground/50 font-normal">{items.length} events</span>
                      </p>
                    </div>

                    <div className="relative pl-6">
                      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />

                      <div className="space-y-4">
                        {items.map((entry) => {
                          const Icon = getCategoryIcon(entry.category);
                          return (
                            <div key={entry.id} className="relative flex gap-3">
                              <div
                                className={`absolute -left-6 top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-white dark:ring-background ${getTimelineColor(entry.category)}`}
                              />

                              <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-2.5">
                                  <div className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${getCategoryColor(entry.category)}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm leading-snug text-foreground break-words">
                                      {withTeamNames(entry.description, teamLabels)}
                                    </p>

                                    <MetadataDetails entry={entry} />

                                    <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
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
                                      <span className="text-2xs text-muted-foreground/40 capitalize">{entry.source.replace(/_/g, " ")}</span>
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

      {/* ── Right: Summary sidebar ──────────────────────────── */}
      <div className="w-64 shrink-0 border-l border-border/50 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5">
            {/* Quick stats */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-2.5">Summary</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/50 p-2.5 text-center">
                  <p className="text-lg font-semibold text-foreground tabular-nums">{entries.length}</p>
                  <p className="text-2xs text-muted-foreground">Total events</p>
                </div>
                <div className="rounded-lg border border-border/50 p-2.5 text-center">
                  <p className="text-lg font-semibold text-foreground tabular-nums">{todayCount}</p>
                  <p className="text-2xs text-muted-foreground">Today</p>
                </div>
                <div className="rounded-lg border border-border/50 p-2.5 text-center">
                  <p className="text-lg font-semibold text-foreground tabular-nums">{grouped.length}</p>
                  <p className="text-2xs text-muted-foreground">Active days</p>
                </div>
                <div className="rounded-lg border border-border/50 p-2.5 text-center">
                  <p className="text-lg font-semibold text-foreground tabular-nums">{recentUsers.length}</p>
                  <p className="text-2xs text-muted-foreground">Contributors</p>
                </div>
              </div>
            </div>

            {/* Activity breakdown */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-2.5">Breakdown</h3>
              <div className="space-y-1.5">
                {CATEGORY_FILTERS.filter((f) => f.key !== "all").map((f) => {
                  const count = categoryCounts[f.key] || 0;
                  const pct = entries.length > 0 ? Math.round((count / entries.length) * 100) : 0;
                  const Icon = getCategoryIcon(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setActiveFilter(activeFilter === f.key ? "all" : f.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        activeFilter === f.key ? "bg-primary/10" : "hover:bg-muted/40",
                      )}
                    >
                      <div className={`shrink-0 h-5 w-5 rounded flex items-center justify-center ${getCategoryColor(f.key)}`}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <span className="flex-1 text-xs font-medium text-foreground">{f.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recent contributors */}
            {recentUsers.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-foreground mb-2.5">Contributors</h3>
                <div className="space-y-1.5">
                  {recentUsers.map((name) => {
                    const userCount = entries.filter((e) => e.userName === name).length;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { setSearch(name); setActiveFilter("all"); }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                          {name.charAt(0).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate text-xs font-medium text-foreground text-left">{name}</span>
                        <span className="text-2xs tabular-nums text-muted-foreground">{userCount}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent days distribution */}
            {grouped.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-foreground mb-2.5">Recent days</h3>
                <div className="space-y-1">
                  {grouped.slice(0, 7).map(([dateKey, items]) => (
                    <div key={dateKey} className="flex items-center gap-2 text-xs">
                      <span className="w-16 shrink-0 text-muted-foreground truncate">{format(new Date(dateKey), "MMM d")}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${Math.min((items.length / Math.max(...grouped.map(([, i]) => i.length))) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="w-6 text-right tabular-nums text-muted-foreground">{items.length}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
