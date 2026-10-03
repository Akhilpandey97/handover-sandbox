import { useState, type ReactNode } from "react";
import { Check, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The product's one filter surface.
 *
 * Filters had drifted into four shapes — a 560px panel of checkbox columns, rows
 * of bare selects, a shared bar, and loose popovers — each with its own idea of
 * whether to show a count, offer a reset, or say anything when the filters hid
 * every row. This is the single shell: a narrow panel, dense rows, each group
 * scrolling on its own past a handful of options, a count on the trigger and a
 * Clear that is always in the same place.
 */

export const FilterPanel = ({
  count,
  onClear,
  children,
  label = "Filters",
  align = "start",
}: {
  /** Active filters, shown on the trigger and gating Clear. */
  count: number;
  onClear: () => void;
  children: ReactNode;
  label?: string;
  align?: "start" | "end";
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-8 gap-1.5 px-2.5 text-xs", count > 0 && "border-primary/50 text-primary")}
      >
        <Filter className="h-3.5 w-3.5" />
        {label}
        {count > 0 && (
          <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold leading-none text-primary-foreground">
            {count}
          </span>
        )}
      </Button>
    </PopoverTrigger>
    <PopoverContent align={align} className="w-[280px] p-0" style={{ maxHeight: "calc(100vh - 8rem)" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-1 h-6 px-2 text-2xs"
          onClick={onClear}
          disabled={count === 0}
        >
          Clear
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-2">{children}</div>
    </PopoverContent>
  </Popover>
);

/**
 * One filter inside the panel. Past eight options it grows its own search box
 * and scrolls, so a workspace with sixty owners does not produce a mile of panel.
 */
export const FilterGroup = ({
  title,
  options,
  selected,
  onToggle,
  searchable,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Defaults on past eight options. */
  searchable?: boolean;
}) => {
  const [query, setQuery] = useState("");
  const withSearch = searchable ?? options.length > 8;
  const shown = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div className="mb-1 last:mb-0">
      <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {selected.length > 0 && (
          <span className="text-2xs tabular-nums text-primary">{selected.length}</span>
        )}
      </div>

      {withSearch && (
        <div className="relative mb-1 px-1">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label={`Search ${title}`}
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}

      <div className={cn("space-y-px", options.length > 8 && "max-h-44 overflow-y-auto pr-0.5")}>
        {shown.length === 0 ? (
          <p className="px-1.5 py-1.5 text-2xs text-muted-foreground">No match.</p>
        ) : (
          shown.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
                  on ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

/**
 * What a table says when the filters, not the data, emptied it. Without this a
 * filtered-out table reads as "there is nothing here", and people reload.
 */
export const FilteredEmptyState = ({
  onClear,
  noun = "rows",
}: {
  onClear: () => void;
  noun?: string;
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Filter className="h-4 w-4" />
    </span>
    <p className="text-sm font-medium text-foreground">No {noun} match your filters</p>
    <p className="max-w-xs text-xs text-muted-foreground">
      Every {noun.replace(/s$/, "")} is hidden by the filters you have set, not missing.
    </p>
    <Button variant="outline" size="sm" className="mt-1 h-7 gap-1.5 text-xs" onClick={onClear}>
      <X className="h-3 w-3" />
      Clear filters
    </Button>
  </div>
);
