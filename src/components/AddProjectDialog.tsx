import { useState, useMemo } from "react";
import {
  createDefaultProject,
  Project,
  ProjectLinks,
  ProjectDates,
  ProjectNotes,
} from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import {
  useChecklistSets,
  type ChecklistSet,
  type ChecklistSetRule,
} from "@/hooks/useChecklistSets";
import { CustomFieldsForm } from "./CustomFieldsRenderer";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_OPTIONS, INTEGRATION_TYPE_OPTIONS } from "@/data/projectFieldOptions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Calendar, Link2, FileText, Layers, ListChecks } from "lucide-react";
import { DatePickerField } from "@/components/ui/date-picker-field";

function resolveChecklistSet(
  sets: ChecklistSet[],
  rules: ChecklistSetRule[],
  project: { platform: string; category: string; integrationType: string; pgOnboarding: string },
): ChecklistSet | null {
  type Candidate = { set: ChecklistSet; matchCount: number };
  let best: Candidate | null = null;

  for (const set of sets) {
    const setRules = rules.filter((r) => r.checklist_set_id === set.id);
    let allMatch = true;
    let matchCount = 0;

    for (const rule of setRules) {
      let val: string | null = null;
      if (rule.field === "platform") val = project.platform;
      else if (rule.field === "category") val = project.category;
      else if (rule.field === "integration_type") val = project.integrationType;
      else if (rule.field === "pg_onboarding") val = project.pgOnboarding;

      let ruleMatch = false;
      if (rule.operator === "eq") ruleMatch = val === rule.value;
      else if (rule.operator === "not_eq") ruleMatch = val !== rule.value;
      else if (rule.operator === "in") {
        try {
          const arr = JSON.parse(rule.value) as string[];
          ruleMatch = arr.includes(val ?? "");
        } catch {
          ruleMatch = false;
        }
      }

      if (!ruleMatch) {
        allMatch = false;
        break;
      }
      matchCount++;
    }

    if (allMatch) {
      const isBetter =
        !best ||
        matchCount > best.matchCount ||
        (matchCount === best.matchCount && !set.is_default && best.set.is_default);
      if (isBetter) best = { set, matchCount };
    }
  }

  if (best) return best.set;
  return sets.find((s) => s.is_default) ?? sets[0] ?? null;
}

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (project: Project) => void;
}

export const AddProjectDialog = ({ open, onOpenChange, onSave }: AddProjectDialogProps) => {
  const { getLabel } = useLabels();
  const { fields: customFields } = useCustomFields();
  const { saveValues } = useCustomFieldValues(undefined);
  const { sets, rules } = useChecklistSets();
  const [project, setProject] = useState<Project>(createDefaultProject());
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [checklistSetOverride, setChecklistSetOverride] = useState<string>("__auto__");

  const autoSet = useMemo(
    () =>
      resolveChecklistSet(sets, rules, {
        platform: project.platform,
        category: project.category,
        integrationType: project.integrationType,
        pgOnboarding: project.pgOnboarding,
      }),
    [
      sets,
      rules,
      project.platform,
      project.category,
      project.integrationType,
      project.pgOnboarding,
    ],
  );

  const updateField = <K extends keyof Project>(field: K, value: Project[K]) => {
    setProject((prev) => ({ ...prev, [field]: value }));
  };

  const updateLinks = (field: keyof ProjectLinks, value: string) => {
    setProject((prev) => ({
      ...prev,
      links: { ...prev.links, [field]: value },
    }));
  };

  const updateDates = (field: keyof ProjectDates, value: string) => {
    setProject((prev) => ({
      ...prev,
      dates: { ...prev.dates, [field]: value },
    }));
  };

  const updateNotes = (field: keyof ProjectNotes, value: string) => {
    setProject((prev) => ({
      ...prev,
      notes: { ...prev.notes, [field]: value },
    }));
  };

  const parseEmails = (raw: string) =>
    (raw || "")
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  const emailsValid = (raw: string) => {
    const list = parseEmails(raw);
    if (list.length === 0) return false;
    return list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  };

  const handleSave = async () => {
    if (!project.merchantName.trim() || !project.mid.trim()) {
      return;
    }
    if (!emailsValid(project.contactEmail || "")) {
      return;
    }
    const effectiveSetId =
      checklistSetOverride !== "__auto__" ? checklistSetOverride : (autoSet?.id ?? null);
    onSave({ ...project, checklistSetId: effectiveSetId ?? undefined } as Project);
    if (Object.keys(customDraft).length > 0) {
      await saveValues(project.id, customDraft);
    }
    setProject(createDefaultProject());
    setCustomDraft({});
    setChecklistSetOverride("__auto__");
    onOpenChange(false);
  };

  const handleCancel = () => {
    setProject(createDefaultProject());
    setCustomDraft({});
    setChecklistSetOverride("__auto__");
    onOpenChange(false);
  };

  const handleCustomFieldChange = (fieldId: string, value: string) => {
    setCustomDraft((prev) => ({ ...prev, [fieldId]: value }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="shrink-0 space-y-0 border-b px-6 py-4 text-left">
          <SheetTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <span>Add New Project</span>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          <Tabs defaultValue="info" className="w-full">
            <TabsList
              className={`grid w-full mb-4 ${customFields.length > 0 ? "grid-cols-5" : "grid-cols-4"}`}
            >
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
              {customFields.length > 0 && (
                <TabsTrigger value="custom" className="gap-1 text-xs">
                  <Layers className="h-3 w-3" />
                  Custom
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="info" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="merchantName"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {getLabel("field_merchant_name")} *
                  </Label>
                  <Input
                    id="merchantName"
                    value={project.merchantName}
                    onChange={(e) => updateField("merchantName", e.target.value)}
                    placeholder={`Enter ${getLabel("field_merchant_name").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mid" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_mid")} *
                  </Label>
                  <Input
                    id="mid"
                    value={project.mid}
                    onChange={(e) => updateField("mid", e.target.value)}
                    placeholder={`Enter ${getLabel("field_mid")}`}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contactEmail" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_contact_email")} *
                </Label>
                <Input
                  id="contactEmail"
                  type="text"
                  value={project.contactEmail || ""}
                  onChange={(e) => updateField("contactEmail", e.target.value)}
                  placeholder="merchant@example.com, ops@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Required. Add multiple emails separated by commas — magic links, notifications,
                  and Gmail lookups will go to all of them.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="platform" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_platform")}
                  </Label>
                  <Select
                    value={project.platform}
                    onValueChange={(v) => updateField("platform", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {PLATFORM_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_category")}
                  </Label>
                  <Input
                    id="category"
                    value={project.category}
                    onChange={(e) => updateField("category", e.target.value)}
                    placeholder={`Enter ${getLabel("field_category").toLowerCase()}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="arr" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_arr")}
                  </Label>
                  <Input
                    id="arr"
                    type="number"
                    step="0.01"
                    value={project.arr}
                    onChange={(e) => updateField("arr", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txnsPerDay" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_txns_per_day")}
                  </Label>
                  <Input
                    id="txnsPerDay"
                    type="number"
                    value={project.txnsPerDay}
                    onChange={(e) => updateField("txnsPerDay", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aov" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_aov")}
                  </Label>
                  <Input
                    id="aov"
                    type="number"
                    value={project.aov}
                    onChange={(e) => updateField("aov", parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="salesSpoc" className="text-xs font-medium text-muted-foreground">
                    {getLabel("field_sales_spoc")}
                  </Label>
                  <Input
                    id="salesSpoc"
                    value={project.salesSpoc}
                    onChange={(e) => updateField("salesSpoc", e.target.value)}
                    placeholder={`Enter ${getLabel("field_sales_spoc").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="integrationType"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {getLabel("field_integration_type")}
                  </Label>
                  <Select
                    value={project.integrationType}
                    onValueChange={(v) => updateField("integrationType", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {INTEGRATION_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="pgOnboarding"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {getLabel("field_pg_onboarding")}
                  </Label>
                  <Input
                    id="pgOnboarding"
                    value={project.pgOnboarding}
                    onChange={(e) => updateField("pgOnboarding", e.target.value)}
                    placeholder={`Enter ${getLabel("field_pg_onboarding").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="goLivePercent"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {getLabel("field_go_live_percent")}
                  </Label>
                  <Input
                    id="goLivePercent"
                    type="number"
                    min={0}
                    max={100}
                    value={project.goLivePercent || 0}
                    onChange={(e) => updateField("goLivePercent", Number(e.target.value))}
                    placeholder="0"
                  />
                </div>
              </div>

              {sets.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-xs font-medium text-muted-foreground">
                      Checklist Set
                    </Label>
                  </div>
                  <Select value={checklistSetOverride} onValueChange={setChecklistSetOverride}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__" className="text-xs">
                        Auto-assign{autoSet ? ` — ${autoSet.name}` : ""}
                      </SelectItem>
                      {sets.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">
                          {s.name}
                          {s.is_default && (
                            <Badge variant="secondary" className="ml-1.5 text-2xs">
                              default
                            </Badge>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {checklistSetOverride === "__auto__" && autoSet && (
                    <p className="text-2xs text-muted-foreground">
                      Based on current fields: <span className="font-medium">{autoSet.name}</span>
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="links" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="brandUrl" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_brand_url")}
                </Label>
                <Input
                  id="brandUrl"
                  type="url"
                  value={project.links.brandUrl}
                  onChange={(e) => updateLinks("brandUrl", e.target.value)}
                  placeholder="https://www.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jiraLink" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_jira_link")}
                </Label>
                <Input
                  id="jiraLink"
                  type="url"
                  value={project.links.jiraLink || ""}
                  onChange={(e) => updateLinks("jiraLink", e.target.value)}
                  placeholder="https://jira.atlassian.net/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brdLink" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_brd_link")}
                </Label>
                <Input
                  id="brdLink"
                  type="url"
                  value={project.links.brdLink || ""}
                  onChange={(e) => updateLinks("brdLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="mintChecklistLink"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {getLabel("field_mint_checklist_link")}
                </Label>
                <Input
                  id="mintChecklistLink"
                  type="url"
                  value={project.links.mintChecklistLink || ""}
                  onChange={(e) => updateLinks("mintChecklistLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="integrationChecklistLink"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {getLabel("field_integration_checklist_link")}
                </Label>
                <Input
                  id="integrationChecklistLink"
                  type="url"
                  value={project.links.integrationChecklistLink || ""}
                  onChange={(e) => updateLinks("integrationChecklistLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sowLink" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_sow_link")}
                </Label>
                <Input
                  id="sowLink"
                  type="url"
                  value={project.links.sowLink || ""}
                  onChange={(e) => updateLinks("sowLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
            </TabsContent>

            <TabsContent value="dates" className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_kick_off_date")}
                </Label>
                <DatePickerField
                  value={project.dates.kickOffDate}
                  onChange={(v) => updateDates("kickOffDate", v)}
                  placeholder="Select kick-off date"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_expected_go_live_date")}
                </Label>
                <DatePickerField
                  value={project.dates.expectedGoLiveDate || ""}
                  onChange={(v) => updateDates("expectedGoLiveDate", v)}
                  placeholder="Select expected go-live date"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_actual_go_live_date")}
                </Label>
                <DatePickerField
                  value={project.dates.goLiveDate || ""}
                  onChange={(v) => updateDates("goLiveDate", v)}
                  placeholder="Select go-live date"
                />
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mintNotes" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_mint_notes")}
                </Label>
                <Textarea
                  id="mintNotes"
                  value={project.notes.mintNotes || ""}
                  onChange={(e) => updateNotes("mintNotes", e.target.value)}
                  placeholder={`Add ${getLabel("field_mint_notes").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="projectNotes" className="text-xs font-medium text-muted-foreground">
                  {getLabel("field_project_notes")}
                </Label>
                <Textarea
                  id="projectNotes"
                  value={project.notes.projectNotes || ""}
                  onChange={(e) => updateNotes("projectNotes", e.target.value)}
                  placeholder={`Add ${getLabel("field_project_notes").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="currentPhaseComment"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {getLabel("field_current_phase_comment")}
                </Label>
                <Textarea
                  id="currentPhaseComment"
                  value={project.notes.currentPhaseComment || ""}
                  onChange={(e) => updateNotes("currentPhaseComment", e.target.value)}
                  placeholder={`Add ${getLabel("field_current_phase_comment").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="phase2Comment"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {getLabel("field_phase2_comment")}
                </Label>
                <Textarea
                  id="phase2Comment"
                  value={project.notes.phase2Comment || ""}
                  onChange={(e) => updateNotes("phase2Comment", e.target.value)}
                  placeholder={`Add ${getLabel("field_phase2_comment").toLowerCase()}...`}
                  rows={2}
                />
              </div>
            </TabsContent>

            {customFields.length > 0 && (
              <TabsContent value="custom" className="space-y-3">
                <CustomFieldsForm
                  fields={customFields}
                  values={customDraft}
                  onChange={handleCustomFieldChange}
                />
              </TabsContent>
            )}
          </Tabs>
        </ScrollArea>

        <SheetFooter className="shrink-0 gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !project.merchantName.trim() ||
              !project.mid.trim() ||
              !emailsValid(project.contactEmail || "")
            }
          >
            Add Project
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
