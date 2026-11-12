import { useState, useRef } from "react";
import { useLabels } from "@/contexts/LabelsContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, AlertCircle } from "lucide-react";

interface CsvRow {
  title: string;
  owner_team: string;
  start_date?: string;
  due_date?: string;
  days?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  tenantId: string | null;
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ""; });
    return row as unknown as CsvRow;
  }).filter((r) => r.title);
}

export function ChecklistCsvImportDialog({ open, onOpenChange, projectId, tenantId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { teamLabels } = useLabels();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target?.result as string);
        if (!parsed.length) {
          setParseError("No valid rows found. Ensure the CSV has a header row with at least a 'title' column.");
          setRows([]);
        } else {
          setParseError(null);
          setRows(parsed);
        }
      } catch {
        setParseError("Failed to parse CSV. Please check the file format.");
      }
    };
    reader.readAsText(file);
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      // Delete all existing checklist items for this project first (replace, not append)
      const { error: deleteError } = await supabase
        .from("checklist_items")
        .delete()
        .eq("project_id", projectId);
      if (deleteError) throw deleteError;

      const inserts = rows.map((r, idx) => ({
        project_id: projectId,
        tenant_id: tenantId,
        title: r.title,
        owner_team: r.owner_team || "mint",
        start_date: r.start_date || null,
        due_date: r.due_date || null,
        sort_order: idx,
        completed: false,
        is_task: false,
        current_responsibility: "neutral" as const,
      }));
      const { error } = await supabase.from("checklist_items").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: `Checklist replaced with ${rows.length} imported item${rows.length === 1 ? "" : "s"}.` });
      setRows([]);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Replace Checklist from CSV</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 mb-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          This will <strong>delete all existing checklist items</strong> for this project and replace them with the imported ones.
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          Required column: <code>title</code>. Optional: <code>owner_team</code>,{" "}
          <code>start_date</code> (YYYY-MM-DD), <code>due_date</code> (YYYY-MM-DD).
        </div>

        <div
          className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Click to select a CSV file</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </div>

        {parseError && (
          <div className="flex items-center gap-2 text-destructive text-sm mt-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {parseError}
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-3 flex-1 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">Title</th>
                  <th className="p-2 text-left">Team</th>
                  <th className="p-2 text-left">Start</th>
                  <th className="p-2 text-left">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    <td className="p-2 font-medium">{r.title}</td>
                    <td className="p-2">{teamLabels[r.owner_team] || r.owner_team || teamLabels["mint"] || "mint"}</td>
                    <td className="p-2">{r.start_date || "—"}</td>
                    <td className="p-2">{r.due_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={() => { setRows([]); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            disabled={!rows.length || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? "Replacing…" : `Replace with ${rows.length} item${rows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
