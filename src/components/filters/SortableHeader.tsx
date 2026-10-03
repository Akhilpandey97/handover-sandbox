import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

/**
 * A column header you can sort by.
 *
 * Sortable headers across the product were a `<th>` with an onClick and a
 * permanently two-way arrow: not reachable by keyboard, no focus ring, nothing
 * announced to a screen reader, and no way to tell which column was actually
 * sorting. This is a real button, it sets `aria-sort`, and the arrow points the
 * way the column is ordered — the neutral glyph only appears on hover, for the
 * columns that could sort but aren't.
 */
export const SortableHeader = ({
  label,
  active,
  dir,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) => (
  <TableHead
    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    className={cn("p-0", className)}
  >
    <button
      type="button"
      onClick={onSort}
      title={`Sort by ${label}${active ? (dir === "asc" ? ", ascending" : ", descending") : ""}`}
      className={cn(
        "group flex h-full w-full items-center gap-1 px-4 py-3 text-left font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        align === "right" && "justify-end",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50" />
      )}
    </button>
  </TableHead>
);
