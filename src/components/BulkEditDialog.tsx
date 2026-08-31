import { useState, useEffect } from "react";
import { Project, ProjectState, projectStateLabels } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Calendar, Link2, FileText, Pencil, Layers } from "lucide-react";

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSave: (updates: Partial<BulkFieldUpdates>, customFieldUpdates?: Record<string, string>) => void;
}

export interface BulkFieldUpdates {
  // Info
  platform: string;
  category: string;
  arr: number;
  txnsPerDay: number;
  aov: number;
  salesSpoc: string;
  integrationType: string;
  pgOnboarding: string;
  goLivePercent: number;
  projectState: ProjectState;
  // Links
  brandUrl: string;
  jiraLink: string;
  brdLink: string;
  mintChecklistLink: string;
  integrationChecklistLink: string;
  // Dates
  kickOffDate: string;
  expectedGoLiveDate: string;
  goLiveDate: string;
  // Notes
  mintNotes: string;
  projectNotes: string;
  currentPhaseComment: string;
  phase2Comment: string;
}

type FieldKey = keyof BulkFieldUpdates;

const EMPTY_VALUES: BulkFieldUpdates = {
  platform: "Custom",
  category: "",
  arr: 0,
  txnsPerDay: 0,
  aov: 0,
  salesSpoc: "",
  integrationType: "Standard",
  pgOnboarding: "",
  goLivePercent: 0,
  projectState: "in_progress",
  brandUrl: "",
  jiraLink: "",
  brdLink: "",
  mintChecklistLink: "",
  integrationChecklistLink: "",
  kickOffDate: "",
  expectedGoLiveDate: "",
  goLiveDate: "",
  mintNotes: "",
  projectNotes: "",
  currentPhaseComment: "",
  phase2Comment: "",
};

export const BulkEditDialog = ({
  open,
  onOpenChange,
  selectedCount,
  onSave,
}: BulkEditDialogProps) => {
  const { getLabel, stateLabels } = useLabels();
  const { fields: customFieldDefs } = useCustomFields();
  const [enabledFields, setEnabledFields] = useState<Set<FieldKey>>(new Set());
  const [values, setValues] = useState<BulkFieldUpdates>({ ...EMPTY_VALUES });
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [enabledCustomFields, setEnabledCustomFields] = useState<Set<string>>(new Set());

  const toggleField = (field: FieldKey) => {
    setEnabledFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const toggleCustomField = (fieldId: string) => {
    setEnabledCustomFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  };

  const updateValue = <K extends FieldKey>(field: K, value: BulkFieldUpdates[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const updates: Partial<BulkFieldUpdates> = {};
    enabledFields.forEach((field) => {
      (updates as any)[field] = values[field];
    });
    const cfUpdates: Record<string, string> = {};
    enabledCustomFields.forEach((fieldId) => {
      cfUpdates[fieldId] = customFieldValues[fieldId] || "";
    });
    onSave(updates, Object.keys(cfUpdates).length > 0 ? cfUpdates : undefined);
    onOpenChange(false);
    setEnabledFields(new Set());
    setValues({ ...EMPTY_VALUES });
    setCustomFieldValues({});
    setEnabledCustomFields(new Set());
  };

  const renderField = (
    field: FieldKey,
    label: string,
    input: React.ReactNode
  ) => (
    <div key={field} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
      <Checkbox
        checked={enabledFields.has(field)}
        onCheckedChange={() => toggleField(field)}
        className="mt-1"
      />
      <div className={`flex-1 space-y-1.5 ${!enabledFields.has(field) ? "opacity-40 pointer-events-none" : ""}`}>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {input}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Pencil className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span>Bulk Edit Projects</span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                Update {selectedCount} selected project(s)
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>
            Check the fields you want to update. Only checked fields will be applied to all selected projects.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-2">
          <Tabs defaultValue="info" className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="info" className="gap-1 text-xs">
                <Building2 className="h-3 w-3" />
                Info
              </TabsTrigger>
              <TabsTrigger value="links" className="gap-1 text-xs">
                <Link2 className="h-3 w-3" />
                Links
              </TabsTrigger>
              <TabsTrigger value="dates" className="gap-1 text-xs">
                <Calendar className="h-3 w-3" />
                Dates
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-1 text-xs">
                <FileText className="h-3 w-3" />
                Notes
              </TabsTrigger>
              {customFieldDefs.length > 0 && (
                <TabsTrigger value="custom" className="gap-1 text-xs">
                  <Layers className="h-3 w-3" />
                  Custom
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="info" className="space-y-1">
              {renderField("projectState", "Project State",
                <Select value={values.projectState} onValueChange={(v) => updateValue("projectState", v as ProjectState)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(projectStateLabels) as ProjectState[]).map(s => (
                      <SelectItem key={s} value={s}>{stateLabels[s] || projectStateLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {renderField("platform", getLabel("field_platform"),
                <Select value={values.platform} onValueChange={(v) => updateValue("platform", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Custom">Custom</SelectItem>
                    <SelectItem value="Shopify">Shopify</SelectItem>
                    <SelectItem value="Magento">Magento</SelectItem>
                    <SelectItem value="WooCommerce">WooCommerce</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {renderField("category", getLabel("field_category"),
                <Input value={values.category} onChange={(e) => updateValue("category", e.target.value)} />
              )}
              {renderField("arr", getLabel("field_arr"),
                <Input type="number" step="0.01" value={values.arr} onChange={(e) => updateValue("arr", parseFloat(e.target.value) || 0)} />
              )}
              {renderField("txnsPerDay", getLabel("field_txns_per_day"),
                <Input type="number" value={values.txnsPerDay} onChange={(e) => updateValue("txnsPerDay", parseInt(e.target.value) || 0)} />
              )}
              {renderField("aov", getLabel("field_aov"),
                <Input type="number" value={values.aov} onChange={(e) => updateValue("aov", parseInt(e.target.value) || 0)} />
              )}
              {renderField("salesSpoc", getLabel("field_sales_spoc"),
                <Input value={values.salesSpoc} onChange={(e) => updateValue("salesSpoc", e.target.value)} />
              )}
              {renderField("integrationType", getLabel("field_integration_type"),
                <Select value={values.integrationType} onValueChange={(v) => updateValue("integrationType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Standard">Standard</SelectItem>
                    <SelectItem value="Advanced">Advanced</SelectItem>
                    <SelectItem value="Enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {renderField("pgOnboarding", getLabel("field_pg_onboarding"),
                <Input value={values.pgOnboarding} onChange={(e) => updateValue("pgOnboarding", e.target.value)} />
              )}
              {renderField("goLivePercent", getLabel("field_go_live_percent"),
                <Input type="number" min="0" max="100" value={values.goLivePercent} onChange={(e) => updateValue("goLivePercent", parseInt(e.target.value) || 0)} />
              )}
            </TabsContent>

            <TabsContent value="links" className="space-y-1">
              {renderField("brandUrl", getLabel("field_brand_url"),
                <Input type="url" value={values.brandUrl} onChange={(e) => updateValue("brandUrl", e.target.value)} />
              )}
              {renderField("jiraLink", getLabel("field_jira_link"),
                <Input type="url" value={values.jiraLink} onChange={(e) => updateValue("jiraLink", e.target.value)} />
              )}
              {renderField("brdLink", getLabel("field_brd_link"),
                <Input type="url" value={values.brdLink} onChange={(e) => updateValue("brdLink", e.target.value)} />
              )}
              {renderField("mintChecklistLink", getLabel("field_mint_checklist_link"),
                <Input type="url" value={values.mintChecklistLink} onChange={(e) => updateValue("mintChecklistLink", e.target.value)} />
              )}
              {renderField("integrationChecklistLink", getLabel("field_integration_checklist_link"),
                <Input type="url" value={values.integrationChecklistLink} onChange={(e) => updateValue("integrationChecklistLink", e.target.value)} />
              )}
            </TabsContent>

            <TabsContent value="dates" className="space-y-1">
              {renderField("kickOffDate", getLabel("field_kick_off_date"),
                <Input type="date" value={values.kickOffDate} onChange={(e) => updateValue("kickOffDate", e.target.value)} />
              )}
              {renderField("expectedGoLiveDate", getLabel("field_expected_go_live_date"),
                <Input type="date" value={values.expectedGoLiveDate} onChange={(e) => updateValue("expectedGoLiveDate", e.target.value)} />
              )}
              {renderField("goLiveDate", getLabel("field_actual_go_live_date"),
                <Input type="date" value={values.goLiveDate} onChange={(e) => updateValue("goLiveDate", e.target.value)} />
              )}
            </TabsContent>

            <TabsContent value="notes" className="space-y-1">
              {renderField("mintNotes", getLabel("field_mint_notes"),
                <Textarea value={values.mintNotes} onChange={(e) => updateValue("mintNotes", e.target.value)} rows={2} />
              )}
              {renderField("projectNotes", getLabel("field_project_notes"),
                <Textarea value={values.projectNotes} onChange={(e) => updateValue("projectNotes", e.target.value)} rows={2} />
              )}
              {renderField("currentPhaseComment", getLabel("field_current_phase_comment"),
                <Textarea value={values.currentPhaseComment} onChange={(e) => updateValue("currentPhaseComment", e.target.value)} rows={2} />
              )}
              {renderField("phase2Comment", getLabel("field_phase2_comment"),
                <Textarea value={values.phase2Comment} onChange={(e) => updateValue("phase2Comment", e.target.value)} rows={2} />
              )}
            </TabsContent>

            {customFieldDefs.length > 0 && (
              <TabsContent value="custom" className="space-y-1">
                {customFieldDefs.map((field) => (
                  <div key={field.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={enabledCustomFields.has(field.id)}
                      onCheckedChange={() => toggleCustomField(field.id)}
                      className="mt-1"
                    />
                    <div className={`flex-1 space-y-1.5 ${!enabledCustomFields.has(field.id) ? "opacity-40 pointer-events-none" : ""}`}>
                      <Label className="text-xs text-muted-foreground">{field.field_label}</Label>
                      {field.field_type === "select" ? (
                        <Select value={customFieldValues[field.id] || ""} onValueChange={(v) => setCustomFieldValues(prev => ({ ...prev, [field.id]: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            {field.options.map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.field_type === "boolean" ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Switch
                            checked={customFieldValues[field.id] === "true"}
                            onCheckedChange={(c) => setCustomFieldValues(prev => ({ ...prev, [field.id]: c ? "true" : "false" }))}
                          />
                          <span className="text-sm text-muted-foreground">{customFieldValues[field.id] === "true" ? "Yes" : "No"}</span>
                        </div>
                      ) : (
                        <Input
                          type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "url" ? "url" : "text"}
                          value={customFieldValues[field.id] || ""}
                          onChange={(e) => setCustomFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          placeholder={`Enter ${field.field_label.toLowerCase()}`}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </TabsContent>
            )}
          </Tabs>
        </div>

        <DialogFooter className="gap-2">
          <p className="text-xs text-muted-foreground mr-auto">
            {enabledFields.size + enabledCustomFields.size} field(s) selected
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={enabledFields.size === 0 && enabledCustomFields.size === 0}>
            Update {selectedCount} Project(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
