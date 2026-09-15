import { useState, useEffect, useRef } from "react";
import { Project, ProjectLinks, ProjectDates, ProjectNotes, ProjectFaqHelp } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import { CustomFieldsForm } from "./CustomFieldsRenderer";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
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
import { Building2, Calendar, Link2, FileText, Pencil, Layers, KeyRound, Upload, Loader2, HelpCircle, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

import { DatePickerField } from "@/components/ui/date-picker-field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EditProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (project: Project) => void;
}

export const EditProjectDialog = ({
  project,
  open,
  onOpenChange,
  onSave,
}: EditProjectDialogProps) => {
  const { getLabel } = useLabels();
  const { currentUser } = useAuth();
  const canManageCredentials = !!currentUser && ["admin", "super_admin", "superadmin"].includes(currentUser.team);
  const { fields: customFields } = useCustomFields();
  const { values: customValues, setValues: setCustomValues, saveValues } = useCustomFieldValues(project?.id);
  const [editedProject, setEditedProject] = useState<Project | null>(null);
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const { toast } = useToast();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Must stay above the `if (!editedProject) return null` below: a hook
  // declared after it runs only on some renders, which is what broke Kanban.
  const faqFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project) {
      setEditedProject({ ...project });
      setCustomDraft({});
    }
  }, [project]);

  if (!editedProject) return null;

  const updateField = <K extends keyof Project>(field: K, value: Project[K]) => {
    setEditedProject((prev) => prev ? { ...prev, [field]: value } : null);
  };

  const updateLinks = (field: keyof ProjectLinks, value: string) => {
    setEditedProject((prev) =>
      prev ? { ...prev, links: { ...prev.links, [field]: value } } : null
    );
  };

  const updateDates = (field: keyof ProjectDates, value: string) => {
    setEditedProject((prev) =>
      prev ? { ...prev, dates: { ...prev.dates, [field]: value } } : null
    );
  };

  const updateNotes = (field: keyof ProjectNotes, value: string) => {
    setEditedProject((prev) =>
      prev ? { ...prev, notes: { ...prev.notes, [field]: value } } : null
    );
  };

  const handleFileUpload = async (linkField: keyof ProjectLinks, dbField: string, file: File) => {
    if (!editedProject) return;
    setUploadingField(dbField);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", editedProject.id);
      formData.append("field", dbField);

      const res = await fetch(
        `/api/public/upload-project-pdf`,
        {
          method: "POST",
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: formData,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      updateLinks(linkField, data.url);
      toast({ title: "File uploaded", description: `${file.name} uploaded successfully.` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingField(null);
    }
  };

  const LinkFieldWithUpload = ({ label, linkField, dbField, value }: { label: string; linkField: keyof ProjectLinks; dbField: string; value: string }) => (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input
          type="url"
          value={value}
          onChange={(e) => updateLinks(linkField, e.target.value)}
          className="flex-1"
          placeholder="Paste URL or upload file"
        />
        <input
          type="file"
          className="hidden"
          ref={(el) => { fileInputRefs.current[dbField] = el; }}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.csv,.txt,.json,.zip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(linkField, dbField, f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={uploadingField === dbField}
          onClick={() => fileInputRefs.current[dbField]?.click()}
          title="Upload file"
        >
          {uploadingField === dbField ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </Button>
      </div>
      {value && (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">
          {value.length > 80 ? value.slice(0, 80) + "…" : value}
        </a>
      )}
    </div>
  );

  const parseEmails = (raw: string) =>
    (raw || "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const emailsValid = (raw: string) => {
    const list = parseEmails(raw);
    if (list.length === 0) return false;
    return list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  };

  const handleSave = async () => {
    if (editedProject) {
      if (!emailsValid(editedProject.contactEmail || "")) {
        toast({ title: "Merchant Contact Email required", description: "Provide one or more valid emails (comma-separated).", variant: "destructive" });
        return;
      }
      const merged = { ...customValues, ...customDraft };
      await saveValues(editedProject.id, merged);
      onSave(editedProject);
      onOpenChange(false);
    }
  };

  const handleCustomFieldChange = (fieldId: string, value: string) => {
    setCustomDraft(prev => ({ ...prev, [fieldId]: value }));
  };

  const updateFaqHelp = (items: ProjectFaqHelp[]) => {
    updateField("faqHelp", items.map(item => ({ ...item, updatedAt: new Date().toISOString() })));
  };

  /**
   * Bulk import. Entering FAQs one pair at a time does not scale past a
   * handful, and these are usually drafted in a sheet or doc first. Accepts a
   * two-column CSV (question, answer) or a JSON array; imported FAQs are
   * appended, so nothing already entered is lost.
   */
  const parseFaqCsv = (text: string): Array<{ question: string; answer: string }> => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

    // Drop a header row only when it actually looks like one.
    if (rows.length && /^\s*question\s*$/i.test(rows[0][0] || "")) rows.shift();
    return rows
      .map((r) => ({ question: (r[0] || "").trim(), answer: (r[1] || "").trim() }))
      .filter((r) => r.question && r.answer);
  };

  const handleFaqUpload = async (file: File) => {
    try {
      const text = await file.text();
      let parsed: Array<{ question: string; answer: string }>;
      if (file.name.toLowerCase().endsWith(".json")) {
        const raw = JSON.parse(text);
        if (!Array.isArray(raw)) throw new Error("JSON must be an array of { question, answer }");
        parsed = raw
          .map((r: any) => ({ question: String(r?.question ?? "").trim(), answer: String(r?.answer ?? "").trim() }))
          .filter((r) => r.question && r.answer);
      } else {
        parsed = parseFaqCsv(text);
      }
      if (parsed.length === 0) {
        toast({ title: "Nothing imported", description: "Expected question and answer columns.", variant: "destructive" });
        return;
      }
      const now = new Date().toISOString();
      updateField("faqHelp", [
        ...(editedProject.faqHelp ?? []),
        ...parsed.map((r, i) => ({ id: `faq-${Date.now()}-${i}`, ...r, updatedAt: now })),
      ]);
      toast({ title: "FAQs imported", description: `Added ${parsed.length} FAQ${parsed.length === 1 ? "" : "s"}.` });
    } catch (err) {
      toast({ title: "Could not read that file", description: (err as Error).message, variant: "destructive" });
    }
  };

  const addFaq = () => {
    const items = editedProject.faqHelp ?? [];
    updateField("faqHelp", [
      ...items,
      { id: `faq-${Date.now()}`, question: "", answer: "", updatedAt: new Date().toISOString() },
    ]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="shrink-0 space-y-0 border-b px-6 py-4 text-left">
          <SheetTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Pencil className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span>Edit Project</span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {editedProject.merchantName}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          <Tabs defaultValue="info" className="w-full">
            <TabsList className={cn("grid w-full mb-4", canManageCredentials ? "grid-cols-7" : "grid-cols-6")}>
              <TabsTrigger value="info" className="gap-1 text-xs">
                <Building2 className="h-3 w-3" />
                Info
              </TabsTrigger>
              <TabsTrigger value="links" className="gap-1 text-xs">
                <Link2 className="h-3 w-3" />
                Links
              </TabsTrigger>
              {canManageCredentials && (
                <TabsTrigger value="credentials" className="gap-1 text-xs">
                  <KeyRound className="h-3 w-3" />
                  Credentials
                </TabsTrigger>
              )}
              <TabsTrigger value="dates" className="gap-1 text-xs">
                <Calendar className="h-3 w-3" />
                Dates
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-1 text-xs">
                <FileText className="h-3 w-3" />
                Notes
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-1 text-xs">
                <HelpCircle className="h-3 w-3" />
                FAQ & Help
              </TabsTrigger>
              <TabsTrigger value="custom" className="gap-1 text-xs">
                <Layers className="h-3 w-3" />
                Custom
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-merchantName" className="text-xs font-medium text-muted-foreground">{getLabel("field_merchant_name")} *</Label>
                  <Input
                    id="edit-merchantName"
                    value={editedProject.merchantName}
                    onChange={(e) => updateField("merchantName", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-mid" className="text-xs font-medium text-muted-foreground">{getLabel("field_mid")} *</Label>
                  <Input
                    id="edit-mid"
                    value={editedProject.mid}
                    onChange={(e) => updateField("mid", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-contactEmail" className="text-xs font-medium text-muted-foreground">{getLabel("field_contact_email")} *</Label>
                <Input
                  id="edit-contactEmail"
                  type="text"
                  value={editedProject.contactEmail || ""}
                  onChange={(e) => updateField("contactEmail", e.target.value)}
                  placeholder="merchant@example.com, ops@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Required. Add multiple emails separated by commas — magic links, notifications, and Gmail lookups will go to all of them.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-platform" className="text-xs font-medium text-muted-foreground">{getLabel("field_platform")}</Label>
                  <Select
                    value={editedProject.platform}
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
                <div className="space-y-1.5">
                  <Label htmlFor="edit-category" className="text-xs font-medium text-muted-foreground">{getLabel("field_category")}</Label>
                  <Input
                    id="edit-category"
                    value={editedProject.category}
                    onChange={(e) => updateField("category", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-arr" className="text-xs font-medium text-muted-foreground">{getLabel("field_arr")}</Label>
                  <Input
                    id="edit-arr"
                    type="number"
                    step="0.01"
                    value={editedProject.arr}
                    onChange={(e) => updateField("arr", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-txnsPerDay" className="text-xs font-medium text-muted-foreground">{getLabel("field_txns_per_day")}</Label>
                  <Input
                    id="edit-txnsPerDay"
                    type="number"
                    value={editedProject.txnsPerDay}
                    onChange={(e) => updateField("txnsPerDay", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-aov" className="text-xs font-medium text-muted-foreground">{getLabel("field_aov")}</Label>
                  <Input
                    id="edit-aov"
                    type="number"
                    value={editedProject.aov}
                    onChange={(e) => updateField("aov", parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-salesSpoc" className="text-xs font-medium text-muted-foreground">{getLabel("field_sales_spoc")}</Label>
                  <Input
                    id="edit-salesSpoc"
                    value={editedProject.salesSpoc}
                    onChange={(e) => updateField("salesSpoc", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-integrationType" className="text-xs font-medium text-muted-foreground">{getLabel("field_integration_type")}</Label>
                  <Select
                    value={editedProject.integrationType}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-pgOnboarding" className="text-xs font-medium text-muted-foreground">{getLabel("field_pg_onboarding")}</Label>
                  <Input
                    id="edit-pgOnboarding"
                    value={editedProject.pgOnboarding}
                    onChange={(e) => updateField("pgOnboarding", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-goLivePercent" className="text-xs font-medium text-muted-foreground">{getLabel("field_go_live_percent")}</Label>
                  <Input
                    id="edit-goLivePercent"
                    type="number"
                    min="0"
                    max="100"
                    value={editedProject.goLivePercent}
                    onChange={(e) => updateField("goLivePercent", parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>


            </TabsContent>

            <TabsContent value="links" className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{getLabel("field_brand_url")}</Label>
                <Input
                  type="url"
                  value={editedProject.links.brandUrl}
                  onChange={(e) => updateLinks("brandUrl", e.target.value)}
                />
              </div>
              <LinkFieldWithUpload label={getLabel("field_jira_link")} linkField="jiraLink" dbField="jira_link" value={editedProject.links.jiraLink || ""} />
              <LinkFieldWithUpload label={getLabel("field_brd_link")} linkField="brdLink" dbField="brd_link" value={editedProject.links.brdLink || ""} />
              <LinkFieldWithUpload label={getLabel("field_mint_checklist_link")} linkField="mintChecklistLink" dbField="mint_checklist_link" value={editedProject.links.mintChecklistLink || ""} />
              <LinkFieldWithUpload label={getLabel("field_integration_checklist_link")} linkField="integrationChecklistLink" dbField="integration_checklist_link" value={editedProject.links.integrationChecklistLink || ""} />
              <LinkFieldWithUpload label={getLabel("field_sow_link")} linkField="sowLink" dbField="sow_link" value={editedProject.links.sowLink || ""} />
            </TabsContent>

            <TabsContent value="dates" className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{getLabel("field_kick_off_date")}</Label>
                <DatePickerField
                  value={editedProject.dates.kickOffDate}
                  onChange={(v) => updateDates("kickOffDate", v)}
                  placeholder="Select kick-off date"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{getLabel("field_expected_go_live_date")}</Label>
                <DatePickerField
                  value={editedProject.dates.expectedGoLiveDate || ""}
                  onChange={(v) => updateDates("expectedGoLiveDate", v)}
                  placeholder="Select expected go-live date"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{getLabel("field_actual_go_live_date")}</Label>
                <DatePickerField
                  value={editedProject.dates.goLiveDate || ""}
                  onChange={(v) => updateDates("goLiveDate", v)}
                  placeholder="Select go-live date"
                />
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-mintNotes" className="text-xs font-medium text-muted-foreground">{getLabel("field_mint_notes")}</Label>
                <Textarea
                  id="edit-mintNotes"
                  value={editedProject.notes.mintNotes || ""}
                  onChange={(e) => updateNotes("mintNotes", e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-projectNotes" className="text-xs font-medium text-muted-foreground">{getLabel("field_project_notes")}</Label>
                <Textarea
                  id="edit-projectNotes"
                  value={editedProject.notes.projectNotes || ""}
                  onChange={(e) => updateNotes("projectNotes", e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-currentPhaseComment" className="text-xs font-medium text-muted-foreground">{getLabel("field_current_phase_comment")}</Label>
                <Textarea
                  id="edit-currentPhaseComment"
                  value={editedProject.notes.currentPhaseComment || ""}
                  onChange={(e) => updateNotes("currentPhaseComment", e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phase2Comment" className="text-xs font-medium text-muted-foreground">{getLabel("field_phase2_comment")}</Label>
                <Textarea
                  id="edit-phase2Comment"
                  value={editedProject.notes.phase2Comment || ""}
                  onChange={(e) => updateNotes("phase2Comment", e.target.value)}
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="faq" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="heading-card">FAQ & Help</h3>
                  <p className="text-xs text-muted-foreground">These FAQs appear in the merchant portal and Help Assistant. Upload accepts a CSV with question and answer columns, or a JSON array.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    ref={faqFileRef}
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFaqUpload(file);
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => faqFileRef.current?.click()} className="gap-1">
                    <Upload className="h-3 w-3" /> Upload
                  </Button>
                  <Button type="button" size="sm" onClick={addFaq} className="gap-1">
                    <Plus className="h-3 w-3" /> Add FAQ
                  </Button>
                </div>
              </div>
              {(editedProject.faqHelp ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No FAQs added yet.</div>
              ) : (
                <div className="space-y-3">
                  {(editedProject.faqHelp ?? []).map((faq, idx) => (
                    <div key={faq.id || idx} className="rounded-md border bg-muted/20 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">FAQ {idx + 1}</span>
                        <Button type="button" variant="ghost" size="icon" onClick={() => updateFaqHelp((editedProject.faqHelp ?? []).filter((_, i) => i !== idx))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Question</Label>
                        <Input value={faq.question} onChange={(e) => updateFaqHelp((editedProject.faqHelp ?? []).map((item, i) => i === idx ? { ...item, question: e.target.value } : item))} placeholder="Enter merchant question" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Answer</Label>
                        <Textarea value={faq.answer} onChange={(e) => updateFaqHelp((editedProject.faqHelp ?? []).map((item, i) => i === idx ? { ...item, answer: e.target.value } : item))} placeholder="Enter the answer merchants should see" rows={3} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {canManageCredentials && <TabsContent value="credentials" className="space-y-6">
              <div>
                <h3 className="heading-card mb-3">Sandbox Credentials</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_mid")}</Label>
                    <Input value={editedProject.sandboxMid || ""} onChange={(e) => updateField("sandboxMid", e.target.value)} placeholder="e.g. 10008" />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_app_id")}</Label>
                    <Input value={editedProject.sandboxAppId || ""} onChange={(e) => updateField("sandboxAppId", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_app_secret")}</Label>
                    <Input value={editedProject.sandboxAppSecret || ""} onChange={(e) => updateField("sandboxAppSecret", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_base_url")}</Label>
                    <Input value={editedProject.sandboxBaseUrl || ""} onChange={(e) => updateField("sandboxBaseUrl", e.target.value)} placeholder="https://sandbox.api.gokwik.co" />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_config_id")}</Label>
                    <Input value={editedProject.sandboxConfigId || ""} onChange={(e) => updateField("sandboxConfigId", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_sandbox_kwikpass_jwe_key")}</Label>
                    <Input value={editedProject.sandboxKwikpassJweKey || ""} onChange={(e) => updateField("sandboxKwikpassJweKey", e.target.value)} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label className="text-xs font-medium text-muted-foreground">{getLabel("field_payment_simulator_link")}</Label>
                    <Input
                      type="url"
                      value={editedProject.paymentSimulatorLink || ""}
                      onChange={(e) => updateField("paymentSimulatorLink", e.target.value)}
                      placeholder="https://payment-simulator.example.com/..."
                    />
                    <p className="text-xs text-muted-foreground">When set, a "Payment Simulator" section appears in the merchant's KwikAssist portal.</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="heading-card mb-3">Production Credentials</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_mid")}</Label>
                    <Input value={editedProject.prodMid || ""} onChange={(e) => updateField("prodMid", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_app_id")}</Label>
                    <Input value={editedProject.prodAppId || ""} onChange={(e) => updateField("prodAppId", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_app_secret")}</Label>
                    <Input value={editedProject.prodAppSecret || ""} onChange={(e) => updateField("prodAppSecret", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_base_url")}</Label>
                    <Input value={editedProject.prodBaseUrl || ""} onChange={(e) => updateField("prodBaseUrl", e.target.value)} placeholder="https://api.gokwik.co" />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_config_id")}</Label>
                    <Input value={editedProject.prodConfigId || ""} onChange={(e) => updateField("prodConfigId", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_prod_kwikpass_jwe_key")}</Label>
                    <Input value={editedProject.prodKwikpassJweKey || ""} onChange={(e) => updateField("prodKwikpassJweKey", e.target.value)} />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="heading-card mb-3">MCP Configuration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{getLabel("field_mcp_config_id")}</Label>
                    <Input value={editedProject.mcpConfigId || ""} onChange={(e) => updateField("mcpConfigId", e.target.value)} />
                  </div>
                  <div className="space-y-2 flex items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editedProject.enableMcpDocument || false}
                        onCheckedChange={(checked) => updateField("enableMcpDocument", checked)}
                      />
                      <Label>{getLabel("field_mcp_enabled")}</Label>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="heading-card mb-3">KwikPass (KP) Configuration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2 flex items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editedProject.enableKp || false}
                        onCheckedChange={(checked) => updateField("enableKp", checked)}
                      />
                      <Label>{getLabel("field_kp_enabled")}</Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{getLabel("field_kp_prod_jwe_key")}</Label>
                    <Input value={editedProject.kpProdJweKey || ""} onChange={(e) => updateField("kpProdJweKey", e.target.value)} placeholder="Production JWE key" />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>{getLabel("field_kp_sandbox_jwe_key")}</Label>
                    <Input value={editedProject.kpSandboxJweKey || "zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI"} onChange={(e) => updateField("kpSandboxJweKey", e.target.value)} />
                    <p className="text-xs text-muted-foreground">Default sandbox key is pre-filled for all merchants</p>
                  </div>
                </div>
              </div>
            </TabsContent>}

            <TabsContent value="custom" className="space-y-6">
              {customFields.length > 0 && (
                <CustomFieldsForm
                  fields={customFields}
                  values={{ ...customValues, ...customDraft }}
                  onChange={handleCustomFieldChange}
                />
              )}
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <SheetFooter className="shrink-0 gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};