import { useState } from "react";
import {
  useChecklistSets,
  RULE_FIELDS,
  RULE_OPERATORS,
  type ChecklistSet,
  type ChecklistSetRule,
} from "@/hooks/useChecklistSets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Trash2, Star, StarOff, ChevronRight, X } from "lucide-react";

// ─── Rule row ────────────────────────────────────────────────────────────────

const RuleRow = ({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: ChecklistSetRule;
  onUpdate: (id: string, patch: Partial<ChecklistSetRule>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) => {
  const [field, setField] = useState(rule.field);
  const [operator, setOperator] = useState(rule.operator);
  const [value, setValue] = useState(rule.value);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(rule.id, { field, operator, value });
    setSaving(false);
  };

  const isDirty = field !== rule.field || operator !== rule.operator || value !== rule.value;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
      <Select value={field} onValueChange={setField}>
        <SelectTrigger className="h-7 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_FIELDS.map((f) => (
            <SelectItem key={f.value} value={f.value} className="text-xs">
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={operator} onValueChange={setOperator}>
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_OPERATORS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="h-7 flex-1 text-xs"
        placeholder={operator === "in" ? '["val1","val2"]' : "value"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />

      {isDirty && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={handleSave}
          disabled={saving}
        >
          Save
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(rule.id)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

// ─── Set detail panel ─────────────────────────────────────────────────────────

const SetDetail = ({
  set,
  rules,
  onUpdate,
  onDelete,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onSetDefault,
}: {
  set: ChecklistSet;
  rules: ChecklistSetRule[];
  onUpdate: (id: string, patch: Partial<ChecklistSet>) => Promise<void>;
  onDelete: (id: string) => void;
  onAddRule: (setId: string, field: string, operator: string, value: string) => Promise<void>;
  onUpdateRule: (id: string, patch: Partial<ChecklistSetRule>) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}) => {
  const [name, setName] = useState(set.name);
  const [description, setDescription] = useState(set.description ?? "");
  const [nameDirty, setNameDirty] = useState(false);

  const [newField, setNewField] = useState<string>(RULE_FIELDS[0].value);
  const [newOp, setNewOp] = useState<string>(RULE_OPERATORS[0].value);
  const [newVal, setNewVal] = useState("");
  const [addingRule, setAddingRule] = useState(false);

  const handleSaveName = async () => {
    if (!name.trim()) return;
    await onUpdate(set.id, { name: name.trim(), description: description.trim() || null });
    setNameDirty(false);
    toast.success("Set updated");
  };

  const handleAddRule = async () => {
    if (!newVal.trim()) return;
    setAddingRule(true);
    await onAddRule(set.id, newField, newOp, newVal.trim());
    setNewVal("");
    setAddingRule(false);
    toast.success("Rule added");
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Name + description */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{set.name}</h3>
          <div className="flex items-center gap-1">
            {set.is_default ? (
              <Badge variant="secondary" className="gap-1 text-2xs">
                <Star className="h-2.5 w-2.5" /> Default
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-2xs text-muted-foreground"
                onClick={() => onSetDefault(set.id)}
              >
                <StarOff className="h-3 w-3" /> Make default
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(set.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Name</Label>
            <Input
              className="h-7 text-xs"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameDirty(true);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              className="min-h-[52px] resize-none text-xs"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setNameDirty(true);
              }}
              placeholder="Optional description"
            />
          </div>
          {nameDirty && (
            <Button size="sm" className="h-7 self-end text-xs" onClick={handleSaveName}>
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Rules */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Assignment Rules</p>
          <span className="text-2xs text-muted-foreground">All rules must match (AND)</span>
        </div>

        <div className="flex flex-col gap-1.5">
          {rules.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              No rules — this set matches any project (catch-all).
            </p>
          )}
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} onUpdate={onUpdateRule} onDelete={onDeleteRule} />
          ))}
        </div>

        {/* Add rule row */}
        <div className="mt-2 flex items-center gap-2">
          <Select value={newField} onValueChange={setNewField}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_FIELDS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={newOp} onValueChange={setNewOp}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_OPERATORS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="h-7 flex-1 text-xs"
            placeholder={newOp === "in" ? '["Shopify","WooCommerce"]' : "value"}
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRule()}
          />

          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleAddRule}
            disabled={addingRule || !newVal.trim()}
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── Main manager ─────────────────────────────────────────────────────────────

export const ChecklistSetsManager = () => {
  const {
    sets,
    rules,
    isLoading,
    createSet,
    updateSet,
    deleteSet,
    addRule,
    updateRule,
    deleteRule,
  } = useChecklistSets();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChecklistSet | null>(null);

  const selected = sets.find((s) => s.id === selectedId) ?? sets[0] ?? null;
  const selectedRules = rules.filter((r) => r.checklist_set_id === (selected?.id ?? ""));

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const created = await createSet(newName.trim(), newDesc.trim() || undefined);
    if (created) {
      toast.success(`"${created.name}" created`);
      setSelectedId(created.id);
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteSet(deleteTarget.id);
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
    setSelectedId(null);
  };

  const handleSetDefault = async (id: string) => {
    await updateSet(id, { is_default: true });
    toast.success("Default set updated");
  };

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checklist Sets</CardTitle>
          <CardDescription>
            Create named checklist sets and assign them to projects automatically using field-based
            rules. The set with the most matching rules is assigned; the Default set is the
            fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex min-h-[480px] divide-x divide-border">
            {/* Set list */}
            <div className="flex w-56 shrink-0 flex-col">
              <div className="border-b border-border px-3 py-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full gap-1.5 text-xs"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> New set
                </Button>
              </div>
              <div className="flex-1 overflow-auto">
                {sets.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No sets yet.</p>
                ) : (
                  sets.map((s) => {
                    const isActive = (selected?.id ?? null) === s.id;
                    const setRules = rules.filter((r) => r.checklist_set_id === s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={`flex w-full items-center justify-between gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{s.name}</p>
                          <p className="text-2xs text-muted-foreground">
                            {setRules.length} rule{setRules.length !== 1 ? "s" : ""}
                            {s.is_default && " · default"}
                          </p>
                        </div>
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground ${isActive ? "text-foreground" : ""}`}
                        />
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Detail panel */}
            <div className="flex-1 overflow-auto">
              {selected ? (
                <SetDetail
                  key={selected.id}
                  set={selected}
                  rules={selectedRules}
                  onUpdate={updateSet}
                  onDelete={(id) => setDeleteTarget(sets.find((s) => s.id === id) ?? null)}
                  onAddRule={addRule}
                  onUpdateRule={updateRule}
                  onDeleteRule={deleteRule}
                  onSetDefault={handleSetDefault}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                  Select or create a set to get started.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Checklist Set</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label className="text-xs">Name *</Label>
              <Input
                className="h-8"
                placeholder="e.g. Shopify Standard"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Description</Label>
              <Textarea
                className="min-h-[60px] resize-none text-sm"
                placeholder="Optional"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Templates in this set will be unlinked but not deleted. Projects already using this
              set will keep their existing checklist items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
