import { useMemo, useState } from "react";
import { Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Thread } from "./types";

interface Props {
  threads: Thread[];
  pins: string[];
  activeId: string | null;
  onOpen: (id: string | null) => void;
  onNew: () => void;
  onDelete: (id: string | null) => void;
  onTogglePin: (id: string | null) => void;
}

const groupLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  return "Older";
};

export const ThreadList = ({ threads, pins, activeId, onOpen, onNew, onDelete, onTogglePin }: Props) => {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
    const pinned = visible.filter((t) => t.id !== null && pins.includes(t.id));
    const rest = visible.filter((t) => !(t.id !== null && pins.includes(t.id)));
    const out: { label: string; items: Thread[] }[] = [];
    if (pinned.length) out.push({ label: "Pinned", items: pinned });
    for (const t of rest) {
      const label = groupLabel(t.at);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }, [threads, pins, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 p-3">
        <Button onClick={onNew} size="sm" className="h-9 w-full gap-2 rounded-lg">
          <Plus className="h-4 w-4" /> New chat
        </Button>
        <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5" htmlFor="buddy-thread-search">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            id="buddy-thread-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{query ? "No chats match." : "No conversations yet."}</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <p className="eyebrow px-2 pb-1 pt-2">{g.label}</p>
            {g.items.map((t) => {
              const pinned = t.id !== null && pins.includes(t.id);
              return (
                <div
                  key={t.id ?? "legacy"}
                  className={cn("group flex items-center gap-0.5 rounded-md pr-1", t.id === activeId ? "bg-primary-soft" : "hover:bg-muted")}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    title={t.title}
                    className={cn(
                      "min-w-0 flex-1 truncate px-2.5 py-2 text-left text-xs",
                      t.id === activeId ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {t.title}
                  </button>
                  {t.id !== null && (
                    <button
                      type="button"
                      onClick={() => onTogglePin(t.id)}
                      title={pinned ? "Unpin" : "Pin"}
                      aria-label={pinned ? `Unpin ${t.title}` : `Pin ${t.title}`}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    title="Delete chat"
                    aria-label={`Delete ${t.title}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive-strong focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
