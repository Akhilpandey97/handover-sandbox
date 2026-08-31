import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useFormTemplates, useFormFields, useFormAssignments } from "@/hooks/useChecklistForms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText, ChevronRight, ChevronDown, Link2, Upload, Download } from "lucide-react";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Yes/No" },
  { value: "select", label: "Dropdown" },
];

export const ChecklistFormsManager = () => {
  const { currentUser } = useAuth();
  const { templates, isLoading: templatesLoading, refetch: refetchTemplates } = useFormTemplates();
  const { assignments, refetch: refetchAssignments } = useFormAssignments();

  // Selected template for editing fields
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const { fields, isLoading: fieldsLoading, refetch: refetchFields } = useFormFields(selectedTemplateId);

  // Template dialog
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  // Field dialog
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editField, setEditField] = useState<any>(null);
  const [fieldCategory, setFieldCategory] = useState("");
  const [fieldQuestion, setFieldQuestion] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [fieldOptions, setFieldOptions] = useState("");
  const [fieldRequired, setFieldRequired] = useState(false);

  // Delete
  const [deleteItem, setDeleteItem] = useState<{ type: "template" | "field"; item: any } | null>(null);

  // Assignment dialog
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [checklistTemplates, setChecklistTemplates] = useState<any[]>([]);
  const [assignFormId, setAssignFormId] = useState<string | null>(null);

  // Fetch checklist templates for assignment
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from("checklist_templates").select("id, title, phase, owner_team").order("sort_order");
      if (data) setChecklistTemplates(data);
    };
    fetch();
  }, []);

  // Template CRUD
  const openCreateTemplate = () => {
    setEditTemplate(null);
    setTemplateName("");
    setTemplateDesc("");
    setTemplateDialogOpen(true);
  };

  const openEditTemplate = (t: any) => {
    setEditTemplate(t);
    setTemplateName(t.name);
    setTemplateDesc(t.description || "");
    setTemplateDialogOpen(true);
  };

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editTemplate) {
        const { error } = await supabase.from("checklist_form_templates")
          .update({ name: templateName, description: templateDesc || null })
          .eq("id", editTemplate.id);
        if (error) throw error;
        toast.success("Form template updated");
      } else {
        const { error } = await supabase.from("checklist_form_templates").insert({
          name: templateName,
          description: templateDesc || null,
          tenant_id: currentUser?.tenantId || null,
        });
        if (error) throw error;
        toast.success("Form template created");
      }
      setTemplateDialogOpen(false);
      refetchTemplates();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    }
  };

  // Field CRUD
  const openCreateField = () => {
    setEditField(null);
    setFieldCategory("");
    setFieldQuestion("");
    setFieldType("text");
    setFieldOptions("");
    setFieldRequired(false);
    setFieldDialogOpen(true);
  };

  const openEditField = (f: any) => {
    setEditField(f);
    setFieldCategory(f.category || "");
    setFieldQuestion(f.question);
    setFieldType(f.field_type);
    setFieldOptions((f.options || []).join(", "));
    setFieldRequired(f.is_required);
    setFieldDialogOpen(true);
  };

  const saveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId) return;
    const options = fieldType === "select" ? fieldOptions.split(",").map(o => o.trim()).filter(Boolean) : [];
    try {
      if (editField) {
        const { error } = await supabase.from("checklist_form_fields")
          .update({ category: fieldCategory, question: fieldQuestion, field_type: fieldType, options, is_required: fieldRequired })
          .eq("id", editField.id);
        if (error) throw error;
        toast.success("Field updated");
      } else {
        const { error } = await supabase.from("checklist_form_fields").insert({
          template_id: selectedTemplateId,
          category: fieldCategory,
          question: fieldQuestion,
          field_type: fieldType,
          options,
          is_required: fieldRequired,
          sort_order: fields.length,
          tenant_id: currentUser?.tenantId || null,
        });
        if (error) throw error;
        toast.success("Field added");
      }
      setFieldDialogOpen(false);
      refetchFields();
    } catch (e: any) {
      toast.error(e.message || "Failed to save field");
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      if (deleteItem.type === "template") {
        const { error } = await supabase.from("checklist_form_templates").delete().eq("id", deleteItem.item.id);
        if (error) throw error;
        if (selectedTemplateId === deleteItem.item.id) setSelectedTemplateId(null);
        toast.success("Form template deleted");
        refetchTemplates();
      } else {
        const { error } = await supabase.from("checklist_form_fields").delete().eq("id", deleteItem.item.id);
        if (error) throw error;
        toast.success("Field deleted");
        refetchFields();
      }
      setDeleteItem(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    }
  };

  // Assignment
  const openAssignDialog = (formId: string) => {
    setAssignFormId(formId);
    setAssignDialogOpen(true);
  };

  const toggleAssignment = async (checklistTemplateId: string) => {
    if (!assignFormId) return;
    const existing = assignments.find(
      a => a.checklist_template_id === checklistTemplateId && a.form_template_id === assignFormId
    );
    try {
      if (existing) {
        await supabase.from("checklist_form_assignments").delete().eq("id", existing.id);
      } else {
        await supabase.from("checklist_form_assignments").insert({
          checklist_template_id: checklistTemplateId,
          form_template_id: assignFormId,
          tenant_id: currentUser?.tenantId || null,
        });
      }
      refetchAssignments();
    } catch (e: any) {
      toast.error("Failed to update assignment");
    }
  };

  // CSV Import
  const handleCSVImport = (templateId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();

      // Full RFC-compliant CSV parser that handles multi-line quoted fields
      const parseCSV = (csv: string): string[][] => {
        const rows: string[][] = [];
        let current = "";
        let inQuotes = false;
        let row: string[] = [];
        for (let i = 0; i < csv.length; i++) {
          const ch = csv[i];
          if (inQuotes) {
            if (ch === '"') {
              if (i + 1 < csv.length && csv[i + 1] === '"') {
                current += '"'; i++; // escaped quote
              } else {
                inQuotes = false;
              }
            } else {
              current += ch;
            }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { row.push(current.trim()); current = ""; }
            else if (ch === '\n' || (ch === '\r' && csv[i + 1] === '\n')) {
              if (ch === '\r') i++; // skip \n after \r
              row.push(current.trim());
              if (row.some(c => c)) rows.push(row);
              row = []; current = "";
            } else {
              current += ch;
            }
          }
        }
        row.push(current.trim());
        if (row.some(c => c)) rows.push(row);
        return rows;
      };

      const allRows = parseCSV(text);
      if (allRows.length < 2) {
        toast.error("CSV must have a header row and at least one data row");
        return;
      }

      const header = allRows[0].map((h: string) => h.toLowerCase().replace(/['"]/g, ""));
      const catIdx = header.findIndex((h: string) => h.includes("category") || h.includes("section"));
      const qIdx = header.findIndex((h: string) => h.includes("question") || h.includes("field") || h.includes("label"));
      const typeIdx = header.findIndex((h: string) => h.includes("type"));
      const reqIdx = header.findIndex((h: string) => h.includes("req") || h.includes("mandatory"));
      const optIdx = header.findIndex((h: string) => h.includes("option"));

      if (qIdx === -1) {
        toast.error("CSV must have a 'Question' column");
        return;
      }

      const validTypes = ["text", "textarea", "number", "date", "url", "boolean", "select"];
      const rows = allRows.slice(1);
      const inserts = rows.filter((cols: string[]) => cols[qIdx]?.trim()).map((cols: string[], idx: number) => {
        const rawType = typeIdx >= 0 ? cols[typeIdx]?.toLowerCase().trim() : "text";
        const fieldType = validTypes.includes(rawType) ? rawType
          : rawType.includes("long") || rawType.includes("area") ? "textarea"
          : rawType.includes("num") ? "number"
          : rawType.includes("bool") || rawType.includes("yes") ? "boolean"
          : rawType.includes("drop") || rawType.includes("select") ? "select"
          : rawType.includes("date") ? "date"
          : rawType.includes("url") || rawType.includes("link") ? "url"
          : "text";
        const reqVal = reqIdx >= 0 ? cols[reqIdx]?.toLowerCase().trim() : "";
        const isReq = ["yes", "true", "1", "required", "y"].includes(reqVal);
        const options = optIdx >= 0 && fieldType === "select"
          ? cols[optIdx]?.split(";").map((o: string) => o.trim()).filter(Boolean) || []
          : [];
        return {
          template_id: templateId,
          category: catIdx >= 0 ? cols[catIdx]?.trim() || "" : "",
          question: cols[qIdx].trim(),
          field_type: fieldType,
          is_required: isReq,
          options,
          sort_order: fields.length + idx,
          tenant_id: currentUser?.tenantId || null,
        };
      });

      if (inserts.length === 0) {
        toast.error("No valid rows found in CSV");
        return;
      }

      try {
        const { error } = await supabase.from("checklist_form_fields").insert(inserts);
        if (error) throw error;
        toast.success(`Imported ${inserts.length} fields from CSV`);
        refetchFields();
      } catch (err: any) {
        toast.error(err.message || "Failed to import CSV");
      }
    };
    input.click();
  };

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const typeLabel = (type: string) => FIELD_TYPES.find(t => t.value === type)?.label || type;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Checklist Forms
            </CardTitle>
            <CardDescription>
              Create form templates with questions, assign them to checklist items, and users will fill them when they reach that checklist step.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreateTemplate}>
            <Plus className="h-4 w-4 mr-2" />New Form Template
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {templatesLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No form templates yet. Click "New Form Template" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => {
              const isSelected = selectedTemplateId === t.id;
              const assignCount = assignments.filter(a => a.form_template_id === t.id).length;
              return (
                <div key={t.id}>
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedTemplateId(isSelected ? null : t.id)}
                  >
                    <div className="flex items-center gap-3">
                      {isSelected ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <div>
                        <span className="font-medium">{t.name}</span>
                        {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                      </div>
                      {assignCount > 0 && (
                        <Badge variant="secondary" className="text-xs">{assignCount} checklist(s)</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openAssignDialog(t.id)} title="Assign to checklists">
                        <Link2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEditTemplate(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteItem({ type: "template", item: t })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Fields section */}
                  {isSelected && (
                    <div className="ml-8 mt-2 mb-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Fields / Questions</h4>
                        <div className="flex items-center gap-2">
                          <a href="/sample-form-fields.csv" download="sample-form-fields.csv">
                            <Button size="sm" variant="ghost" type="button">
                              <Download className="h-3 w-3 mr-1" />Sample CSV
                            </Button>
                          </a>
                          <Button size="sm" variant="outline" onClick={() => handleCSVImport(t.id)}>
                            <Upload className="h-3 w-3 mr-1" />Import CSV
                          </Button>
                          <Button size="sm" variant="outline" onClick={openCreateField}>
                            <Plus className="h-3 w-3 mr-1" />Add Field
                          </Button>
                        </div>
                      </div>
                      {fieldsLoading ? (
                        <div className="text-xs text-muted-foreground">Loading fields...</div>
                      ) : fields.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-4">No fields yet. Add questions to this form.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[120px]">Category</TableHead>
                              <TableHead>Question</TableHead>
                              <TableHead className="w-[100px]">Type</TableHead>
                              <TableHead className="w-[60px]">Req.</TableHead>
                              <TableHead className="w-[80px] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {fields.map(f => (
                              <TableRow key={f.id}>
                                <TableCell className="text-xs font-medium">{f.category || "—"}</TableCell>
                                <TableCell className="text-sm">{f.question}</TableCell>
                                <TableCell><Badge variant="secondary" className="text-xs">{typeLabel(f.field_type)}</Badge></TableCell>
                                <TableCell>{f.is_required && <Badge variant="destructive" className="text-xs">Yes</Badge>}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEditField(f)}>
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteItem({ type: "field", item: f })}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Edit Form Template" : "New Form Template"}</DialogTitle>
            <DialogDescription>Give your form a name and optional description.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveTemplate} className="space-y-4">
            <div className="space-y-2">
              <Label>Form Name</Label>
              <Input placeholder="e.g. BRD Form, Onboarding Questionnaire" value={templateName} onChange={e => setTemplateName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea placeholder="Brief description of the form" value={templateDesc} onChange={e => setTemplateDesc(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{editTemplate ? "Update" : "Create"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Field Dialog */}
      <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editField ? "Edit Field" : "Add Field"}</DialogTitle>
            <DialogDescription>Add a question/field to this form template.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveField} className="space-y-4">
            <div className="space-y-2">
              <Label>Category / Section</Label>
              <Input placeholder="e.g. Merchant Identifiers, Payments, Shipping" value={fieldCategory} onChange={e => setFieldCategory(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Question</Label>
              <Textarea placeholder="Enter the question" value={fieldQuestion} onChange={e => setFieldQuestion(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Field Type</Label>
                <Select value={fieldType} onValueChange={setFieldType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex items-end gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={fieldRequired} onCheckedChange={setFieldRequired} />
                  <Label>Required</Label>
                </div>
              </div>
            </div>
            {fieldType === "select" && (
              <div className="space-y-2">
                <Label>Options (comma-separated)</Label>
                <Input placeholder="Option 1, Option 2, Option 3" value={fieldOptions} onChange={e => setFieldOptions(e.target.value)} />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{editField ? "Update" : "Add Field"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assignment Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Form to Checklist Items</DialogTitle>
            <DialogDescription>Select which checklist items should trigger this form popup when reached.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {checklistTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checklist templates found.</p>
            ) : (
              checklistTemplates.map(ct => {
                const isAssigned = assignments.some(
                  a => a.checklist_template_id === ct.id && a.form_template_id === assignFormId
                );
                return (
                  <div
                    key={ct.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isAssigned ? "bg-primary/5 border-primary/30" : "hover:bg-muted/30"
                    }`}
                    onClick={() => toggleAssignment(ct.id)}
                  >
                    <Checkbox checked={isAssigned} />
                    <div className="flex-1">
                      <span className="text-sm font-medium">{ct.title}</span>
                      <div className="flex gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">{ct.phase}</Badge>
                        <Badge variant="secondary" className="text-xs">{ct.owner_team}</Badge>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteItem} onOpenChange={open => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteItem?.type === "template" ? "Form Template" : "Field"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem?.type === "template"
                ? `Delete "${deleteItem.item.name}"? All fields, assignments, and responses will be removed.`
                : `Delete this question? All responses for it will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
