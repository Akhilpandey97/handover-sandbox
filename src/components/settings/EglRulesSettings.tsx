import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CalendarClock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { projectStateLabels, ProjectState } from "@/data/projectsData";
import { DEFAULT_EGL_RULES, EGL_RULE_DESCRIPTIONS, EglRule } from "@/data/eglRisk";
import { useEglRules } from "@/hooks/useEglRules";

export const EglRulesSettings = () => {
  const { rules, isLoading, saveRules } = useEglRules();
  const [draft, setDraft] = useState<EglRule[]>(rules);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(rules); }, [rules]);

  const update = (id: string, patch: Partial<EglRule>) =>
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await saveRules(draft);
      toast.success("Go-live risk rules saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rules");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="border-b bg-muted/30">
        <CardTitle className="portal-heading flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          Go-Live Risk Rules
        </CardTitle>
        <CardDescription>
          Drives the "Projects at Risk of Missing EGL" dashlet. A project is listed when its go-live
          falls in the selected window and any enabled rule matches. These rules are a fixed set —
          each one needs its own calculation, so they can be turned on or off and tuned, but not
          invented here.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {draft.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-border/70 p-3 bg-card">
            <div className="flex items-start gap-3">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(v) => update(rule.id, { enabled: v })}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{rule.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{EGL_RULE_DESCRIPTIONS[rule.id]}</p>

                {rule.enabled && rule.id === "stalled" && (
                  <div className="mt-2 flex items-center gap-2">
                    <Label className="text-xs shrink-0">Days without a comment</Label>
                    <Input
                      type="number"
                      min={1}
                      value={rule.days ?? 5}
                      onChange={(e) => update(rule.id, { days: Math.max(1, Number(e.target.value) || 1) })}
                      className="h-8 w-24 text-xs"
                    />
                  </div>
                )}

                {rule.enabled && rule.id === "state" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(Object.keys(projectStateLabels) as ProjectState[]).map((s) => {
                      const on = (rule.states || []).includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            update(rule.id, {
                              states: on
                                ? (rule.states || []).filter((x) => x !== s)
                                : [...(rule.states || []), s],
                            })
                          }
                          className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                            on
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {projectStateLabels[s]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_EGL_RULES)} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="ml-auto">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
