import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useFormFields, useFormResponses } from "@/hooks/useChecklistForms";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Save, Download, FileText } from "lucide-react";
import { exportFormToCSV } from "@/utils/exportFormCSV";

interface ChecklistFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  checklistItemId: string;
  checklistItemTitle: string;
  formTemplateId: string;
  formTemplateName: string;
}

export const ChecklistFormDialog = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  checklistItemId,
  checklistItemTitle,
  formTemplateId,
  formTemplateName,
}: ChecklistFormDialogProps) => {
  const { fields, isLoading: fieldsLoading } = useFormFields(formTemplateId);
  const { responses, setResponses, isLoading: responsesLoading, saveResponses } = useFormResponses(
    projectId,
    checklistItemId,
    formTemplateId
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Initialize draft from responses
  useEffect(() => {
    if (!responsesLoading) {
      setDraft({ ...responses });
    }
  }, [responses, responsesLoading]);

  const getValue = (fieldId: string) => draft[fieldId] ?? "";

  const handleChange = (fieldId: string, value: string) => {
    setDraft(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveResponses(projectId, checklistItemId, formTemplateId, draft);
      setResponses(draft);
      toast.success("Form saved successfully");
    } catch (e: any) {
      toast.error("Failed to save form");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    exportFormToCSV(formTemplateName, projectName, checklistItemTitle, fields, draft);
  };

  // Group fields by category
  const grouped = useMemo(() => {
    const map = new Map<string, typeof fields>();
    fields.forEach(f => {
      const cat = f.category || "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(f);
    });
    return Array.from(map.entries());
  }, [fields]);

  const isLoading = fieldsLoading || responsesLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[900px] h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg">{formTemplateName}</span>
              <p className="text-xs font-normal text-muted-foreground mt-0.5">
                {projectName} · {checklistItemTitle}
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading form...</div>
        ) : fields.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            This form has no fields configured. Ask a manager to add fields in Settings.
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0 pr-4">
              <div className="space-y-8 pb-4">
                {grouped.map(([category, catFields], ci) => (
                  <div key={category}>
                    {ci > 0 && <Separator className="mb-6" />}
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="outline" className="text-sm font-semibold px-3 py-1">{category}</Badge>
                      <span className="text-xs text-muted-foreground">({catFields.length} questions)</span>
                    </div>
                    <div className="space-y-4">
                      {catFields.map((field, fi) => (
                        <div key={field.id} className="p-4 rounded-lg border bg-card hover:border-primary/20 transition-colors">
                          <div className="flex items-start gap-3">
                            <span className="text-xs font-mono text-muted-foreground mt-1 shrink-0 w-6">{fi + 1}.</span>
                            <div className="flex-1 space-y-2">
                              <Label className="text-sm font-medium leading-snug">
                                {field.question}
                                {field.is_required && <span className="text-destructive ml-1">*</span>}
                              </Label>
                              {renderFieldInput(field, getValue(field.id), (v) => handleChange(field.id, v))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />Download as Excel
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  <Save className="h-4 w-4 mr-2" />{isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

function renderFieldInput(
  field: { field_type: string; options: string[] },
  value: string,
  onChange: (v: string) => void
) {
  switch (field.field_type) {
    case "textarea":
      return <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder="Enter your response..." className="min-h-[80px]" />;
    case "number":
      return <Input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder="Enter a number" />;
    case "date":
      return <Input type="date" value={value} onChange={e => onChange(e.target.value)} />;
    case "url":
      return <Input type="url" value={value} onChange={e => onChange(e.target.value)} placeholder="https://..." />;
    case "boolean":
      return (
        <div className="flex items-center gap-3">
          <Switch checked={value === "true"} onCheckedChange={c => onChange(c ? "true" : "false")} />
          <span className="text-sm text-muted-foreground">{value === "true" ? "Yes" : "No"}</span>
        </div>
      );
    case "select":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
          <SelectContent>
            {(field.options || []).map(opt => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default:
      return <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Enter your response..." />;
  }
}
