import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, FileSpreadsheet, Loader2, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ActionCard } from "./ActionCard";
import { BuddyAvatar } from "./BuddyAvatar";
import { Markdown } from "./Markdown";
import { ReportCard } from "./ReportCard";
import type { BuddyMessage } from "./types";

interface Props {
  message: BuddyMessage;
  isLast: boolean;
  compact?: boolean;
  onRetry: () => void;
  onFeedback: (value: "up" | "down") => void;
  onApprove: (callId: string, overrides?: Record<string, any>) => void;
  onCancel: (callId: string) => void;
  onUndo: (callId: string) => void;
}

export const MessageView = ({ message, isLast, compact, onRetry, onFeedback, onApprove, onCancel, onUndo }: Props) => {
  const navigate = useNavigate();

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments?.map((a) => (
          <span key={`${a.name}-${a.sheet}`} className="inline-flex max-w-[85%] items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{message.attachments!.length > 1 ? `${a.name} · ${a.sheet}` : a.name}</span>
            <span className="shrink-0 text-muted-foreground">{a.rows} row{a.rows === 1 ? "" : "s"}</span>
          </span>
        ))}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const steps = message.steps || [];
  const projectSources = (message.sources || []).filter((s) => s.kind === "project" && s.id);
  const dataSources = (message.sources || []).filter((s) => s.kind === "data");
  const done = !message.streaming;
  const empty = !message.content && !message.actions?.length && !message.error;

  return (
    <div className="flex gap-3">
      {!compact && <BuddyAvatar size={26} className="mt-0.5" />}
      <div className="min-w-0 flex-1 space-y-2.5">
        {(steps.length > 0 || (message.streaming && empty)) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-muted-foreground">
            {steps.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <Check className="h-3 w-3 text-success-strong" />
                {s}
              </span>
            ))}
            {message.streaming && (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {steps.length ? "Writing" : "Thinking"}
              </span>
            )}
          </div>
        )}

        {message.content && <Markdown content={message.content} />}

        {message.reports?.map((r, i) => (
          <ReportCard key={i} report={r} />
        ))}

        {message.actions?.map((a) => (
          <ActionCard
            key={a.callId}
            action={a}
            onApprove={(o) => onApprove(a.callId, o)}
            onCancel={() => onCancel(a.callId)}
            onUndo={() => onUndo(a.callId)}
          />
        ))}

        {message.error && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-strong">
            <span className="min-w-0 flex-1">{message.error}</span>
            {isLast && (
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline">
                <RotateCcw className="h-3.5 w-3.5" /> Try again
              </button>
            )}
          </div>
        )}
        {message.stopped && <p className="text-xs text-muted-foreground">Stopped.</p>}

        {done && (!!message.content || !!message.sources?.length) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border pt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              {(projectSources.length > 0 || dataSources.length > 0) && <span>Based on</span>}
              {dataSources.slice(0, 2).map((s, i) => (
                <span key={`d${i}`}>{s.label}</span>
              ))}
              {projectSources.slice(0, 6).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: s.id! } })}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {s.label}
                </button>
              ))}
            </div>
            {message.content && (
              <div className="flex items-center gap-0.5 text-muted-foreground">
                <IconButton
                  label="Copy answer"
                  onClick={() => {
                    void navigator.clipboard?.writeText(message.content);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
                {isLast && (
                  <IconButton label="Ask again" onClick={onRetry}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                <IconButton label="Helpful" active={message.feedback === "up"} onClick={() => onFeedback("up")}>
                  <ThumbsUp className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="Not helpful" active={message.feedback === "down"} onClick={() => onFeedback("down")}>
                  <ThumbsDown className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const IconButton = ({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={cn(
      "rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active && "bg-primary-soft text-primary",
    )}
  >
    {children}
  </button>
);
