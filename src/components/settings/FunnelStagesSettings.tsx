import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChecklistTemplateTitles } from "@/hooks/useLookups";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";
import {
  DEFAULT_FUNNEL_STAGES,
  FUNNEL_MATCH_LABELS,
  FunnelMatchType,
  FunnelStageRule,
} from "@/data/funnelConfig";
import { projectStateLabels, ProjectState } from "@/data/projectsData";

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "stage";

/** Multi-select list of the organisation's checklist item titles. */
const ChecklistTitlePicker = ({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (titles: string[]) => void;
}) => {
  const { titlesToId, isLoading } = useChecklistTemplateTitles();
  const [search, setSearch] = useState("");

  const available = Object.keys(titlesToId).sort((a, b) => a.localeCompare(b));
  const lowerAvailable = available.map((t) => t.toLowerCase());
  // Keep previously saved values that no longer match a template title
  const extras = selected.filter((s) => !lowerAvailable.includes(s.toLowerCase()));
  const options = [...available, ...extras];
  const filtered = options.filter((t) => t.toLowerCase().includes(search.toLowerCase()));

  const isChecked = (title: string) => selected.some((s) => s.toLowerCase() === title.toLowerCase());
  const toggle = (title: string) =>
    onChange(
      isChecked(title)
        ? selected.filter((s) => s.toLowerCase() !== title.toLowerCase())
        : [...selected, title]
    );

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading checklist items…</p>;

  return (
    <div className="rounded-md border">
      <div className="border-b p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search checklist items…"
          className="h-8 text-xs"
        />
      </div>
      <ScrollArea className="h-40">
        <div className="p-2 space-y-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-2">No checklist items found.</p>
          )}
          {filtered.map((title) => (
            <label
              key={title}
              className="flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/60 cursor-pointer"
            >
              <Checkbox
                checked={isChecked(title)}
                onCheckedChange={() => toggle(title)}
                className="mt-0.5"
              />
              <span className="leading-snug">{title}</span>
            </label>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
        {selected.length} selected
      </div>
    </div>
  );
};


export const FunnelStagesSettings = () => {
  const { stages, isLoading, saveStages } = useFunnelConfig();
  const [draft, setDraft] = useState<FunnelStageRule[]>(stages);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(stages); }, [stages]);

  const update = (idx: number, patch: Partial<FunnelStageRule>) =>
    setDraft((d) => d.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const move = (idx: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const normalized = draft.map((s) => ({ ...s, id: s.id || slug(s.label) }));
      await saveStages(normalized);
      toast.success("Project stages saved for this organisation");
    } catch (e: any) {
      toast.error(`Could not save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading project stage configuration…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="portal-heading">Project Stages</CardTitle>
          <CardDescription>
            Stages are evaluated top to bottom — the first matching rule wins. Projects that match nothing show as “None”.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.map((stage, idx) => (
            <div key={idx} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-6">{idx + 1}</span>
                <Input
                  value={stage.label}
                  onChange={(e) => update(idx, { label: e.target.value, id: stage.id || slug(e.target.value) })}
                  placeholder="Stage name"
                  className="max-w-xs"
                />
                <div className="ml-auto flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === draft.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDraft((d) => d.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Condition</Label>
                  <Select value={stage.matchType} onValueChange={(v) => update(idx, { matchType: v as FunnelMatchType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FUNNEL_MATCH_LABELS) as FunnelMatchType[]).map((m) => (
                        <SelectItem key={m} value={m}>{FUNNEL_MATCH_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {stage.matchType === "project_state" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Project states</Label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(Object.keys(projectStateLabels) as ProjectState[]).map((st) => {
                        const active = (stage.projectStates || []).includes(st);
                        return (
                          <Button
                            key={st}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className="h-7 text-xs"
                            onClick={() =>
                              update(idx, {
                                projectStates: active
                                  ? (stage.projectStates || []).filter((x) => x !== st)
                                  : [...(stage.projectStates || []), st],
                              })
                            }
                          >
                            {projectStateLabels[st]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Checklist items</Label>
                    <ChecklistTitlePicker
                      selected={stage.titles || []}
                      onChange={(titles) => update(idx, { titles })}
                    />
                  </div>
                )}

              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft((d) => [...d, { id: "", label: "New Stage", matchType: "any_completed", titles: [] }])}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add stage
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_FUNNEL_STAGES)} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5 ml-auto">
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save project stages"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
