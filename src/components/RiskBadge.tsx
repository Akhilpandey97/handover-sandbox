import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskVerdict } from "@/data/riskRules";
import { AttentionReasonPopover } from "./AttentionReason";

/**
 * The single risk indicator used across every view. Renders nothing unless a
 * rule is actually firing — "low risk" is the absence of a signal, and badging
 * it would put a label on every healthy project.
 *
 * Clicking opens the rule reasons plus an AI explanation grounded in the
 * project's checklist, tasks and comments. The badge lives inside rows and
 * cards that navigate on click, so the trigger stops propagation.
 */
export const RiskBadge = ({
  verdict,
  projectId,
  className,
}: {
  verdict: RiskVerdict | undefined;
  projectId?: string;
  className?: string;
}) => {
  if (!verdict || verdict.level !== "high") return null;

  const reasons = verdict.findings.map((f) => f.detail);
  const id = projectId;

  const trigger = (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      aria-label="Why this project needs attention"
      className={cn("shrink-0 focus:outline-none focus:ring-2 focus:ring-ring rounded", className)}
    >
      <Badge className="bg-red-600 hover:bg-red-700 text-white border-transparent text-[10px] px-1.5 py-0 font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors">
        Needs Attention
        <Eye className="h-2.5 w-2.5 opacity-70" />
      </Badge>
    </button>
  );

  if (!id) return trigger;

  return (
    <AttentionReasonPopover
      projectId={id}
      kind="risk"
      reasons={reasons}
      title="Why this needs attention"
    >
      {trigger}
    </AttentionReasonPopover>
  );
};

