import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type React from "react";

export type SortDir = "asc" | "desc";

export const SortableHeader = ({
  label,
  active,
  dir,
  onSort,
  align = "left",
  className,
  ...thProps
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
} & Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "aria-sort">) => (
  <TableHead
    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    className={cn("h-auto p-0", className)}
    {...thProps}
  >
    <button
      type="button"
      onClick={onSort}
      title={`Sort by ${label}${active ? (dir === "asc" ? ", ascending" : ", descending") : ""}`}
      className={cn(
        "group flex h-full w-full items-center gap-1 px-3 py-2 text-left font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
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
