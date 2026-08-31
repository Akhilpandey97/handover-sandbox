import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { FieldMappingDialog } from "./FieldMappingDialog";

interface CSVUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ImportResult {
  success: boolean;
  merchantName: string;
  error?: string;
}

// Map CSV phase to valid enum values
const mapPhaseToEnum = (phase: string): string => {
  const phaseMap: Record<string, string> = {
    "feasibility analysis": "mint",
    "scoping": "mint",
    "api build": "mint",
    "api validation": "mint",
    "integration": "integration",
    "sandbox testing": "integration",
    "production testing": "integration",
    "prod testing": "integration",
    "go-live": "ms",
    "golive": "ms",
    "completed": "completed",
  };
  const normalized = phase.toLowerCase().trim();
  return phaseMap[normalized] || "mint";
};

const mapPhaseToTeam = (phase: string): string => {
  const mapped = mapPhaseToEnum(phase);
  if (mapped === "integration") return "integration";
  if (mapped === "ms" || mapped === "completed") return "ms";
  return "mint";
};

// Parse a single CSV line handling quoted fields
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

// Parse CSV into rows
const parseCSVRows = (content: string): { headers: string[]; rows: string[][] } => {
  const lines = content.split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows: string[][] = [];
  let currentRow = "";

  for (let i = 1; i < lines.length; i++) {
    currentRow += lines[i];
    const quoteCount = (currentRow.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      currentRow += "\n";
      continue;
    }
    const values = parseCSVLine(currentRow);
    currentRow = "";
    if (values.length >= 2) rows.push(values.map(v => v.trim()));
  }

  return { headers, rows };
};

// Build project from a row using the field mapping
const buildProject = (
  row: string[],
  headers: string[],
  mapping: Record<string, string>
) => {
  const getVal = (fieldKey: string): string => {
    const csvHeader = Object.entries(mapping).find(([, v]) => v === fieldKey)?.[0];
    if (!csvHeader) return "";
    const idx = headers.indexOf(csvHeader);
    return idx >= 0 ? (row[idx] || "").trim() : "";
  };

  const merchant = getVal("merchant_name");
  if (!merchant) return null;

  let mid = getVal("mid");
  if (!mid) mid = `mid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const phase = getVal("current_phase") || "mint";

  // Extract custom field values (keys starting with "custom_")
  const customFieldValues: Record<string, string> = {};
  Object.entries(mapping).forEach(([csvHeader, fieldKey]) => {
    if (fieldKey.startsWith("custom_")) {
      const fieldId = fieldKey.replace("custom_", "");
      const idx = headers.indexOf(csvHeader);
      const val = idx >= 0 ? (row[idx] || "").trim() : "";
      if (val) customFieldValues[fieldId] = val;
    }
  });

  return {
    merchant_name: merchant,
    mid,
    platform: getVal("platform") || "Custom",
    category: getVal("category") || "",
    brand_url: getVal("brand_url") || "",
    arr: parseFloat(getVal("arr")) || 0,
    txns_per_day: parseInt(getVal("txns_per_day")) || 0,
    aov: parseFloat(getVal("aov")) || 0,
    sales_spoc: getVal("sales_spoc") || "",
    mint_notes: getVal("mint_notes") || "",
    project_notes: getVal("project_notes") || "",
    current_phase_comment: getVal("current_phase_comment") || "",
    integration_type: getVal("integration_type") || "Standard",
    pg_onboarding: getVal("pg_onboarding") || "",
    jira_link: getVal("jira_link") || "",
    brd_link: getVal("brd_link") || "",
    kick_off_date: getVal("kick_off_date") || new Date().toISOString().split("T")[0],
    expected_go_live_date: getVal("expected_go_live_date") || "",
    go_live_percent: parseInt(getVal("go_live_percent")) || 0,
    current_phase: mapPhaseToEnum(phase),
    current_owner_team: mapPhaseToTeam(phase),
    _customFieldValues: customFieldValues,
  };
};

export const CSVUploadDialog = ({ open, onOpenChange }: CSVUploadDialogProps) => {
  const { currentUser } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Field mapping state
  const [showMapping, setShowMapping] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [parsedContent, setParsedContent] = useState<string>("");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile || selectedFile.type !== "text/csv") {
      toast.error("Please select a valid CSV file");
      return;
    }

    setFile(selectedFile);
    setResults([]);

    // Parse CSV and show mapping dialog
    const content = await selectedFile.text();
    setParsedContent(content);
    const { headers, rows } = parseCSVRows(content);

    if (headers.length === 0) {
      toast.error("CSV file appears to be empty");
      return;
    }

    setCsvHeaders(headers);
    setCsvRows(rows);
    setShowMapping(true);
  };

  const handleMappingConfirm = async (mapping: Record<string, string>) => {
    setShowMapping(false);

    if (!parsedContent) return;
    setImporting(true);
    setProgress(0);
    setResults([]);

    try {
      const { headers, rows } = parseCSVRows(parsedContent);
      const projects = rows
        .map((row) => buildProject(row, headers, mapping))
        .filter(Boolean) as NonNullable<ReturnType<typeof buildProject>>[];

      if (projects.length === 0) {
        toast.error("No valid projects found after mapping");
        setImporting(false);
        return;
      }

      const importResults: ImportResult[] = [];

      for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        setProgress(Math.round(((i + 1) / projects.length) * 100));

        try {
          const { data: existing } = await supabase
            .from("projects")
            .select("id")
            .eq("mid", project.mid)
            .maybeSingle();

          if (existing) {
            importResults.push({ success: false, merchantName: project.merchant_name, error: "Already exists (duplicate MID)" });
            continue;
          }

          const { _customFieldValues, ...projectData } = project;
          const { data: newProject, error: projectError } = await supabase
            .from("projects")
            .insert({
              ...projectData,
              expected_go_live_date: projectData.expected_go_live_date || null,
              current_phase: projectData.current_phase as any,
              current_owner_team: projectData.current_owner_team as any,
              current_responsibility: "neutral",
              pending_acceptance: false,
              tenant_id: currentUser?.tenantId || null,
            })
            .select()
            .single();

          if (projectError) throw projectError;

          // Checklist items are seeded automatically by the database trigger on projects insert.

          await supabase.from("project_responsibility_logs").insert({
            project_id: newProject.id,
            party: "neutral",
            phase: project.current_phase as any,
            started_at: new Date().toISOString(),
            tenant_id: currentUser?.tenantId || null,
          });

          // Save custom field values if any
          if (project._customFieldValues && Object.keys(project._customFieldValues).length > 0) {
            const cfRows = Object.entries(project._customFieldValues).map(([field_id, value]) => ({
              project_id: newProject.id,
              field_id,
              value,
              tenant_id: currentUser?.tenantId || null,
            }));
            await supabase.from("custom_field_values").insert(cfRows);
          }

          importResults.push({ success: true, merchantName: project.merchant_name });
        } catch (error: any) {
          importResults.push({ success: false, merchantName: project.merchant_name, error: error.message || "Unknown error" });
        }
      }

      setResults(importResults);
      const successCount = importResults.filter((r) => r.success).length;
      const failCount = importResults.filter((r) => !r.success).length;

      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        toast.success(`Imported ${successCount} projects${failCount > 0 ? `, ${failCount} failed` : ""}`);
      } else {
        toast.error("No projects were imported");
      }
    } catch (error) {
      console.error("CSV parsing error:", error);
      toast.error("Failed to parse CSV file");
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setFile(null);
      setResults([]);
      setProgress(0);
      setCsvHeaders([]);
      setCsvRows([]);
      setParsedContent("");
      onOpenChange(false);
    }
  };

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Projects from CSV
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file. AI will auto-map columns to project fields.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* File Input */}
            <div
              onClick={() => !importing && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              } ${importing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                disabled={importing}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium">Click to select CSV file</p>
                  <p className="text-sm text-muted-foreground mt-1">AI will auto-map your columns</p>
                </>
              )}
            </div>

            {importing && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Importing projects...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  {successCount > 0 && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {successCount} imported
                    </span>
                  )}
                  {failCount > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-4 w-4" />
                      {failCount} failed
                    </span>
                  )}
                </div>
                {failCount > 0 && (
                  <ScrollArea className="h-32 border rounded-md p-2">
                    {results.filter((r) => !r.success).map((r, i) => (
                      <div key={i} className="flex items-start gap-2 py-1 text-sm">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <span className="font-medium">{r.merchantName}:</span>{" "}
                          <span className="text-muted-foreground">{r.error}</span>
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose} disabled={importing}>
                {results.length > 0 ? "Close" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Field Mapping Dialog */}
      <FieldMappingDialog
        open={showMapping}
        onOpenChange={setShowMapping}
        csvHeaders={csvHeaders}
        sampleRows={csvRows.slice(0, 3)}
        onConfirm={handleMappingConfirm}
      />
    </>
  );
};
