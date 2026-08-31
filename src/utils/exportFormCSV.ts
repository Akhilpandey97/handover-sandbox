import type { FormField } from "@/hooks/useChecklistForms";

/**
 * Export filled form data as a CSV file (opens as Excel-compatible)
 */
export function exportFormToCSV(
  formName: string,
  projectName: string,
  checklistItemTitle: string,
  fields: FormField[],
  values: Record<string, string>
) {
  const rows: string[][] = [];

  // Header
  rows.push(["Form", formName]);
  rows.push(["Project", projectName]);
  rows.push(["Checklist Item", checklistItemTitle]);
  rows.push(["Exported At", new Date().toLocaleString()]);
  rows.push([]);
  rows.push(["Category", "Question", "Response"]);

  // Data
  fields.forEach(field => {
    const val = values[field.id] || "";
    rows.push([
      field.category || "General",
      field.question,
      field.field_type === "boolean" ? (val === "true" ? "Yes" : val === "false" ? "No" : "") : val,
    ]);
  });

  // Build CSV
  const csvContent = rows
    .map(row => row.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-zA-Z0-9]/g, "_")}_${projectName.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
