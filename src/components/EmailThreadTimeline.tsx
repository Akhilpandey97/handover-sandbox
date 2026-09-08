import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Mail } from "lucide-react";
import { ProjectEmailThread, ProjectEmailMessage } from "@/hooks/useProjectEmails";
import { cn } from "@/lib/utils";

const INTERNAL_DOMAIN = "@gokwik.co";

const isInternal = (from: string) => from.toLowerCase().includes(INTERNAL_DOMAIN);

const cleanFrom = (from: string) => {
  // "Name <email@x.com>" -> "Name" or just email
  const match = from.match(/^(.*?)\s*<(.+)>$/);
  if (match) return match[1].trim() || match[2].trim();
  return from.trim();
};

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const MessageBubble = ({ msg }: { msg: ProjectEmailMessage }) => {
  const internal = isInternal(msg.from);
  const sender = cleanFrom(msg.from);
  const bodyText = msg.body_text?.trim() || stripHtml(msg.body_html || "") || msg.snippet;

  // Strip quoted reply chains (lines starting with >)
  const cleanBody = bodyText
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    .replace(/On .+ wrote:[\s\S]*$/i, "")
    .trim();

  let dateLabel = "";
  try {
    dateLabel = format(new Date(msg.date), "dd MMM yyyy, HH:mm");
  } catch {
    dateLabel = msg.date;
  }

  return (
    <div className={cn("flex w-full", internal ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-2 shadow-sm border",
          internal
            ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 rounded-tr-sm"
            : "bg-card border-border rounded-tl-sm"
        )}
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xs font-semibold text-foreground truncate">{sender}</span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{dateLabel}</span>
        </div>
        <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
          {cleanBody || "(empty message)"}
        </pre>
      </div>
    </div>
  );
};

export const EmailThreadTimeline = ({ thread }: { thread: ProjectEmailThread }) => {
  const [expanded, setExpanded] = useState(false);

  const hasBodies = thread.messages && thread.messages.length > 0;

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/60 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium truncate">{thread.subject}</p>
          {thread.snippet && !expanded && (
            <p className="text-xs text-muted-foreground line-clamp-1">{thread.snippet}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {format(new Date(thread.threadDate), "dd MMM yyyy, HH:mm")} · {thread.messageCount} message
              {thread.messageCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-muted-foreground truncate text-right">
              {thread.participants.slice(0, 2).map(cleanFrom).join(", ")}
              {thread.participants.length > 2 && ` +${thread.participants.length - 2}`}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-[hsl(var(--muted))]/40 px-3 py-3 space-y-2 max-h-[500px] overflow-y-auto">
          {!hasBodies && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
              <Mail className="h-3 w-3" />
              No message bodies cached. Click Refresh to fetch full conversation.
            </div>
          )}
          {hasBodies &&
            thread.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
        </div>
      )}
    </div>
  );
};
