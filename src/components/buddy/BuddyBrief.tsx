import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiAuthHeaders } from "@/lib/api-invoke";
import { logActivity } from "@/hooks/useActivityLogs";
import { cn } from "@/lib/utils";

type Tone = "bad" | "warn" | "info" | "ok";

interface Brief {
  enabled: boolean;
  date?: string;
  first_name?: string;
  scope_label?: string;
  counts?: { overdue: number; blocked: number; go_lives: number; stalled: number };
  items?: { tone: Tone; project_id: string; merchant: string; title: string; detail: string; action: { label: string; prompt: string; draft?: boolean } }[];
}

interface ProjectHints {
  summary: string | null;
  suggestions: { label: string; prompt: string; draft?: boolean }[];
}

const fetchBrief = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const res = await fetch("/api/public/buddy-brief", { method: "POST", headers: await apiAuthHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error("Couldn't load the brief");
  return (await res.json()) as T;
};

const STRIPE: Record<Tone, string> = { bad: "bg-destructive", warn: "bg-warning", info: "bg-info", ok: "bg-success" };

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

/**
 * Today's brief: what needs this person, each with one next step. Shown once a
 * day at the top of an empty Buddy chat; dismissing it hides it until tomorrow.
 */
export const DailyBrief = ({ onPick }: { onPick: (prompt: string, draft?: boolean) => void }) => {
  const { currentUser } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const dismissKey = `buddy:brief-dismissed:${currentUser?.id}:${today}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(storage.get(dismissKey) === "1"), [dismissKey]);

  const { data, isLoading } = useQuery({
    queryKey: ["buddy-brief", currentUser?.id, currentUser?.tenantId, today],
    enabled: !!currentUser,
    staleTime: 5 * 60_000,
    queryFn: () => fetchBrief<Brief>({}),
  });

  useEffect(() => {
    if (!data?.enabled || !currentUser) return;
    const viewedKey = `buddy:brief-viewed:${currentUser.id}:${today}`;
    if (storage.get(viewedKey)) return;
    storage.set(viewedKey, "1");
    void logActivity({ action_type: "ai", category: "buddy_brief", description: "Viewed the daily brief", metadata: { counts: data.counts, items: data.items?.length || 0 } });
  }, [data, currentUser, today]);

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" aria-label="Loading today's brief" />;
  if (!data?.enabled) return null;

  if (dismissed) {
    return (
      <button type="button" onClick={() => { storage.set(dismissKey, "0"); setDismissed(false); }} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
        <Sparkles className="h-3.5 w-3.5" /> Show today's brief
      </button>
    );
  }

  const counts = data.counts || { overdue: 0, blocked: 0, go_lives: 0, stalled: 0 };
  const items = data.items || [];
  const dateLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label="Today's brief">
      <div className="flex items-start justify-between gap-3 bg-hero px-4 py-3.5 text-hero-foreground">
        <div className="min-w-0">
          <p className="text-2xs opacity-75">{dateLabel} · {data.scope_label}</p>
          <p className="heading-card mt-0.5">
            {items.length ? `Good ${greeting()}, ${data.first_name}. ${items.length} thing${items.length === 1 ? " needs" : "s need"} you today.` : `Good ${greeting()}, ${data.first_name}. Nothing urgent today.`}
          </p>
        </div>
        <button type="button" aria-label="Dismiss today's brief" title="Dismiss until tomorrow" onClick={() => { storage.set(dismissKey, "1"); setDismissed(true); }} className="rounded-md p-1 opacity-70 hover:bg-white/10 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
        <Count value={counts.overdue} label="Overdue items" tone={counts.overdue ? "text-destructive-strong" : undefined} />
        <Count value={counts.blocked} label="Blocked" tone={counts.blocked ? "text-warning-strong" : undefined} />
        <Count value={counts.go_lives} label="Go-lives this week" />
        <Count value={counts.stalled} label="No activity 7+ days" />
      </div>
      {items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.project_id} className="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pr-3">
              <span className={cn("h-full min-h-9 rounded-r", STRIPE[it.tone])} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{it.title}</p>
                <p className="truncate text-xs text-muted-foreground">{it.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void logActivity({ action_type: "ai", category: "buddy_brief", description: `Used daily brief item: ${it.action.label}`, entity_type: "project", entity_id: it.project_id });
                  onPick(it.action.prompt, it.action.draft);
                }}
                className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-primary-soft"
              >
                {it.action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/** One-line status and next-step suggestions for the project Buddy is opened on. */
export const ProjectSuggestions = ({ projectId, onPick }: { projectId: string; onPick: (prompt: string, draft?: boolean) => void }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["buddy-project-hints", projectId],
    staleTime: 2 * 60_000,
    queryFn: () => fetchBrief<ProjectHints>({ project_id: projectId }),
  });
  if (isLoading) return <div className="h-16 animate-pulse rounded-lg bg-muted/50" />;
  if (!data) return null;
  return (
    <div className="space-y-2">
      {data.summary && <p className="text-sm text-muted-foreground">{data.summary}</p>}
      <p className="eyebrow">Suggested</p>
      <div className="flex flex-wrap gap-2">
        {data.suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt, s.draft)}
            className="rounded-full border border-info/30 bg-info-soft px-3 py-1.5 text-xs font-medium text-info-strong transition-colors hover:border-info/60"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const Count = ({ value, label, tone }: { value: number; label: string; tone?: string }) => (
  <div className="border-border px-4 py-2.5 [&:not(:first-child)]:border-l">
    <p className={cn("text-xl font-semibold tabular-nums text-foreground", tone)}>{value}</p>
    <p className="text-2xs text-muted-foreground">{label}</p>
  </div>
);

const greeting = () => {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};
