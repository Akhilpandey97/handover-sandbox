import type { ReactNode } from "react";
import { useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAttentionReason, type AttentionKind } from "@/hooks/useAttentionReason";
import { cn } from "@/lib/utils";

/**
 * AI prose layered on top of the deterministic rule reasons. Used everywhere a
 * project is flagged — the Needs Attention badge, both dashlets and the Risks
 * tab — so the wording is identical across the product.
 */
export const AttentionReasonBlock = ({
  projectId,
  kind,
  reasons,
  enabled = true,
  compact = false,
  className,
}: {
  projectId: string;
  kind: AttentionKind;
  reasons: string[];
  enabled?: boolean;
  /** Prose only — for table cells, where the label, refresh, next step and
   *  evidence would crowd the row. Detail views keep the full block. */
  compact?: boolean;
  className?: string;
}) => {
  const { reason, isLoading, error, regenerate } = useAttentionReason(projectId, kind, reasons, enabled);

  if (compact) {
    if (isLoading && !reason) {
      return (
        <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
          <Loader2 className="h-3 w-3 animate-spin" /> Reading checklist, tasks and comments…
        </p>
      );
    }
    if (!reason) {
      return (
        <p className={cn("text-xs text-muted-foreground", className)}>
          {error ? (error as Error).message : reasons.join(" · ")}
        </p>
      );
    }
    return <p className={cn("text-xs leading-relaxed text-foreground/90", className)}>{reason.why}</p>;
  }

  return (
    <div className={cn("space-y-1.5 text-xs leading-relaxed", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-2xs font-semibold tracking-normal text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" /> AI explanation
        </span>
        {reason && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void regenerate(); }}
            className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        )}
      </div>

      {isLoading && !reason && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading checklist, tasks and comments…
        </p>
      )}

      {error && !reason && (
        <p className="text-muted-foreground">{(error as Error).message}</p>
      )}

      {reason && (
        <>
          <p className="text-foreground/90">{reason.why}</p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground/80">Next: </span>
            {reason.recommendation}
          </p>
          {reason.evidence && reason.evidence.length > 0 && (
            <ul className="space-y-0.5 pt-0.5">
              {reason.evidence.map((e, i) => (
                <li key={i} className="flex gap-1.5 text-2xs text-muted-foreground">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

/** Rule reasons plus the AI explanation, in a popover around any trigger. */
export const AttentionReasonPopover = ({
  projectId,
  kind,
  reasons,
  title,
  children,
  align = "start",
}: {
  projectId: string;
  kind: AttentionKind;
  reasons: string[];
  title?: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Above the dialog layer: PopoverContent defaults to z-50 while the
          dialog overlay sits at z-120, so a badge clicked inside the drill-down
          list opened its popover behind the dialog. pointer-events-auto because
          a modal dialog disables them on everything portalled outside itself. */}
      <PopoverContent
        align={align}
        className="z-[140] w-80 p-3 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-foreground mb-2">{title || "Why this needs attention"}</p>
        <ul className="space-y-1.5">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-destructive" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t pt-2">
          <AttentionReasonBlock projectId={projectId} kind={kind} reasons={reasons} enabled={open} />
        </div>
      </PopoverContent>
    </Popover>
  );
};
