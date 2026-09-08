import { forwardRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Icon-only toolbar trigger shared by the Kanban, List and Go-Live toolbars.
 *
 * The three rows had drifted apart — different heights, gaps and popover
 * widths — so the shared trigger keeps them identical. With no label text there
 * is nowhere to put an active count inline, so it sits on the corner instead.
 */
export const ToolbarIconButton = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    /** Tooltip and accessible name — the only thing naming the button now. */
    label: string;
    count?: number;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ icon, label, count, className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="outline"
    size="icon"
    title={label}
    aria-label={label}
    className={cn("relative h-8 w-8 shrink-0", count ? "border-primary/50 text-primary" : "", className)}
    {...props}
  >
    {icon}
    {!!count && (
      <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
        {count}
      </span>
    )}
  </Button>
));
ToolbarIconButton.displayName = "ToolbarIconButton";

/** Shared popover widths, so Sort/Filters/Columns match across the views. */
export const TOOLBAR_POPOVER = {
  sort: "w-[300px] p-3 space-y-2.5",
  filters: "w-[560px] p-0 flex flex-col",
  columns: "w-[260px] p-3",
} as const;

/** Cap on filter panels so they scroll rather than run off the viewport. */
export const TOOLBAR_PANEL_MAX_H = { maxHeight: "calc(100vh - 8rem)" } as const;
