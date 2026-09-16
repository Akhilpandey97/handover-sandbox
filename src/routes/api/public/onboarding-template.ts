import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { ONBOARDING_TEMPLATE_FILENAME, onboardingTemplate } from "@/data/onboardingTemplate";

/**
 * The blank onboarding workbook, as a download. It holds no workspace data
 * (only default names and examples), so it needs no sign-in, which lets Buddy
 * link to it directly in a reply.
 */
function handler(): Response {
  const book = XLSX.utils.book_new();
  for (const sheet of onboardingTemplate()) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, ws, sheet.name);
  }
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ONBOARDING_TEMPLATE_FILENAME}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/api/public/onboarding-template")({
  server: {
    handlers: {
      GET: () => handler(),
    },
  },
});
