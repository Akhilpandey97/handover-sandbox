import type { LucideIcon } from "lucide-react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashletOrder } from "@/hooks/useDashletOrder";

export interface KpiBoxItem {
  /** Stable id used to remember the arrangement. */
  key: string;
  label: string;
  value: number;
  sub: string;
  icon: LucideIcon;
  tone: string;
  onClick: () => void;
  /** Optional secondary line, e.g. "4 need attention". */
  attentionCount?: number;
  onAttentionClick?: () => void;
}

/**
 * The KPI strip: one compact box per project state plus the portfolio totals.
 * Boxes are reordered by dragging their grip, and the arrangement is
 * remembered per dashboard via `storageKey`.
 */
export const KpiBar = ({ items, storageKey }: { items: KpiBoxItem[]; storageKey: string }) => {
  const defaultOrder = items.map((item) => item.key);
  const { order, dragging, onDragStart, onDragOver, onDragEnd } = useDashletOrder(defaultOrder, storageKey);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const ordered = order.map((key) => byKey.get(key)).filter(Boolean) as KpiBoxItem[];

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
        {ordered.map((kpi) => (
          <div
            key={kpi.key}
            role="button"
            tabIndex={0}
            onClick={kpi.onClick}
            onDragOver={(event) => { event.preventDefault(); onDragOver(kpi.key); }}
            className={cn(
              "group relative min-h-[92px] cursor-pointer bg-card px-3 py-2.5 transition-colors hover:bg-muted/40",
              dragging === kpi.key && "opacity-50",
            )}
          >
            <button
              type="button"
              draggable
              onDragStart={() => onDragStart(kpi.key)}
              onDragEnd={onDragEnd}
              onClick={(event) => event.stopPropagation()}
              title="Drag to reorder"
              aria-label={`Drag to reorder ${kpi.label}`}
              className="absolute right-0.5 top-0.5 z-20 cursor-grab rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing group-hover:opacity-100"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-2xs font-medium text-muted-foreground">{kpi.label}</p>
                <p className="mt-0.5 text-2xl font-semibold leading-tight tracking-tight text-foreground">{kpi.value}</p>
              </div>
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", kpi.tone)}>
                <kpi.icon className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1.5 truncate text-2xs text-muted-foreground" title={kpi.sub}>{kpi.sub}</p>
            {!!kpi.attentionCount && kpi.attentionCount > 0 && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); kpi.onAttentionClick?.(); }}
                className="mt-0.5 text-2xs font-semibold text-destructive-strong hover:underline"
              >
                {kpi.attentionCount} need attention
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default KpiBar;
