import type { ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wraps a dashboard section so it can be reordered.
 *
 * Only the grip is draggable, not the whole slot: the sections contain
 * clickable cards, scrollable tables and toggles, and making the container
 * draggable would swallow those interactions. The slot is still the drop
 * target, so a drop anywhere over it counts.
 */
export const DashletSlot = ({
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  className,
  children,
}: {
  isDragging?: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  /** Grid span — the dashboard lays slots out in two columns. */
  className?: string;
  children: ReactNode;
}) => (
  <div
    onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
    className={cn("group relative transition-opacity", isDragging && "opacity-50", className)}
  >
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title="Drag to reorder"
      aria-label="Drag to reorder this section"
      className="absolute left-0.5 top-0.5 z-20 cursor-grab rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing group-hover:opacity-100"
    >
      <GripVertical className="h-4 w-4" />
    </button>
    {children}
  </div>
);
