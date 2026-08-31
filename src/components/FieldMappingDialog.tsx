import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, ArrowRight, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCustomFields, CustomField } from "@/hooks/useCustomFields";

const BASE_PROJECT_FIELDS = [
  { key: "merchant_name", label: "Merchant/Brand Name", required: true },
  { key: "mid", label: "Merchant ID (MID)" },
  { key: "platform", label: "Platform" },
  { key: "category", label: "Category" },
  { key: "brand_url", label: "Brand URL" },
  { key: "arr", label: "ARR (Revenue)" },
  { key: "txns_per_day", label: "Txns/Day" },
  { key: "aov", label: "AOV" },
  { key: "sales_spoc", label: "Sales SPOC" },
  { key: "mint_notes", label: "MINT Notes" },
  { key: "project_notes", label: "Project Notes" },
  { key: "current_phase_comment", label: "Phase Comment" },
  { key: "integration_type", label: "Integration Type" },
  { key: "pg_onboarding", label: "PG Onboarding" },
  { key: "jira_link", label: "JIRA Link" },
  { key: "brd_link", label: "BRD Link" },
  { key: "kick_off_date", label: "Kick Off Date" },
  { key: "expected_go_live_date", label: "Expected Go Live Date" },
  { key: "go_live_percent", label: "Go Live %" },
  { key: "current_phase", label: "Current Phase" },
];

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

const HEADER_ALIASES: Record<string, string> = {
  merchant: "merchant_name",
  brand: "merchant_name",
  merchantname: "merchant_name",
  brandname: "merchant_name",
  company: "merchant_name",
  mid: "mid",
  merchantid: "mid",
  merchantcode: "mid",
  website: "brand_url",
  url: "brand_url",
  brandurl: "brand_url",
  revenue: "arr",
  annualrevenue: "arr",
  arr: "arr",
  txn: "txns_per_day",
  txns: "txns_per_day",
  transactionsperday: "txns_per_day",
  tpd: "txns_per_day",
  aov: "aov",
  avgordervalue: "aov",
  salespoc: "sales_spoc",
  salesspoc: "sales_spoc",
  poc: "sales_spoc",
  category: "category",
  platform: "platform",
  integrationtype: "integration_type",
  pgonboarding: "pg_onboarding",
  jira: "jira_link",
  jiralink: "jira_link",
  brd: "brd_link",
  brdlink: "brd_link",
  kickoffdate: "kick_off_date",
  startdate: "kick_off_date",
  expectedgolivedate: "expected_go_live_date",
  golivepercent: "go_live_percent",
  phase: "current_phase",
  currentphase: "current_phase",
  phasecomment: "current_phase_comment",
  notes: "project_notes",
  mintnotes: "mint_notes",
};

const getHeuristicMapping = (headers: string[], projectFields: { key: string; label: string; required?: boolean }[]) => {
  const result: Record<string, string> = {};
  const used = new Set<string>();

  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    const compact = normalized.replace(/\s+/g, "");

    const byAlias = HEADER_ALIASES[compact] || HEADER_ALIASES[normalized];
    const byFieldKey = projectFields.find(
      (field) => field.key === compact || field.key === normalized.replace(/\s+/g, "_")
    )?.key;
    // Also match by label for custom fields
    const byLabel = projectFields.find(
      (field) => normalizeHeader(field.label).replace(/\s+/g, "") === compact
    )?.key;

    const match = byAlias || byFieldKey || byLabel;
    if (match && !used.has(match)) {
      result[header] = match;
      used.add(match);
    }
  });

  return result;
};

interface FieldMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvHeaders: string[];
  sampleRows: string[][];
  onConfirm: (mapping: Record<string, string>) => void;
}

export const FieldMappingDialog = ({
  open,
  onOpenChange,
  csvHeaders,
  sampleRows,
  onConfirm,
}: FieldMappingDialogProps) => {
  const { fields: customFieldsDefs, isLoading: customFieldsLoading } = useCustomFields();
  const PROJECT_FIELDS: { key: string; label: string; required?: boolean; isCustom?: boolean }[] = [
    ...BASE_PROJECT_FIELDS,
    ...customFieldsDefs.map(f => ({ key: `custom_${f.id}`, label: f.field_label, isCustom: true })),
  ];

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!open || customFieldsLoading) {
      if (!open) setAiLoading(false);
      return;
    }

    if (csvHeaders.length === 0) {
      setMapping({});
      return;
    }

    const heuristicMapping = getHeuristicMapping(csvHeaders, PROJECT_FIELDS);
    setMapping(heuristicMapping);
    autoMapWithAi(heuristicMapping);
  }, [open, csvHeaders, customFieldsLoading]);

  const autoMapWithAi = async (baseMapping: Record<string, string> = mapping) => {
    setAiLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-field-mapping`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            csvHeaders,
            sampleRows: sampleRows.slice(0, 2),
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || "AI mapping failed");
      }

      const data = await response.json();
      const aiMapping: Record<string, string> = {};

      if (data.mapping) {
        Object.entries(data.mapping).forEach(([csvHeader, projectField]) => {
          if (projectField && typeof projectField === "string") {
            aiMapping[csvHeader] = projectField;
          }
        });
      }

      const mergedMapping = { ...baseMapping, ...aiMapping };
      setMapping(mergedMapping);

      const mappedCount = Object.values(mergedMapping).filter(Boolean).length;
      toast.success(`Mapped ${mappedCount}/${csvHeaders.length} fields`);
    } catch (err: any) {
      console.error("AI mapping error:", err);
      setMapping(baseMapping);
      
      toast.error(err?.message || "AI auto-mapping failed. Review the suggested mappings.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleFieldChange = (csvHeader: string, projectField: string) => {
    setMapping((prev) => ({
      ...prev,
      [csvHeader]: projectField === "__skip__" ? "" : projectField,
    }));
  };

  const handleConfirm = () => {
    const activeMappings = Object.fromEntries(
      Object.entries(mapping).filter(([, v]) => v)
    );

    if (!Object.values(activeMappings).includes("merchant_name")) {
      toast.error("Please map at least the Merchant Name field");
      return;
    }

    onConfirm(activeMappings);
  };

  const getMappedCount = () => Object.values(mapping).filter(Boolean).length;
  const getUsedFields = () => new Set(Object.values(mapping).filter(Boolean));

  const getSampleValue = (headerIdx: number) => {
    if (sampleRows.length === 0) return "";
    const val = sampleRows[0]?.[headerIdx] || "";
    return val.length > 40 ? val.substring(0, 40) + "…" : val;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Map CSV Fields to Project Fields
          </DialogTitle>
          <DialogDescription>
            {aiLoading
              ? "AI is analyzing your CSV headers..."
              : `${getMappedCount()} of ${csvHeaders.length} columns mapped. Adjust any incorrect mappings below.`}
          </DialogDescription>
        </DialogHeader>

        {aiLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">AI is auto-mapping your fields...</p>
          </div>
        ) : (
          <ScrollArea className="h-[50vh] max-h-[500px] min-h-[260px] -mx-6 px-6 overflow-auto">
            <div className="space-y-2">
              {csvHeaders.map((header, idx) => {
                const currentValue = mapping[header] || "";
                const usedFields = getUsedFields();
                const sample = getSampleValue(idx);

                return (
                  <div
                    key={header}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                  >
                    {/* CSV Column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {currentValue ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className="font-medium text-sm truncate">{header}</span>
                      </div>
                      {sample && (
                        <p className="text-xs text-muted-foreground ml-6 truncate">
                          e.g. "{sample}"
                        </p>
                      )}
                    </div>

                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

                    {/* Project Field Selector */}
                    <div className="w-52">
                      <Select
                        value={currentValue || "__skip__"}
                        onValueChange={(val) => handleFieldChange(header, val)}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Skip this field" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__skip__">
                            <span className="text-muted-foreground">— Skip —</span>
                          </SelectItem>
                          {PROJECT_FIELDS.filter(f => !f.isCustom).map((field) => (
                            <SelectItem
                              key={field.key}
                              value={field.key}
                              disabled={
                                usedFields.has(field.key) && mapping[header] !== field.key
                              }
                            >
                              <span className="flex items-center gap-1.5">
                                {field.label}
                                {field.required && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    Required
                                  </Badge>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                          {customFieldsDefs.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-1.5">
                                Custom Fields
                              </div>
                              {PROJECT_FIELDS.filter(f => f.isCustom).map((field) => (
                                <SelectItem
                                  key={field.key}
                                  value={field.key}
                                  disabled={
                                    usedFields.has(field.key) && mapping[header] !== field.key
                                  }
                                >
                                  {field.label}
                                </SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            {!Object.values(mapping).includes("merchant_name") && !aiLoading && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertCircle className="h-4 w-4" />
                Merchant Name mapping required
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={aiLoading}>
              Cancel
            </Button>
            <Button
              onClick={() => autoMapWithAi()}
              variant="secondary"
              disabled={aiLoading}
              className="gap-1.5"
            >
              <Wand2 className="h-4 w-4" />
              Re-run AI
            </Button>
            <Button onClick={handleConfirm} disabled={aiLoading}>
              Confirm & Import
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
