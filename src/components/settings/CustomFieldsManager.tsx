import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string[];
  sort_order: number;
  is_active: boolean;
}

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Yes/No" },
  { value: "select", label: "Dropdown (Select)" },
];

export const CustomFieldsManager = () => {
  const { currentUser } = useAuth();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editField, setEditField] = useState<CustomField | null>(null);
  const [deleteField, setDeleteField] = useState<CustomField | null>(null);

  // Form state
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [fieldOptions, setFieldOptions] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchFields = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setFields((data || []).map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : [],
      })));
    } catch (e: any) {
      console.error("Failed to fetch custom fields:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchFields(); }, []);

  const generateKey = (label: string) => {
    return "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  };

  const openCreateDialog = () => {
    setEditField(null);
    setFieldLabel("");
    setFieldKey("");
    setFieldType("text");
    setFieldOptions("");
    setDialogOpen(true);
  };

  const openEditDialog = (field: CustomField) => {
    setEditField(field);
    setFieldLabel(field.field_label);
    setFieldKey(field.field_key);
    setFieldType(field.field_type);
    setFieldOptions(field.options.join(", "));
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const key = editField ? editField.field_key : generateKey(fieldLabel);
      const options = fieldType === "select" ? fieldOptions.split(",").map(o => o.trim()).filter(Boolean) : [];

      if (editField) {
        const { error } = await supabase
          .from("custom_fields")
          .update({
            field_label: fieldLabel,
            field_type: fieldType,
            options,
          })
          .eq("id", editField.id);
        if (error) throw error;
        toast.success("Field updated");
      } else {
        const { error } = await supabase
          .from("custom_fields")
          .insert({
            field_key: key,
            field_label: fieldLabel,
            field_type: fieldType,
            options,
            sort_order: fields.length,
            tenant_id: currentUser?.tenantId || null,
          });
        if (error) throw error;
        toast.success("Field created");
      }
      setDialogOpen(false);
      fetchFields();
    } catch (e: any) {
      toast.error(e.message || "Failed to save field");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteField) return;
    try {
      const { error } = await supabase.from("custom_fields").delete().eq("id", deleteField.id);
      if (error) throw error;
      toast.success("Field deleted");
      setDeleteField(null);
      fetchFields();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete field");
    }
  };

  const toggleActive = async (field: CustomField) => {
    try {
      const { error } = await supabase
        .from("custom_fields")
        .update({ is_active: !field.is_active })
        .eq("id", field.id);
      if (error) throw error;
      setFields(prev => prev.map(f => f.id === field.id ? { ...f, is_active: !f.is_active } : f));
    } catch (e: any) {
      toast.error("Failed to toggle field");
    }
  };

  const typeLabel = (type: string) => FIELD_TYPES.find(t => t.value === type)?.label || type;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Custom Project Fields
            </CardTitle>
            <CardDescription>
              Add custom fields to capture additional data on projects. These fields will appear in project forms and details.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : fields.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No custom fields yet. Click "Add Field" to create one.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">{field.field_label}</TableCell>
                  <TableCell><code className="text-xs text-muted-foreground">{field.field_key}</code></TableCell>
                  <TableCell>
                    <Badge variant="secondary">{typeLabel(field.field_type)}</Badge>
                    {field.field_type === "select" && field.options.length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({field.options.length} options)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={field.is_active} onCheckedChange={() => toggleActive(field)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(field)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteField(field)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editField ? "Edit Field" : "Add Custom Field"}</DialogTitle>
            <DialogDescription>
              {editField ? "Update the field settings" : "Define a new custom field for projects"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Field Label</Label>
              <Input
                placeholder="e.g. Contract Value, Region, Priority"
                value={fieldLabel}
                onChange={(e) => {
                  setFieldLabel(e.target.value);
                  if (!editField) setFieldKey(generateKey(e.target.value));
                }}
                required
              />
            </div>
            {!editField && (
              <div className="space-y-2">
                <Label>Field Key (auto-generated)</Label>
                <Input value={fieldKey} disabled className="font-mono text-xs" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Data Type</Label>
              <Select value={fieldType} onValueChange={setFieldType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fieldType === "select" && (
              <div className="space-y-2">
                <Label>Options (comma-separated)</Label>
                <Input
                  placeholder="Option 1, Option 2, Option 3"
                  value={fieldOptions}
                  onChange={(e) => setFieldOptions(e.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editField ? "Update" : "Create Field"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteField} onOpenChange={(open) => !open && setDeleteField(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Field</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteField?.field_label}</strong>? All saved values for this field across all projects will be removed.
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
