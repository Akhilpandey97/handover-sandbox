import { useState } from "react";
import { useProjectJiraTickets, JiraTicket } from "@/hooks/useProjectJiraTickets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Ticket as TicketIcon,
  MessageSquare,
  Paperclip,
  Eye,
  ThumbsUp,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  projectId: string | undefined;
  merchantName?: string;
}

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const statusClasses = (cat: string | null, status: string | null) => {
  const s = (cat || status || "").toLowerCase();
  if (s.includes("done") || s === "done") return "bg-success/15 text-success-strong border-success/30";
  if (s.includes("indeterminate") || s.includes("progress")) return "bg-info/15 text-info-strong border-info/30";
  if (s.includes("block")) return "bg-destructive/15 text-destructive-strong border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
};

const priorityClasses = (p: string | null) => {
  const s = (p || "").toLowerCase();
  if (s.includes("highest") || s.includes("blocker")) return "bg-destructive/15 text-destructive-strong border-destructive/30";
  if (s.includes("high")) return "bg-warning/15 text-warning-strong border-warning/30";
  if (s.includes("medium")) return "bg-warning/15 text-warning-strong border-warning/30";
  if (s.includes("low")) return "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30";
  return "bg-muted text-muted-foreground border-border";
};

const initials = (name: string | null) =>
  (name || "?").split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

const TicketCard = ({ ticket }: { ticket: JiraTicket }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyKey = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ticket.jiraKey);
    setCopied(true);
    toast.success(`Copied ${ticket.jiraKey}`);
    setTimeout(() => setCopied(false), 1500);
  };

  const openInJira = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ticket.url) window.open(ticket.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <Badge variant="outline" className={`font-mono ${statusClasses(ticket.statusCategory, ticket.status)}`}>
              {ticket.jiraKey}
            </Badge>
            <span className="font-medium truncate flex-1">{ticket.summary || "(no summary)"}</span>
            {ticket.status && (
              <Badge variant="outline" className={statusClasses(ticket.statusCategory, ticket.status)}>{ticket.status}</Badge>
            )}
            {ticket.priority && (
              <Badge variant="outline" className={priorityClasses(ticket.priority)}>{ticket.priority}</Badge>
            )}
            {ticket.assigneeName && (
              <div className="flex items-center gap-2 min-w-0">
                <Avatar className="h-6 w-6">
                  {ticket.assigneeAvatar && <AvatarImage src={ticket.assigneeAvatar} />}
                  <AvatarFallback className="text-xs">{initials(ticket.assigneeName)}</AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground truncate max-w-[120px]">{ticket.assigneeName}</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(ticket.updated)}</span>
            {ticket.url && (
              <Button size="icon" variant="ghost" onClick={openInJira} title="Open in Jira">
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 pt-2 border-t space-y-4">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <Field label="Type" value={ticket.issueType} />
              <Field label="Status" value={ticket.status} />
              <Field label="Priority" value={ticket.priority} />
              <Field label="Resolution" value={ticket.resolution} />
              <Field label="Story Points" value={ticket.storyPoints?.toString()} />
              <Field label="Sprint" value={ticket.sprint} />
              <Field label="Project" value={ticket.projectKey ? `${ticket.projectKey}${ticket.projectName ? ` — ${ticket.projectName}` : ""}` : null} />
              <Field label="Epic" value={ticket.epicKey} />
              <Field label="Parent" value={ticket.parentKey} />
              <Field label="Created" value={formatDate(ticket.created)} />
              <Field label="Updated" value={formatDate(ticket.updated)} />
              <Field label="Due Date" value={formatDate(ticket.dueDate)} />
              <Field label="Resolved" value={formatDate(ticket.resolvedAt)} />
            </div>

            {/* People */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <PersonCard label="Assignee" name={ticket.assigneeName} email={ticket.assigneeEmail} avatar={ticket.assigneeAvatar} />
              <PersonCard label="Reporter" name={ticket.reporterName} email={ticket.reporterEmail} avatar={ticket.reporterAvatar} />
              <PersonCard label="Creator" name={ticket.creatorName} email={ticket.creatorEmail} avatar={null} />
            </div>

            {/* Chips */}
            {ticket.labels.length > 0 && <ChipRow label="Labels" items={ticket.labels} />}
            {ticket.components.length > 0 && <ChipRow label="Components" items={ticket.components} />}
            {ticket.fixVersions.length > 0 && <ChipRow label="Fix Versions" items={ticket.fixVersions} />}
            {ticket.affectsVersions.length > 0 && <ChipRow label="Affects Versions" items={ticket.affectsVersions} />}

            {/* Environment */}
            {ticket.environment && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Environment</div>
                <pre className="text-xs bg-muted p-3 rounded font-mono whitespace-pre-wrap break-words">{ticket.environment}</pre>
              </div>
            )}

            {/* Description */}
            {ticket.description && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
                <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-64 overflow-y-auto">
                  {ticket.description}
                </div>
              </div>
            )}

            {/* Counts */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <CountBadge icon={<GitBranch className="h-3.5 w-3.5" />} label="Subtasks" value={ticket.subtaskCount} />
              <CountBadge icon={<MessageSquare className="h-3.5 w-3.5" />} label="Comments" value={ticket.commentCount} />
              <CountBadge icon={<Paperclip className="h-3.5 w-3.5" />} label="Attachments" value={ticket.attachmentCount} />
              <CountBadge icon={<Eye className="h-3.5 w-3.5" />} label="Watchers" value={ticket.watchersCount} />
              <CountBadge icon={<ThumbsUp className="h-3.5 w-3.5" />} label="Votes" value={ticket.votes} />
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-2 pt-2 border-t">
              {ticket.url && (
                <Button onClick={openInJira} className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Open in Jira
                </Button>
              )}
              <Button variant="outline" onClick={copyKey} className="gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {ticket.jiraKey}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="font-medium truncate">{value || "—"}</div>
  </div>
);

const PersonCard = ({ label, name, email, avatar }: { label: string; name: string | null; email: string | null; avatar: string | null }) => (
  <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
    <Avatar className="h-8 w-8 mt-0.5">
      {avatar && <AvatarImage src={avatar} />}
      <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
    <div className="min-w-0 flex-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{name || "—"}</div>
      {email && <div className="text-xs text-muted-foreground truncate">{email}</div>}
    </div>
  </div>
);

const ChipRow = ({ label, items }: { label: string; items: string[] }) => (
  <div>
    <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <Badge key={it} variant="secondary" className="font-normal">{it}</Badge>
      ))}
    </div>
  </div>
);

const CountBadge = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="flex items-center gap-1.5">
    {icon}
    <span>{label}: <span className="font-medium text-foreground">{value}</span></span>
  </div>
);

const CreateTicketButton = ({
  merchantName,
}: {
  merchantName?: string;
}) => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!currentUser?.tenantId) {
      toast.error("Tenant not available");
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/public/jira-create-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tenant_id: currentUser.tenantId,
          merchant_name: merchantName,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not open Jira");
      if (body.url) window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      size="sm"
      className="h-9 gap-2 rounded-md bg-navy px-3 text-sm font-semibold text-navy-foreground hover:bg-navy/90"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      Create ticket
    </Button>
  );
};

export const JiraTicketsSection = ({ projectId, merchantName }: Props) => {
  const { tickets, isLoading, isRefreshing, refreshTickets } = useProjectJiraTickets(projectId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TicketIcon className="h-5 w-5 text-primary" />
          <h3 className="heading-section">Jira Tickets</h3>
          <Badge variant="secondary">{tickets.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refreshTickets} disabled={isRefreshing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <CreateTicketButton merchantName={merchantName} />
        </div>
      </div>

      {isLoading && tickets.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded">
          No Jira tickets found{merchantName ? ` for ${merchantName}` : ""}. Click <strong>Refresh</strong> to search Jira.
        </div>
      ) : (
        <div className={`space-y-2 ${tickets.length > 5 ? "max-h-[420px] overflow-y-auto pr-2" : ""}`}>
          {tickets.map((t) => <TicketCard key={t.id} ticket={t} />)}
        </div>
      )}
    </div>
  );
};

export default JiraTicketsSection;
