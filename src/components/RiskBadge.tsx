import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskVerdict } from "@/data/riskRules";

/**
 * The single risk indicator used across every view. Renders nothing unless a
 * rule is actually firing — "low risk" is the absence of a signal, and badging
 * it would put a label on every healthy project.
 *
 * Clicking opens the reasons. The badge lives inside rows and cards that
 * navigate on click, so the trigger stops propagation rather than opening the
 * project underneath.
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Why this project is at risk"
          className={cn("shrink-0 focus:outline-none focus:ring-2 focus:ring-ring rounded", className)}
        >
          <Badge className="bg-red-600 hover:bg-red-700 text-white border-transparent text-[10px] px-1.5 py-0 font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors">
            High Risk
            <Eye className="h-2.5 w-2.5 opacity-70" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-foreground mb-2">Why this is at risk</p>
        <ul className="space-y-1.5">
          {verdict.findings.map((f) => (
            <li key={f.ruleId} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-500" />
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">
          From Settings → Risk Rules
        </p>
      </PopoverContent>
    </Popover>
  );
};
