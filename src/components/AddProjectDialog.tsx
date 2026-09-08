import { useState } from "react";
import { createDefaultProject, Project, ProjectLinks, ProjectDates, ProjectNotes } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import { CustomFieldsForm } from "./CustomFieldsRenderer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PLATFORM_OPTIONS, INTEGRATION_TYPE_OPTIONS } from "@/data/projectFieldOptions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Calendar, Link2, FileText, Layers } from "lucide-react";
import { DatePickerField } from "@/components/ui/date-picker-field";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (project: Project) => void;
}

export const AddProjectDialog = ({
  open,
  onOpenChange,
  onSave,
}: AddProjectDialogProps) => {
  const { getLabel } = useLabels();
  const { fields: customFields } = useCustomFields();
  const { saveValues } = useCustomFieldValues(undefined);
  const [project, setProject] = useState<Project>(createDefaultProject());
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});

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
    onSave(project);
    if (Object.keys(customDraft).length > 0) {
      await saveValues(project.id, customDraft);
    }
    setProject(createDefaultProject());
    setCustomDraft({});
    onOpenChange(false);
  };

  const handleCancel = () => {
    setProject(createDefaultProject());
    setCustomDraft({});
    onOpenChange(false);
  };

  const handleCustomFieldChange = (fieldId: string, value: string) => {
    setCustomDraft(prev => ({ ...prev, [fieldId]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <span>Add New Project</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 pr-4">
          <Tabs defaultValue="info" className="w-full">
            <TabsList className={`grid w-full mb-4 ${customFields.length > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
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

            <TabsContent value="info" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="merchantName">{getLabel("field_merchant_name")} *</Label>
                  <Input
                    id="merchantName"
                    value={project.merchantName}
                    onChange={(e) => updateField("merchantName", e.target.value)}
                    placeholder={`Enter ${getLabel("field_merchant_name").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mid">{getLabel("field_mid")} *</Label>
                  <Input
                    id="mid"
                    value={project.mid}
                    onChange={(e) => updateField("mid", e.target.value)}
                    placeholder={`Enter ${getLabel("field_mid")}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="platform">{getLabel("field_platform")}</Label>
                  <Select
                    value={project.platform}
                    onValueChange={(v) => updateField("platform", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {PLATFORM_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">{getLabel("field_category")}</Label>
                  <Input
                    id="category"
                    value={project.category}
                    onChange={(e) => updateField("category", e.target.value)}
                    placeholder={`Enter ${getLabel("field_category").toLowerCase()}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="arr">{getLabel("field_arr")}</Label>
                  <Input
                    id="arr"
                    type="number"
                    step="0.01"
                    value={project.arr}
                    onChange={(e) => updateField("arr", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="txnsPerDay">{getLabel("field_txns_per_day")}</Label>
                  <Input
                    id="txnsPerDay"
                    type="number"
                    value={project.txnsPerDay}
                    onChange={(e) => updateField("txnsPerDay", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aov">{getLabel("field_aov")}</Label>
                  <Input
                    id="aov"
                    type="number"
                    value={project.aov}
                    onChange={(e) => updateField("aov", parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="salesSpoc">{getLabel("field_sales_spoc")}</Label>
                  <Input
                    id="salesSpoc"
                    value={project.salesSpoc}
                    onChange={(e) => updateField("salesSpoc", e.target.value)}
                    placeholder={`Enter ${getLabel("field_sales_spoc").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="integrationType">{getLabel("field_integration_type")}</Label>
                  <Select
                    value={project.integrationType}
                    onValueChange={(v) => updateField("integrationType", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {INTEGRATION_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pgOnboarding">{getLabel("field_pg_onboarding")}</Label>
                  <Input
                    id="pgOnboarding"
                    value={project.pgOnboarding}
                    onChange={(e) => updateField("pgOnboarding", e.target.value)}
                    placeholder={`Enter ${getLabel("field_pg_onboarding").toLowerCase()}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goLivePercent">{getLabel("field_go_live_percent")}</Label>
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

              <div className="space-y-2">
                <Label htmlFor="contactEmail">Merchant Contact Email *</Label>
                <Input
                  id="contactEmail"
                  type="text"
                  value={project.contactEmail || ""}
                  onChange={(e) => updateField("contactEmail", e.target.value)}
                  placeholder="merchant@example.com, ops@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Required. Add multiple emails separated by commas — magic links, notifications, and Gmail lookups will go to all of them.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="links" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandUrl">{getLabel("field_brand_url")}</Label>
                <Input
                  id="brandUrl"
                  type="url"
                  value={project.links.brandUrl}
                  onChange={(e) => updateLinks("brandUrl", e.target.value)}
                  placeholder="https://www.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jiraLink">{getLabel("field_jira_link")}</Label>
                <Input
                  id="jiraLink"
                  type="url"
                  value={project.links.jiraLink || ""}
                  onChange={(e) => updateLinks("jiraLink", e.target.value)}
                  placeholder="https://jira.atlassian.net/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brdLink">{getLabel("field_brd_link")}</Label>
                <Input
                  id="brdLink"
                  type="url"
                  value={project.links.brdLink || ""}
                  onChange={(e) => updateLinks("brdLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mintChecklistLink">{getLabel("field_mint_checklist_link")}</Label>
                <Input
                  id="mintChecklistLink"
                  type="url"
                  value={project.links.mintChecklistLink || ""}
                  onChange={(e) => updateLinks("mintChecklistLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="integrationChecklistLink">{getLabel("field_integration_checklist_link")}</Label>
                <Input
                  id="integrationChecklistLink"
                  type="url"
                  value={project.links.integrationChecklistLink || ""}
                  onChange={(e) => updateLinks("integrationChecklistLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sowLink">SOW Link</Label>
                <Input
                  id="sowLink"
                  type="url"
                  value={project.links.sowLink || ""}
                  onChange={(e) => updateLinks("sowLink", e.target.value)}
                  placeholder="https://docs.google.com/..."
                />
              </div>
            </TabsContent>

            <TabsContent value="dates" className="space-y-4">
              <div className="space-y-2">
                <Label>{getLabel("field_kick_off_date")}</Label>
                <DatePickerField
                  value={project.dates.kickOffDate}
                  onChange={(v) => updateDates("kickOffDate", v)}
                  placeholder="Select kick-off date"
                />
              </div>
              <div className="space-y-2">
                <Label>{getLabel("field_expected_go_live_date")}</Label>
                <DatePickerField
                  value={project.dates.expectedGoLiveDate || ""}
                  onChange={(v) => updateDates("expectedGoLiveDate", v)}
                  placeholder="Select expected go-live date"
                />
              </div>
              <div className="space-y-2">
                <Label>{getLabel("field_actual_go_live_date")}</Label>
                <DatePickerField
                  value={project.dates.goLiveDate || ""}
                  onChange={(v) => updateDates("goLiveDate", v)}
                  placeholder="Select go-live date"
                />
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mintNotes">{getLabel("field_mint_notes")}</Label>
                <Textarea
                  id="mintNotes"
                  value={project.notes.mintNotes || ""}
                  onChange={(e) => updateNotes("mintNotes", e.target.value)}
                  placeholder={`Add ${getLabel("field_mint_notes").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectNotes">{getLabel("field_project_notes")}</Label>
                <Textarea
                  id="projectNotes"
                  value={project.notes.projectNotes || ""}
                  onChange={(e) => updateNotes("projectNotes", e.target.value)}
                  placeholder={`Add ${getLabel("field_project_notes").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currentPhaseComment">{getLabel("field_current_phase_comment")}</Label>
                <Textarea
                  id="currentPhaseComment"
                  value={project.notes.currentPhaseComment || ""}
                  onChange={(e) => updateNotes("currentPhaseComment", e.target.value)}
                  placeholder={`Add ${getLabel("field_current_phase_comment").toLowerCase()}...`}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phase2Comment">{getLabel("field_phase2_comment")}</Label>
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
              <TabsContent value="custom" className="space-y-4">
                <CustomFieldsForm
                  fields={customFields}
                  values={customDraft}
                  onChange={handleCustomFieldChange}
                />
              </TabsContent>
            )}
          </Tabs>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!project.merchantName.trim() || !project.mid.trim() || !emailsValid(project.contactEmail || "")}>
            Add Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};