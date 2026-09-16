/**
 * Reading uploaded spreadsheets (.xlsx, .xls, .csv) in the browser.
 *
 * Shared by bulk imports and Buddy's attachments. xlsx is loaded on demand so
 * the library only downloads when someone actually picks a file.
 */

export interface Sheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export const SPREADSHEET_ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BYTES = 10 * 1024 * 1024;

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Split it into smaller files.");
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Choose an Excel (.xlsx, .xls) or CSV file.");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets: Sheet[] = [];
  for (const name of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
    const cells = grid.map((row) => row.map((v) => String(v ?? "").trim()));
    // The header is the first row with anything in it.
    const headerAt = cells.findIndex((row) => row.some(Boolean));
    if (headerAt === -1) continue;
    const headers = cells[headerAt].map((h, i) => h || `Column ${i + 1}`);
    const rows = cells.slice(headerAt + 1).filter((row) => row.some(Boolean)).map((row) => headers.map((_, i) => row[i] ?? ""));
    sheets.push({ name, headers, rows });
  }
  if (sheets.length === 0) throw new Error("That file has no rows.");
  return sheets;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A sheet as CSV text, cut at a character budget. */
export function sheetToCsv(sheet: Sheet, maxChars: number): { csv: string; rowsIncluded: number } {
  let csv = sheet.headers.map(csvCell).join(",");
  let rowsIncluded = 0;
  for (const row of sheet.rows) {
    const line = row.map(csvCell).join(",");
    if (csv.length + line.length + 1 > maxChars) break;
    csv += `\n${line}`;
    rowsIncluded++;
  }
  return { csv, rowsIncluded };
}

/** Find the column whose header matches any of the given names (case and punctuation ignored). */
export function findColumn(headers: string[], names: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = names.map(norm);
  return headers.findIndex((h) => wanted.includes(norm(h)));
}
