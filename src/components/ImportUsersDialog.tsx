import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiAuthHeaders } from "@/lib/api-invoke";
import { SPREADSHEET_ACCEPT, findColumn, readSpreadsheet } from "@/lib/spreadsheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Role value → label, only the roles this person may assign. */
  roles: Record<string, string>;
  /** Emails already in this workspace. */
  existingEmails: string[];
  onImported: () => void;
}

interface Row {
  row: number;
  name: string;
  email: string;
  roleInput: string;
  role: string | null;
  password: string;
  problem: string | null;
}

type Result = { row: number; email: string; status: "created" | "skipped" | "failed"; detail: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add many people from an Excel or CSV file: name, email, role and, optionally,
 * a password. Every row is checked before anything is created.
 */
export const ImportUsersDialog = ({ open, onOpenChange, roles, existingEmails, onImported }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [readError, setReadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const resolveRole = (input: string): string | null => {
    const v = input.trim().toLowerCase();
    if (!v) return null;
    for (const [value, label] of Object.entries(roles)) {
      if (value.toLowerCase() === v || label.toLowerCase() === v || label.toLowerCase().replace(/ team$/, "") === v) return value;
    }
    return null;
  };

  const reset = () => {
    setFileName("");
    setRows([]);
    setReadError("");
    setResults(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      const [sheet] = await readSpreadsheet(file);
      const nameCol = findColumn(sheet.headers, ["name", "full name", "fullname", "person"]);
      const emailCol = findColumn(sheet.headers, ["email", "email address", "e-mail", "mail"]);
      const roleCol = findColumn(sheet.headers, ["role", "team", "access", "user role"]);
      const passwordCol = findColumn(sheet.headers, ["password", "temporary password"]);
      const missing = [nameCol === -1 && "Name", emailCol === -1 && "Email", roleCol === -1 && "Role"].filter(Boolean);
      if (missing.length) throw new Error(`The first sheet needs these columns: ${missing.join(", ")}. Download the template to see the layout.`);

      const existing = new Set(existingEmails.map((e) => e.toLowerCase()));
      const seen = new Set<string>();
      setRows(
        sheet.rows.map((cells, i) => {
          const name = cells[nameCol] || "";
          const email = (cells[emailCol] || "").toLowerCase();
          const roleInput = cells[roleCol] || "";
          const role = resolveRole(roleInput);
          const password = passwordCol === -1 ? "" : cells[passwordCol] || "";
          let problem: string | null = null;
          if (!name) problem = "Name is missing";
          else if (!EMAIL_RE.test(email)) problem = "Email isn't valid";
          else if (seen.has(email)) problem = "Listed twice";
          else if (existing.has(email)) problem = "Already in this workspace";
          else if (!role) problem = roleInput ? `Unknown role "${roleInput}"` : "Role is missing";
          else if (password && password.length < 6) problem = "Password under 6 characters";
          seen.add(email);
          return { row: i + 2, name, email, roleInput, role, password, problem };
        }),
      );
    } catch (err) {
      setReadError((err as Error).message);
    }
  };

  const ready = useMemo(() => rows.filter((r) => !r.problem), [rows]);

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const [firstRole, secondRole] = Object.values(roles);
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "Email", "Role", "Password (optional)"],
      ["Priya Shah", "priya@example.com", secondRole || firstRole || "Manager", ""],
      ["Arjun Rao", "arjun@example.com", firstRole || "Manager", ""],
    ]);
    const roleSheet = XLSX.utils.aoa_to_sheet([["Roles you can use"], ...Object.values(roles).map((r) => [r])]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "People");
    XLSX.utils.book_append_sheet(book, roleSheet, "Roles");
    XLSX.writeFile(book, "import-users-template.xlsx");
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/public/import-users", {
        method: "POST",
        headers: await apiAuthHeaders(),
        body: JSON.stringify({ people: ready.map((r) => ({ name: r.name, email: r.email, role: r.role, password: r.password || undefined })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The import didn't go through.");
      // Map server rows (1-based within what was sent) back to sheet rows.
      const out = (body.results as Result[]).map((r) => ({ ...r, row: ready[r.row - 1]?.row ?? r.row }));
      setResults(out);
      const created = out.filter((r) => r.status === "created").length;
      toast.success(`Imported ${created} ${created === 1 ? "person" : "people"}`);
      onImported();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" />Import users</DialogTitle>
          <DialogDescription>
            Upload an Excel or CSV file with Name, Email and Role columns. People without a password get an email to set their own.
          </DialogDescription>
        </DialogHeader>

        {!results && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} id="import-users-file" type="file" accept={SPREADSHEET_ACCEPT} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />{fileName ? "Choose another file" : "Choose file"}
              </Button>
              <Button variant="ghost" onClick={() => void downloadTemplate()} className="gap-2">
                <Download className="h-4 w-4" />Download template
              </Button>
              {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
            </div>

            <p className="text-xs text-muted-foreground">Roles you can use: {Object.values(roles).join(", ")}.</p>
            {readError && <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-strong">{readError}</p>}

            {rows.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">{ready.length} ready</Badge>
                  {rows.length - ready.length > 0 && <Badge variant="outline" className="text-warning-strong">{rows.length - ready.length} won't be imported</Badge>}
                </div>
                <div className="max-h-[45vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Check</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                          <TableCell>{r.name || "—"}</TableCell>
                          <TableCell>{r.email || "—"}</TableCell>
                          <TableCell>{r.role ? roles[r.role] : r.roleInput || "—"}</TableCell>
                          <TableCell>
                            {r.problem
                              ? <span className="flex items-center gap-1.5 text-xs text-destructive-strong"><XCircle className="h-3.5 w-3.5" />{r.problem}</span>
                              : <span className="flex items-center gap-1.5 text-xs text-success-strong"><CheckCircle2 className="h-3.5 w-3.5" />Ready{r.password ? " · password set" : ""}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {results && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Row</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={`${r.row}-${r.email}`}>
                    <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell className={r.status === "created" ? "text-success-strong" : "text-destructive-strong"}>{r.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          {results ? (
            <>
              <Button variant="outline" onClick={reset}>Import another file</Button>
              <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => void runImport()} disabled={ready.length === 0 || importing}>
                {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</> : `Import ${ready.length} ${ready.length === 1 ? "person" : "people"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
