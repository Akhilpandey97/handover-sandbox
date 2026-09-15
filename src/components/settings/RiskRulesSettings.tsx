import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { projectStateLabels, ProjectState } from "@/data/projectsData";
import {
  DEFAULT_RISK_RULES,
  RISK_RULE_TYPE_LABELS,
  RiskRule,
  RiskRuleType,
  RiskSeverity,
  newRiskRuleId,
} from "@/data/riskRules";
import { useRiskRules } from "@/hooks/useRiskRules";

const SEVERITIES: RiskSeverity[] = ["low", "medium", "high", "critical"];

export const RiskRulesSettings = () => {
  const { rules, isLoading, saveRules } = useRiskRules();
  const [draft, setDraft] = useState<RiskRule[]>(rules);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(rules); }, [rules]);

  const update = (idx: number, patch: Partial<RiskRule>) =>
    setDraft((d) => d.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const remove = (idx: number) => setDraft((d) => d.filter((_, i) => i !== idx));

  const add = () =>
    setDraft((d) => [
      ...d,
      { id: newRiskRuleId(), label: "New rule", type: "no_activity", enabled: true, days: 7, severity: "medium" },
    ]);

  const save = async () => {
    setSaving(true);
    try {
      await saveRules(draft);
      toast.success("Risk rules saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save risk rules");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="border-b bg-muted/30">
        <CardTitle className="portal-heading flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          Risk Rules
        </CardTitle>
        <CardDescription>
          A project is High Risk when any enabled rule matches, and Low Risk otherwise. These rules
          drive the Risks tab, the project workspace and the at-risk lists.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {draft.map((rule, idx) => (
          <div key={rule.id} className="rounded-lg border border-border/70 p-3 space-y-3 bg-card">
            <div className="flex items-center gap-3">
              <Switch checked={rule.enabled} onCheckedChange={(v) => update(idx, { enabled: v })} />
              <Input
                value={rule.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                className="h-8 max-w-xs text-sm font-medium"
              />
              <Badge variant="outline" className="text-2xs tracking-normal">
                {rule.severity}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => remove(idx)}
                aria-label="Remove rule"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Condition</Label>
                <Select value={rule.type} onValueChange={(v) => update(idx, { type: v as RiskRuleType })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RISK_RULE_TYPE_LABELS) as RiskRuleType[]).map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{RISK_RULE_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {rule.type === "project_state" ? (
                <div className="space-y-1.5 sm:col-span-1">
                  <Label className="text-xs">States</Label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(Object.keys(projectStateLabels) as ProjectState[]).map((s) => {
                      const on = (rule.states || []).includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            update(idx, {
                              states: on
                                ? (rule.states || []).filter((x) => x !== s)
                                : [...(rule.states || []), s],
                            })
                          }
                          className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${
                            on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {projectStateLabels[s]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {rule.type === "no_activity" ? "Days without a comment" : "Grace period (days)"}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={rule.days ?? 0}
                    onChange={(e) => update(idx, { days: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-8 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Severity</Label>
                <Select value={rule.severity} onValueChange={(v) => update(idx, { severity: v as RiskSeverity })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add rule
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_RISK_RULES)} className="gap-1.5">
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
