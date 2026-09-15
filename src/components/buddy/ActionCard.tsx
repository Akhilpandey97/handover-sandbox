import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RotateCcw, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { actionTitle } from "./actionLabels";
import type { BuddyAction } from "./types";

const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
};

const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

interface Props {
  action: BuddyAction;
  onApprove: (overrides?: Record<string, any>) => void;
  onCancel: () => void;
  onUndo: () => void;
}

/**
 * One proposed change. The person sees exactly what will change, in plain
 * labels, before approving; afterwards the same card shows the result, a link
 * to it and Undo while it's available.
 */
export const ActionCard = ({ action, onApprove, onCancel, onUndo }: Props) => {
  const navigate = useNavigate();
  const p = action.preview;
  const [typed, setTyped] = useState("");
  const [subject, setSubject] = useState(p?.email?.subject || "");
  const [body, setBody] = useState(p?.email?.body || "");
  useEffect(() => {
    if (p?.email) {
      setSubject(p.email.subject);
      setBody(p.email.body);
    }
  }, [p?.email]);

  const undoUntil = action.result?.undoUntil ? new Date(action.result.undoUntil).getTime() : 0;
  const now = useNow(action.status === "done" && !!action.result?.undoable && undoUntil > Date.now());
  const canUndo = action.status === "done" && !!action.result?.undoable && undoUntil > now;
  const goTo = (href: string) =>
    /^https?:\/\//.test(href) ? window.open(href, "_blank", "noopener,noreferrer") : navigate({ to: href } as never);

  if (action.status === "previewing") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing {actionTitle(action).toLowerCase()}…
      </div>
    );
  }

  const confirmNeeded = !!p?.requiresTypedConfirm && action.status === "pending";
  const confirmOk = !confirmNeeded || Number(typed) === p?.count;
  const header = {
    pending: null,
    executing: null,
    done: { tone: "bg-success-soft text-success-strong", icon: <CheckCircle2 className="h-4 w-4" />, label: "Done" },
    failed: { tone: "bg-destructive-soft text-destructive-strong", icon: <XCircle className="h-4 w-4" />, label: "Didn't go through" },
    cancelled: { tone: "bg-muted text-muted-foreground", icon: <XCircle className="h-4 w-4" />, label: "Cancelled" },
    undone: { tone: "bg-muted text-muted-foreground", icon: <Undo2 className="h-4 w-4" />, label: "Undone" },
    previewing: null,
  }[action.status];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className={cn("flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5", header?.tone)}>
        <div className="flex min-w-0 items-center gap-2">
          {header?.icon}
          <span className="truncate text-sm font-semibold">{header ? `${header.label} · ${actionTitle(action)}` : actionTitle(action)}</span>
        </div>
        {p?.count !== undefined && (
          <span className="shrink-0 rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning-strong">
            {p.count} project{p.count === 1 ? "" : "s"}
          </span>
        )}
        {p?.target && p.count === undefined && (
          <button
            type="button"
            onClick={() => goTo(`/projects/${p.target!.id}`)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-2xs font-medium text-foreground hover:bg-muted"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {p.target.label}
          </button>
        )}
      </div>

      <div className="space-y-3 px-4 py-3 text-sm">
        {action.status === "done" && action.result && <p className="text-foreground">{action.result.message}</p>}
        {action.status === "failed" && action.error && <p className="text-destructive-strong">{action.error}</p>}

        {p && (action.status === "pending" || action.status === "executing" || action.status === "failed") && (
          <>
            {p.rows.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                {p.rows.map((r, i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {r.before !== undefined && r.before !== null && (
                        <>
                          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{r.before}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </>
                      )}
                      <span className="break-words font-medium text-foreground">{r.after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {p.items && p.items.length > 0 && (
              <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
                {p.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-foreground">{it.label}</span>
                    {it.detail && <span className="shrink-0 text-muted-foreground">{it.detail}</span>}
                  </li>
                ))}
                {p.count !== undefined && p.count > p.items.length && (
                  <li className="px-3 py-1.5 text-center text-xs text-muted-foreground">+ {p.count - p.items.length} more</li>
                )}
              </ul>
            )}

            {p.email && (
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  To <span className="font-medium text-foreground">{p.email.to.join(", ")}</span>
                  {p.email.cc?.length ? <> · cc {p.email.cc.join(", ")}</> : null}
                </p>
                <Input
                  id={`buddy-email-subject-${action.callId}`}
                  aria-label="Email subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={action.status !== "pending"}
                  className="h-9 rounded-md bg-card text-sm"
                />
                <Textarea
                  id={`buddy-email-body-${action.callId}`}
                  aria-label="Email body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={action.status !== "pending"}
                  rows={Math.min(12, Math.max(5, body.split("\n").length + 1))}
                  className="rounded-md bg-card text-sm"
                />
                <p className="text-2xs text-muted-foreground">Edit before sending. Nothing is sent until you approve.</p>
              </div>
            )}

            {p.notes?.map((n, i) => (
              <p key={i} className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{n}</p>
            ))}
            {p.warnings?.map((w, i) => (
              <p key={i} className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-strong">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {w}
              </p>
            ))}

            {confirmNeeded && (
              <label className="block text-xs text-muted-foreground" htmlFor={`buddy-confirm-${action.callId}`}>
                Type <span className="font-semibold text-foreground">{p.count}</span> to approve
                <Input
                  id={`buddy-confirm-${action.callId}`}
                  inputMode="numeric"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="mt-1 h-9 w-28 rounded-md"
                />
              </label>
            )}
          </>
        )}

        {action.status === "pending" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 rounded-lg"
              disabled={!confirmOk}
              onClick={() => onApprove({ ...(p?.email ? { subject, body } : {}), ...(confirmNeeded ? { confirm_count: Number(typed) } : {}) })}
            >
              {p?.email ? "Send" : p?.count && p.count > 1 ? `Approve ${p.count} changes` : "Approve"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}

        {action.status === "executing" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
          </p>
        )}

        {action.status === "failed" && p && (
          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => onApprove()}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        )}

        {action.status === "done" && (action.result?.link || canUndo) && (
          <div className="flex flex-wrap items-center gap-2">
            {action.result?.link && (
              <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => goTo(action.result!.link!.href)}>
                {action.result.link.label}
              </Button>
            )}
            {canUndo && (
              <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={onUndo}>
                <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo · {countdown(undoUntil - now)}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
