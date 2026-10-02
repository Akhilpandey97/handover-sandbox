import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Project } from "@/data/projectsData";
import { pathForTab } from "@/lib/dashboard-routes";
import {
  Archive,
  CalendarDays,
  Filter,
  LayoutDashboard,
  ListChecks,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  /** Keeps the old behaviour available: filter the list behind the palette. */
  onFilterList?: (query: string) => void;
}

const PAGES = [
  { label: "Dashboard", to: pathForTab("dashboard"), icon: LayoutDashboard, keywords: "home overview" },
  { label: "Projects", to: pathForTab("projects"), icon: ListChecks, keywords: "kanban board list" },
  { label: "Risks", to: pathForTab("risks"), icon: ShieldAlert, keywords: "attention blocked" },
  { label: "Go-Live Tracker", to: pathForTab("golive"), icon: CalendarDays, keywords: "golive launch dates" },
  { label: "Reports", to: pathForTab("reports"), icon: Sparkles, keywords: "tat movement export" },
  { label: "Archived", to: pathForTab("archived"), icon: Archive, keywords: "closed old" },
  { label: "Settings", to: pathForTab("settings"), icon: Settings, keywords: "integrations users labels" },
];

/**
 * Search the way Spotlight works: one keystroke away, everything in one list, typing
 * narrows it, arrows move, Enter opens.
 *
 * It replaces an input that only filtered the list behind it — useful, but it meant
 * finding a project you were not already looking at took several steps. That filter is
 * still here as the first action when a query is typed.
 */
export const GlobalSearch = ({ open, onOpenChange, projects, onFilterList }: GlobalSearchProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  // ⌘K / Ctrl-K from anywhere, the shortcut people already try.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  // cmdk scores and orders; this only keeps the list a sensible length.
  const shown = useMemo(() => projects.slice(0, 200), [projects]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search projects, pages and merchants…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>

        {query && onFilterList ? (
          <>
            <CommandGroup heading="Actions">
              <CommandItem
                value={`filter ${query}`}
                onSelect={() => go(() => onFilterList(query))}
              >
                <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                Filter the list for “{query}”
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading="Projects">
          {shown.map((project) => (
            <CommandItem
              key={project.id}
              value={`${project.merchantName} ${project.mid} ${project.platform || ""}`}
              onSelect={() =>
                go(() => navigate({ to: "/projects/$projectId", params: { projectId: project.id } }))
              }
            >
              <Search className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate">{project.merchantName}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{project.mid}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {PAGES.map((page) => (
            <CommandItem
              key={page.to}
              value={`${page.label} ${page.keywords}`}
              onSelect={() => go(() => navigate({ to: page.to }))}
            >
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
