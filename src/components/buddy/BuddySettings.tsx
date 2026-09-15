import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { tenantScope } from "@/lib/tenant-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ACTION_LABELS } from "./actionLabels";

const SETTINGS_KEY = "buddy_settings";

interface Settings {
  disabled_actions: string[];
  bulk_limit: number;
  instructions: string;
  brief_enabled: boolean;
}

const DEFAULTS: Settings = { disabled_actions: [], bulk_limit: 25, instructions: "", brief_enabled: true };

const parse = (raw: unknown): Settings => {
  let v: any = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = {};
    }
  }
  v = v && typeof v === "object" ? v : {};
  const limit = Number(v.bulk_limit);
  return {
    disabled_actions: Array.isArray(v.disabled_actions) ? v.disabled_actions.map(String) : [],
    bulk_limit: Number.isFinite(limit) && limit >= 1 ? Math.min(Math.round(limit), 500) : 25,
    instructions: typeof v.instructions === "string" ? v.instructions : "",
    brief_enabled: v.brief_enabled !== false,
  };
};

/** Settings → Buddy: what Buddy may do in this workspace, and how it's being used. */
export const BuddySettings = () => {
  const perms = usePermissions();
  const canEdit = perms.canManageIntegrations;
  return (
    <div className="space-y-6">
      <BuddyUsage />
      {canEdit ? (
        <BuddyControls />
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-6 text-sm text-muted-foreground">Buddy's actions and instructions are managed by workspace admins.</CardContent>
        </Card>
      )}
    </div>
  );
};

const BuddyControls = () => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = currentUser?.tenantId;
  const [draft, setDraft] = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ["buddy-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("tenant_id", tenantScope(tenantId)).eq("key", SETTINGS_KEY).maybeSingle();
      return parse((data as { value?: string } | null)?.value);
    },
  });
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved || DEFAULTS);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: SETTINGS_KEY, value: JSON.stringify(draft), category: "buddy", tenant_id: tenantId }, { onConflict: "key,tenant_id" });
    setSaving(false);
    if (error) {
      toast.error("Couldn't save Buddy settings.", { description: error.message });
      return;
    }
    toast.success("Buddy settings saved");
    void queryClient.invalidateQueries({ queryKey: ["buddy-settings", tenantId] });
  };

  const toggleAction = (name: string, on: boolean) =>
    setDraft((d) => ({ ...d, disabled_actions: on ? d.disabled_actions.filter((a) => a !== name) : [...d.disabled_actions, name] }));

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/40" />;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="heading-card">What Buddy can do</CardTitle>
        <CardDescription>Applies to everyone in this workspace. Managers and admins approve every change Buddy proposes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <p className="eyebrow">Actions</p>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {Object.entries(ACTION_LABELS).map(([name, label]) => {
              const on = !draft.disabled_actions.includes(name);
              return (
                <label key={name} htmlFor={`buddy-action-${name}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="text-sm text-foreground">{label}</span>
                  <Switch id={`buddy-action-${name}`} checked={on} onCheckedChange={(v) => toggleAction(name, v)} />
                </label>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="buddy-bulk-limit">Largest bulk change without typed confirmation</label>
            <Input
              id="buddy-bulk-limit"
              type="number"
              min={1}
              max={500}
              value={draft.bulk_limit}
              onChange={(e) => setDraft((d) => ({ ...d, bulk_limit: Number(e.target.value) || 1 }))}
              className="h-9 w-32 rounded-md"
            />
            <p className="text-xs text-muted-foreground">Above this, the person types the number of projects to approve.</p>
          </div>
          <label htmlFor="buddy-brief" className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Daily brief</span>
              <span className="block text-xs text-muted-foreground">Show each person what needs them when they open Buddy. They can dismiss it for the day.</span>
            </span>
            <Switch id="buddy-brief" checked={draft.brief_enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, brief_enabled: v }))} />
          </label>
        </section>

        <section className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="buddy-instructions">Instructions for Buddy</label>
          <Textarea
            id="buddy-instructions"
            rows={4}
            maxLength={2000}
            value={draft.instructions}
            onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
            placeholder="For example: Call merchants 'partners'. Sign emails with 'The Integrations team'. Always mention the SPOC in handover summaries."
            className="rounded-md"
          />
          <p className="text-xs text-muted-foreground">{draft.instructions.length}/2000 · Tone, terms and house rules Buddy follows in every answer.</p>
        </section>

        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={!dirty || saving} className="rounded-lg">
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(saved || DEFAULTS)} disabled={!dirty} className="rounded-lg">
            Discard changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

interface LogRow {
  id: string;
  category: string;
  description: string;
  status: string;
  user_name: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
}

const BuddyUsage = () => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), []);
  const [open, setOpen] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["buddy-usage", tenantId, since.slice(0, 10)],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("id, category, description, status, user_name, created_at, metadata")
        .eq("tenant_id", tenantId)
        .eq("action_type", "ai")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(3000);
      return (data || []) as LogRow[];
    },
  });

  const stats = useMemo(() => {
    const viaBuddy = rows.filter((r) => r.metadata?.via === "buddy");
    return {
      questions: rows.filter((r) => r.category === "buddy_question").length,
      people: new Set(rows.filter((r) => r.category === "buddy_question").map((r) => r.user_name)).size,
      done: viaBuddy.filter((r) => r.status === "success" && r.metadata?.action).length,
      failed: viaBuddy.filter((r) => r.status === "failed").length,
      cancelled: rows.filter((r) => r.category === "buddy_action_cancelled").length,
      undone: rows.filter((r) => r.description.startsWith("Undid:")).length,
      up: rows.filter((r) => r.category === "buddy_feedback" && r.metadata?.value === "up").length,
      down: rows.filter((r) => r.category === "buddy_feedback" && r.metadata?.value === "down"),
      briefViews: rows.filter((r) => r.category === "buddy_brief" && r.description.startsWith("Viewed")).length,
      briefUses: rows.filter((r) => r.category === "buddy_brief" && r.description.startsWith("Used")).length,
      topActions: Object.entries(
        viaBuddy
          .filter((r) => r.status === "success" && r.metadata?.action)
          .reduce<Record<string, number>>((acc, r) => {
            const k = String(r.metadata!.action);
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    };
  }, [rows]);

  if (isLoading) return <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/40" />;

  const approvalBase = stats.done + stats.cancelled;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="heading-card">Usage in the last 30 days</CardTitle>
        <CardDescription>From the activity log. Questions are counted without their text; answers marked not helpful include the conversation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border sm:grid-cols-4">
          <Stat value={stats.questions} label={`Questions · ${stats.people} ${stats.people === 1 ? "person" : "people"}`} />
          <Stat value={stats.done} label={`Actions done${approvalBase ? ` · ${Math.round((stats.done / approvalBase) * 100)}% approved` : ""}`} />
          <Stat value={stats.cancelled} label={`Cancelled · ${stats.undone} undone · ${stats.failed} failed`} />
          <Stat value={`${stats.up} / ${stats.down.length}`} label="Helpful / not helpful" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-2">
            <p className="eyebrow">Most used actions</p>
            {stats.topActions.length ? (
              <ul className="space-y-1.5">
                {stats.topActions.map(([name, n]) => (
                  <li key={name} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{ACTION_LABELS[name] || name.replace(/_/g, " ")}</span>
                    <span className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(8, (n / stats.topActions[0]![1]) * 120)}px` }} />
                    <span className="w-8 text-right tabular-nums text-muted-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No actions yet.</p>
            )}
            <p className="pt-2 text-xs text-muted-foreground">Daily brief: viewed {stats.briefViews} times, {stats.briefUses} next steps taken.</p>
          </section>

          <section className="space-y-2">
            <p className="eyebrow">Answers marked not helpful</p>
            {stats.down.length === 0 && <p className="text-sm text-muted-foreground">None. 👍</p>}
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {stats.down.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60">
                    <ThumbsDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.metadata?.question || "Question not recorded"}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{r.user_name} · {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open === r.id && "rotate-180")} />
                  </button>
                  {open === r.id && (
                    <div className="space-y-2 bg-muted/40 px-3 py-3 text-sm">
                      <p className="eyebrow">Question</p>
                      <p className="whitespace-pre-wrap text-foreground">{r.metadata?.question}</p>
                      <p className="eyebrow pt-1">Buddy's answer</p>
                      <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{r.metadata?.answer}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </CardContent>
    </Card>
  );
};

const Stat = ({ value, label }: { value: number | string; label: string }) => (
  <div className="border-border px-4 py-3 [&:not(:first-child)]:border-l">
    <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    <p className="text-2xs text-muted-foreground">{label}</p>
  </div>
);
