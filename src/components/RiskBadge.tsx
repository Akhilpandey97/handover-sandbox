import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RiskVerdict } from "@/data/riskRules";

/**
 * The single risk indicator used across every view. Renders nothing unless a
 * rule is actually firing — "low risk" is the absence of a signal, and badging
 * it would put a label on every healthy project.
 */
export const RiskBadge = ({
  verdict,
  className,
}: {
  verdict: RiskVerdict | undefined;
  className?: string;
}) => {
  if (!verdict || verdict.level !== "high") return null;

  return (
    <Badge
      title={verdict.findings.map((f) => f.detail).join("\n")}
      className={cn(
        "shrink-0 bg-red-600 hover:bg-red-600 text-white border-transparent text-[10px] px-1.5 py-0 font-semibold",
        className,
      )}
    >
      High Risk
    </Badge>
  );
};
