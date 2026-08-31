import { CustomField } from "@/hooks/useCustomFields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Layers } from "lucide-react";

interface CustomFieldsFormProps {
  fields: CustomField[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}

export const CustomFieldsForm = ({ fields, values, onChange }: CustomFieldsFormProps) => {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
        <Layers className="h-4 w-4" />
        Custom Fields
      </h4>
      <div className="grid grid-cols-2 gap-4">
        {fields.map((field) => (
          <div key={field.id} className="space-y-2">
            <Label className="text-xs">{field.field_label}</Label>
            {field.field_type === "select" ? (
              <Select
                value={values[field.id] || ""}
                onValueChange={(v) => onChange(field.id, v)}
              >
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {field.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.field_type === "boolean" ? (
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={values[field.id] === "true"}
                  onCheckedChange={(c) => onChange(field.id, c ? "true" : "false")}
                />
                <span className="text-sm text-muted-foreground">
                  {values[field.id] === "true" ? "Yes" : "No"}
                </span>
              </div>
            ) : (
              <Input
                type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "url" ? "url" : "text"}
                value={values[field.id] || ""}
                onChange={(e) => onChange(field.id, e.target.value)}
                placeholder={`Enter ${field.field_label.toLowerCase()}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

interface CustomFieldsDisplayProps {
  fields: CustomField[];
  values: Record<string, string>;
}

export const CustomFieldsDisplay = ({ fields, values }: CustomFieldsDisplayProps) => {
  const activeFields = fields.filter((f) => values[f.id]);
  if (activeFields.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4" />
        Custom Fields
      </h4>
      <div className="grid grid-cols-2 gap-4">
        {activeFields.map((field) => (
          <div key={field.id} className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">{field.field_label}</p>
            <p className="text-sm font-medium">
              {field.field_type === "boolean"
                ? values[field.id] === "true" ? "Yes" : "No"
                : field.field_type === "url"
                ? <a href={values[field.id]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{values[field.id]}</a>
                : values[field.id]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
