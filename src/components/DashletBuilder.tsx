import { useState } from "react";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLabels } from "@/contexts/LabelsContext";
import { DASHLET_FIELDS } from "./CustomFieldDashlet";
import type { CustomDashletConfig } from "@/hooks/useDashletOrder";

interface Props {
  /** Every dashlet id in display order, with a friendly name. */
  items: Array<{ id: string; label: string }>;
  hidden: string[];
  onToggle: (id: string) => void;
  custom: CustomDashletConfig[];
  onAddCustom: (config: { title: string; field: string }) => void;
  onRemoveCustom: (id: string) => void;
}

/** Show/hide dashlets and build new ones from the tenant's project fields. */
export const DashletBuilder = ({ items, hidden, onToggle, custom, onAddCustom, onRemoveCustom }: Props) => {
  const { getLabel } = useLabels();
  const [title, setTitle] = useState("");
  const [field, setField] = useState(DASHLET_FIELDS[0]!.value);

  const fieldLabel = (f: typeof DASHLET_FIELDS[number]) => (f.labelKey ? getLabel(f.labelKey) : f.fallback);

  const add = () => {
    const name = title.trim() || `By ${fieldLabel(DASHLET_FIELDS.find((f) => f.value === field)!)}`;
    onAddCustom({ title: name, field });
    setTitle("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <LayoutGrid className="h-3.5 w-3.5" />
          Edit dashboard
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="text-sm font-semibold text-foreground">Dashlets</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">Turn sections on or off. Drag them on the dashboard to reorder.</p>
        <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate text-xs">{item.label}</span>
              <div className="flex shrink-0 items-center gap-1">
                {item.id.startsWith("custom:") && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Delete dashlet" onClick={() => onRemoveCustom(item.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Switch checked={!hidden.includes(item.id)} onCheckedChange={() => onToggle(item.id)} aria-label={`Show ${item.label}`} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs font-semibold text-foreground">New dashlet</p>
          <div className="space-y-1">
            <Label className="text-2xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Projects by platform" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs">Group by field</Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DASHLET_FIELDS.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{fieldLabel(f)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={add} disabled={custom.length >= 8}>
            <Plus className="h-3.5 w-3.5" />Add dashlet
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DashletBuilder;
