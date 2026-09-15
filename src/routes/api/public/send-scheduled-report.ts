import { createFileRoute } from "@tanstack/react-router";
import { getTenantIntegrations, requireCred, resendFrom, resendReplyTo, type TenantIntegrations } from "@/lib/tenant-integrations.server";

import { createClient } from "@supabase/supabase-js";
import { requireInternalCaller } from "@/lib/api-auth.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PIVOT_MARKER = "__PIVOT_REPORT__";

function isDueNow(schedule: string): boolean {
  if (!schedule || schedule === "none") return false;

  const now = new Date();
  const currentDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getUTCDay()];
  const currentHour = now.getUTCHours().toString().padStart(2, "0");
  const currentMinute = now.getUTCMinutes().toString().padStart(2, "0");
  const currentTime = `${currentHour}:${currentMinute}`;

  if (schedule === "daily") {
    return currentTime === "03:30";
  }

  const parts = schedule.split("@");
  if (parts.length === 2) {
    const daysPart = parts[0].trim();
    const scheduledTime = parts[1].trim();

    const [h, m] = scheduledTime.split(":").map(Number);
    let utcH = h - 5;
    let utcM = m - 30;
    if (utcM < 0) { utcM += 60; utcH -= 1; }
    if (utcH < 0) { utcH += 24; }
    const utcTime = `${utcH.toString().padStart(2, "0")}:${utcM.toString().padStart(2, "0")}`;

    if (daysPart === "daily") return currentTime === utcTime;
    const days = daysPart.split(",").map(d => d.trim());
    return days.includes(currentDay) && currentTime === utcTime;
  }

  return false;
}

// ─── Pivot helpers ────────────────────────────────────────────────────────────

const PIVOT_FIELD_LABELS: Record<string, string> = {
  projectState: "Project State", currentPhase: "Current Phase",
  currentOwnerTeam: "Current Team", platform: "Platform", category: "Category",
  assignedOwnerName: "Assigned Owner", currentResponsibility: "Responsibility",
  integrationType: "Integration Type", pgOnboarding: "PG Onboarding", salesSpoc: "Sales SPOC",
  arr: "ARR", txnsPerDay: "Txns/Day", aov: "AOV", goLivePercent: "Go Live %", transferCount: "Transfer Count",
};

const PIVOT_DB_COL: Record<string, string> = {
  projectState: "project_state", currentPhase: "current_phase",
  currentOwnerTeam: "current_owner_team", platform: "platform", category: "category",
  assignedOwnerName: "assigned_owner_name", currentResponsibility: "current_responsibility",
  integrationType: "integration_type", pgOnboarding: "pg_onboarding", salesSpoc: "sales_spoc",
};

const PROJECT_STATE_LABELS: Record<string, string> = {
  not_started: "Not Started", in_progress: "In Progress", on_hold: "On Hold",
  live: "Live", blocked: "Blocked",
};

function getPivotGroupValue(project: any, key: string): string {
  const dbKey = PIVOT_DB_COL[key];
  if (!dbKey) return "—";
  const val = project[dbKey];
  if (!val) return key === "assignedOwnerName" ? "Unassigned" : "—";
  // Apply human-readable labels for state fields
  if (key === "projectState") return PROJECT_STATE_LABELS[val] || val;
  return String(val);
}

function getPivotNumericValue(project: any, key: string): number {
  const numMap: Record<string, string> = {
    arr: "arr", txnsPerDay: "txns_per_day", aov: "aov", goLivePercent: "go_live_percent",
  };
  const dbKey = numMap[key];
  if (!dbKey) return 0;
  return Number(project[dbKey]) || 0;
}

function computeAgg(values: number[], type: string): number {
  if (values.length === 0) return 0;
  switch (type) {
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "count": return values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: return values.reduce((a, b) => a + b, 0); // sum
  }
}

function formatAggVal(key: string, val: number, aggType: string): string {
  if (aggType === "count") return String(Math.round(val));
  if (key === "arr") return (Math.abs(val) >= 100000 ? val / 1e7 : val).toFixed(2);
  if (key === "goLivePercent") return `${val.toFixed(0)}%`;
  return val.toFixed(1);
}

interface PivotResult {
  rowLabel: string;
  sortedRows: string[];
  sortedCols: string[];
  showGrandTotal: boolean;
  result: Record<string, Record<string, number>>;
  grandTotals: Record<string, number>;
  rowTotals: Record<string, number>;
  overallTotal: number;
  pivotValueField: string;
  pivotAggType: string;
}

function computePivot(projects: any[], pivotRowField: string, pivotColField: string, pivotValueField: string, pivotAggType: string): PivotResult {
  const rowValues = new Set<string>();
  const colValues = new Set<string>();

  projects.forEach(p => {
    rowValues.add(getPivotGroupValue(p, pivotRowField));
    if (pivotColField !== "none") colValues.add(getPivotGroupValue(p, pivotColField));
  });

  const sortedRows = Array.from(rowValues).sort();
  const sortedCols = pivotColField !== "none" ? Array.from(colValues).sort() : ["Total"];
  const showGrandTotal = sortedCols.length > 1;

  const grid: Record<string, Record<string, number[]>> = {};
  sortedRows.forEach(r => { grid[r] = {}; sortedCols.forEach(c => { grid[r][c] = []; }); });
  projects.forEach(p => {
    const rowVal = getPivotGroupValue(p, pivotRowField);
    const colVal = pivotColField !== "none" ? getPivotGroupValue(p, pivotColField) : "Total";
    const numVal = getPivotNumericValue(p, pivotValueField);
    if (grid[rowVal]?.[colVal]) grid[rowVal][colVal].push(numVal);
  });

  const result: Record<string, Record<string, number>> = {};
  const colTotals: Record<string, number[]> = {};
  const rowTotals: Record<string, number> = {};
  sortedCols.forEach(c => { colTotals[c] = []; });
  sortedRows.forEach(r => {
    result[r] = {};
    let rowSum = 0;
    sortedCols.forEach(c => {
      const v = computeAgg(grid[r][c], pivotAggType);
      result[r][c] = v;
      rowSum += v;
      colTotals[c].push(...grid[r][c]);
    });
    rowTotals[r] = rowSum;
  });
  const grandTotals: Record<string, number> = {};
  sortedCols.forEach(c => { grandTotals[c] = computeAgg(colTotals[c], pivotAggType); });
  const overallTotal = Object.values(grandTotals).reduce((s, v) => s + v, 0);

  return {
    rowLabel: PIVOT_FIELD_LABELS[pivotRowField] || pivotRowField,
    sortedRows, sortedCols, showGrandTotal, result, grandTotals, rowTotals, overallTotal,
    pivotValueField, pivotAggType,
  };
}

function buildPivotPlainText(p: PivotResult): string {
  const lines: string[] = [];
  lines.push(`${p.rowLabel} | ${p.sortedCols.join(" | ")}${p.showGrandTotal ? " | Grand Total" : ""}`);
  lines.push("-".repeat(60));
  p.sortedRows.forEach(r => {
    const cells = p.sortedCols.map(c => formatAggVal(p.pivotValueField, p.result[r]?.[c] || 0, p.pivotAggType));
    const gt = p.showGrandTotal ? ` | ${formatAggVal(p.pivotValueField, p.rowTotals[r], p.pivotAggType)}` : "";
    lines.push(`${r} | ${cells.join(" | ")}${gt}`);
  });
  lines.push("-".repeat(60));
  const totalCells = p.sortedCols.map(c => formatAggVal(p.pivotValueField, p.grandTotals[c] || 0, p.pivotAggType));
  const overall = p.showGrandTotal ? ` | ${formatAggVal(p.pivotValueField, p.overallTotal, p.pivotAggType)}` : "";
  lines.push(`Grand Total | ${totalCells.join(" | ")}${overall}`);
  return lines.join("\n");
}

function buildPivotHtml(projects: any[], pivotRowField: string, pivotColField: string, pivotValueField: string, pivotAggType: string): string {
  const rowValues = new Set<string>();
  const colValues = new Set<string>();

  projects.forEach(p => {
    rowValues.add(getPivotGroupValue(p, pivotRowField));
    if (pivotColField !== "none") colValues.add(getPivotGroupValue(p, pivotColField));
  });

  const sortedRows = Array.from(rowValues).sort();
  const sortedCols = pivotColField !== "none" ? Array.from(colValues).sort() : ["Total"];
  const showGrandTotal = sortedCols.length > 1;

  // Build grid
  const grid: Record<string, Record<string, number[]>> = {};
  sortedRows.forEach(r => { grid[r] = {}; sortedCols.forEach(c => { grid[r][c] = []; }); });
  projects.forEach(p => {
    const rowVal = getPivotGroupValue(p, pivotRowField);
    const colVal = pivotColField !== "none" ? getPivotGroupValue(p, pivotColField) : "Total";
    const numVal = getPivotNumericValue(p, pivotValueField);
    if (grid[rowVal]?.[colVal]) grid[rowVal][colVal].push(numVal);
  });

  const result: Record<string, Record<string, number>> = {};
  const colTotals: Record<string, number[]> = {};
  sortedCols.forEach(c => { colTotals[c] = []; });
  sortedRows.forEach(r => {
    result[r] = {};
    sortedCols.forEach(c => {
      result[r][c] = computeAgg(grid[r][c], pivotAggType);
      colTotals[c].push(...grid[r][c]);
    });
  });
  const grandTotals: Record<string, number> = {};
  sortedCols.forEach(c => { grandTotals[c] = computeAgg(colTotals[c], pivotAggType); });

  const rowLabel = PIVOT_FIELD_LABELS[pivotRowField] || pivotRowField;
  const th = (txt: string, extra = "") =>
    `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d5e0e6;background:#eef3f6;font-size:12px;color:#3b5466;white-space:nowrap;${extra}">${txt}</th>`;
  const td = (txt: string, bg = "#ffffff", bold = false) =>
    `<td style="padding:6px 12px;border-bottom:1px solid #d5e0e6;font-size:12px;color:#3b5466;background:${bg};text-align:right;${bold ? "font-weight:600;" : ""}">${txt}</td>`;
  const tdLeft = (txt: string, bg = "#ffffff", bold = false) =>
    `<td style="padding:6px 12px;border-bottom:1px solid #d5e0e6;font-size:12px;color:#3b5466;background:${bg};${bold ? "font-weight:600;" : ""}">${txt}</td>`;

  const headerCols = sortedCols.map(c => th(c, "text-align:right;")).join("");
  const grandTotalHeader = showGrandTotal ? th("Grand Total", "text-align:right;background:#d5e0e6;") : "";

  const bodyRows = sortedRows.map((row, i) => {
    const bg = i % 2 === 0 ? "#ffffff" : "#f7fafc";
    const rowTotal = sortedCols.reduce((s, c) => s + (result[row]?.[c] || 0), 0);
    const cells = sortedCols.map(c => td(formatAggVal(pivotValueField, result[row]?.[c] || 0, pivotAggType), bg)).join("");
    const gtCell = showGrandTotal ? td(formatAggVal(pivotValueField, rowTotal, pivotAggType), bg, true) : "";
    return `<tr>${tdLeft(row, bg)}${cells}${gtCell}</tr>`;
  }).join("");

  const grandTotalCells = sortedCols.map(c => td(formatAggVal(pivotValueField, grandTotals[c] || 0, pivotAggType), "#e6f0f5", true)).join("");
  const overallTotal = Object.values(grandTotals).reduce((s, v) => s + v, 0);
  const grandTotalRow = `<tr>
    ${tdLeft("Grand Total", "#e6f0f5", true)}
    ${grandTotalCells}
    ${showGrandTotal ? td(formatAggVal(pivotValueField, overallTotal, pivotAggType), "#d5e0e6", true) : ""}
  </tr>`;

  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          ${th(rowLabel)}
          ${headerCols}
          ${grandTotalHeader}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${grandTotalRow}
      </tbody>
    </table>
  `;
}

// ─── Filter + sort helper (mirrors useReportFilters.ts logic) ─────────────────

function applyFilterAndSort(projects: any[], filterState: any): any[] {
  if (!filterState) return projects;

  const {
    teamFilter = [], ownerFilter = [], stateFilter = [], platformFilter = [],
    categoryFilter = [], responsibilityFilter = [],
    arrMin, arrMax,
    kickOffFrom, kickOffTo, goLiveFrom, goLiveTo,
    expectedGoLiveFrom, expectedGoLiveTo, expectedGoLiveNone,
    sortField = "none", sortDir = "asc",
  } = filterState;

  let result = projects.filter((p: any) => {
    if (teamFilter.length > 0 && !teamFilter.includes(p.current_owner_team)) return false;
    if (ownerFilter.length > 0) {
      if (ownerFilter.includes("unassigned")) {
        if (p.assigned_owner) return false;
      } else if (!ownerFilter.includes(p.assigned_owner || "")) return false;
    }
    if (stateFilter.length > 0 && !stateFilter.includes(p.project_state)) return false;
    if (platformFilter.length > 0 && !platformFilter.includes(p.platform || "")) return false;
    if (categoryFilter.length > 0 && !categoryFilter.includes(p.category || "")) return false;
    if (responsibilityFilter.length > 0 && !responsibilityFilter.includes(p.current_responsibility || "")) return false;
    if (arrMin && Number(p.arr) < parseFloat(arrMin)) return false;
    if (arrMax && Number(p.arr) > parseFloat(arrMax)) return false;
    if (kickOffFrom && p.kick_off_date < kickOffFrom) return false;
    if (kickOffTo && p.kick_off_date > kickOffTo) return false;
    if (goLiveFrom) {
      const glDate = p.go_live_date || p.expected_go_live_date || "";
      if (!glDate || glDate < goLiveFrom) return false;
    }
    if (goLiveTo) {
      const glDate = p.go_live_date || p.expected_go_live_date || "";
      if (!glDate || glDate > goLiveTo) return false;
    }
    if (expectedGoLiveFrom && !(p.expected_go_live_date && p.expected_go_live_date >= expectedGoLiveFrom)) return false;
    if (expectedGoLiveTo && !(p.expected_go_live_date && p.expected_go_live_date <= expectedGoLiveTo)) return false;
    if (expectedGoLiveNone && p.expected_go_live_date) return false;
    return true;
  });

  if (sortField !== "none") {
    result = [...result].sort((a: any, b: any) => {
      if (sortField === "arr") {
        const diff = Number(a.arr) - Number(b.arr);
        return sortDir === "asc" ? diff : -diff;
      }
      const fieldMap: Record<string, string> = {
        merchantName: "merchant_name", platform: "platform",
        owner: "assigned_owner_name", state: "project_state",
        kickOffDate: "kick_off_date", expectedGoLiveDate: "expected_go_live_date",
        goLiveDate: "go_live_date",
      };
      const dbKey = fieldMap[sortField] || sortField;
      const va = String(a[dbKey] || "");
      const vb = String(b[dbKey] || "");
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  return result;
}

// ─── Flat report helpers ───────────────────────────────────────────────────────

const columnLabels: Record<string, string> = {
  merchantName: "Merchant Name", mid: "MID", platform: "Platform", category: "Category",
  arr: "ARR", txnsPerDay: "Txns/Day", aov: "AOV",
  projectState: "Project State", currentPhase: "Current Phase",
  currentOwnerTeam: "Current Team", assignedOwnerName: "Assigned Owner",
  currentResponsibility: "Responsibility", goLivePercent: "Go Live %",
  pendingAcceptance: "Pending Acceptance",
  kickOffDate: "Kick-Off Date", expectedGoLiveDate: "Expected Go-Live", goLiveDate: "Go-Live Date",
  salesSpoc: "Sales SPOC", integrationType: "Integration Type", pgOnboarding: "PG Onboarding",
  brandUrl: "Brand URL", jiraLink: "JIRA Link", brdLink: "BRD Link",
  mintNotes: "MINT Notes", projectNotes: "Project Notes", currentPhaseComment: "Phase Comment",
};

const dbToField: Record<string, string> = {
  merchantName: "merchant_name", mid: "mid", platform: "platform", category: "category",
  arr: "arr", txnsPerDay: "txns_per_day", aov: "aov",
  projectState: "project_state", currentPhase: "current_phase",
  currentOwnerTeam: "current_owner_team", assignedOwnerName: "assigned_owner_name",
  currentResponsibility: "current_responsibility", goLivePercent: "go_live_percent",
  pendingAcceptance: "pending_acceptance",
  kickOffDate: "kick_off_date", expectedGoLiveDate: "expected_go_live_date", goLiveDate: "go_live_date",
  salesSpoc: "sales_spoc", integrationType: "integration_type", pgOnboarding: "pg_onboarding",
  brandUrl: "brand_url", jiraLink: "jira_link", brdLink: "brd_link",
  mintNotes: "mint_notes", projectNotes: "project_notes", currentPhaseComment: "current_phase_comment",
};

function getFlatCellValue(project: any, key: string): string {
  const dbKey = dbToField[key];
  if (!dbKey) return "";
  const val = project[dbKey];
  if (key === "assignedOwnerName") return val ? String(val) : "Unassigned";
  if (val === null || val === undefined) return "";
  if (key === "pendingAcceptance") return val ? "Yes" : "No";
  if (key === "goLivePercent") return `${val}%`;
  return String(val);
}

async function fetchReportProjects(supabase: any, tenantId: string | null): Promise<any[]> {
  const { data: rawProjects, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (projectError) {
    throw new Error("Failed to fetch projects");
  }

  const activeProjects = (rawProjects || []).filter((project: any) => !project.archived);
  const ownerIds = Array.from(new Set(activeProjects.map((project: any) => project.assigned_owner).filter(Boolean)));

  if (ownerIds.length === 0) {
    return activeProjects.map((project: any) => ({ ...project, assigned_owner_name: null }));
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", ownerIds);

  if (profilesError) {
    throw new Error("Failed to fetch owner names");
  }

  const ownerNameById = new Map((profiles || []).map((profile: any) => [profile.id, profile.name]));

  return activeProjects.map((project: any) => ({
    ...project,
    assigned_owner_name: project.assigned_owner
      ? ownerNameById.get(project.assigned_owner) || null
      : null,
  }));
}

// ─── Main send function ────────────────────────────────────────────────────────

async function sendReportEmail(
  supabase: any,
  report: any,
  creds: TenantIntegrations
): Promise<{ sent: number; failed: number; errors: string[]; execution_id?: string }> {
  const RESEND_API_KEY = requireCred(creds, "resend_api_key", "Resend email");
  const recipients = report.recipients || [];
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, errors: ["No recipients configured"] };
  }

  const { data: execution } = await supabase
    .from("report_executions")
    .insert({
      report_id: report.id,
      tenant_id: report.tenant_id,
      status: "sending",
      recipients,
      email_count: recipients.length,
    })
    .select()
    .single();

  let projects: any[] = [];

  try {
    projects = await fetchReportProjects(supabase, report.tenant_id);
  } catch (error) {
    if (execution) {
      await supabase.from("report_executions").update({
        status: "failed", error_message: (error as Error).message, completed_at: new Date().toISOString(),
      }).eq("id", execution.id);
    }
    return { sent: 0, failed: 1, errors: [(error as Error).message], execution_id: execution?.id };
  }

  const allColumns: string[] = report.columns || [];
  const isPivot = allColumns[0] === PIVOT_MARKER;

  // Parse and strip filter state encoded as last element
  const filterEl = allColumns.find((c: string) => c.startsWith("__FILTER_STATE__:"));
  let filterState: any = null;
  try {
    if (filterEl) filterState = JSON.parse(filterEl.slice("__FILTER_STATE__:".length));
  } catch { /* ignore */ }
  const columns = allColumns.filter((c: string) => !c.startsWith("__FILTER_STATE__:") && c !== PIVOT_MARKER);

  // Apply filters + sort
  const filteredProjects = applyFilterAndSort(projects, filterState);

  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  let tableHtml: string;
  let footerText: string;
  let plainTextBody: string;
  let mobileCardsHtml = "";

  if (isPivot) {
    const [pivotRowField, pivotColField, pivotValueField, pivotAggType] = columns;
    const pivot = computePivot(filteredProjects, pivotRowField, pivotColField, pivotValueField, pivotAggType);
    tableHtml = buildPivotHtml(filteredProjects, pivotRowField, pivotColField, pivotValueField, pivotAggType);

    // Mobile cards: one card per row
    mobileCardsHtml = pivot.sortedRows.map(r => {
      const cells = pivot.sortedCols.map(c =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:#546978;">${c}</span><span style="color:#11263b;font-weight:500;">${formatAggVal(pivot.pivotValueField, pivot.result[r]?.[c] || 0, pivot.pivotAggType)}</span></div>`
      ).join("");
      const gt = pivot.showGrandTotal
        ? `<div style="display:flex;justify-content:space-between;padding:6px 0 0;margin-top:6px;border-top:1px solid #d5e0e6;font-size:13px;font-weight:600;"><span style="color:#3b5466;">Grand Total</span><span style="color:#11263b;">${formatAggVal(pivot.pivotValueField, pivot.rowTotals[r], pivot.pivotAggType)}</span></div>`
        : "";
      return `<div style="background:#ffffff;border:1px solid #d5e0e6;border-radius:8px;padding:12px 14px;margin-bottom:8px;"><div style="font-weight:600;font-size:14px;color:#11263b;margin-bottom:8px;">${r}</div>${cells}${gt}</div>`;
    }).join("");

    const colLabel = pivotColField !== "none" ? (PIVOT_FIELD_LABELS[pivotColField] || pivotColField) : "—";
    const valLabel = PIVOT_FIELD_LABELS[pivotValueField] || pivotValueField;
    footerText = `Rows: ${pivot.rowLabel} · Columns: ${colLabel} · Values: ${valLabel} (${pivotAggType}) · ${filteredProjects.length} projects · Generated at ${new Date().toLocaleTimeString()}`;
    plainTextBody = `${report.name}\nScheduled Report — ${dateStr}\n\n${buildPivotPlainText(pivot)}\n\n${footerText}`;
  } else {
    const headerRow = columns.map((c: string) =>
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d5e0e6;background:#eef3f6;font-size:12px;color:#3b5466;">${columnLabels[c] || c}</th>`
    ).join("");
    const bodyRows = filteredProjects.map((p: any, i: number) => {
      const bgColor = i % 2 === 0 ? "#ffffff" : "#f7fafc";
      const cells = columns.map((c: string) =>
        `<td style="padding:6px 12px;border-bottom:1px solid #d5e0e6;font-size:12px;color:#3b5466;background:${bgColor};">${getFlatCellValue(p, c)}</td>`
      ).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    tableHtml = `<table role="presentation" style="width:100%;border-collapse:collapse;"><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;

    // Mobile cards: one card per project (label-value pairs)
    mobileCardsHtml = filteredProjects.map((p: any) => {
      const rows = columns.map((c: string) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:13px;"><span style="color:#546978;flex-shrink:0;">${columnLabels[c] || c}</span><span style="color:#11263b;text-align:right;word-break:break-word;">${getFlatCellValue(p, c) || "—"}</span></div>`
      ).join("");
      return `<div style="background:#ffffff;border:1px solid #d5e0e6;border-radius:8px;padding:12px 14px;margin-bottom:8px;">${rows}</div>`;
    }).join("");

    const filterSummary = filterState && (filterState.activeFilterCount > 0 || filterState.sortField !== "none")
      ? ` (filtered from ${projects.length})`
      : "";
    footerText = `Total: ${filteredProjects.length} projects${filterSummary} · Generated at ${new Date().toLocaleTimeString()}`;

    // Plain text version
    const ptHeader = columns.map((c: string) => columnLabels[c] || c).join(" | ");
    const ptRows = filteredProjects.map((p: any) =>
      columns.map((c: string) => getFlatCellValue(p, c) || "—").join(" | ")
    ).join("\n");
    plainTextBody = `${report.name}\nScheduled Report — ${dateStr}\n\n${ptHeader}\n${"-".repeat(60)}\n${ptRows}\n\n${footerText}`;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${report.name}</title>
<style>
  body { margin:0; padding:0; background:#eef3f6; font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  /* Outlook ignores the body font on tables, so restate it there. */
  table, td, th, div, p, h1 { font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:900px; margin:0 auto; padding:16px; }
  .desktop-table { display:block; }
  .mobile-cards { display:none; }
  @media only screen and (max-width:600px) {
    .wrap { padding:12px !important; }
    .header h1 { font-size:16px !important; }
    .header p { font-size:12px !important; }
    .desktop-table { display:none !important; }
    .mobile-cards { display:block !important; padding:12px !important; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header" style="background:#1d3a5c;padding:18px 20px;border-radius:12px 12px 0 0;color:#ffffff;">
      <h1 style="margin:0;font-size:18px;font-weight:600;">${report.name}</h1>
      <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Scheduled Report — ${dateStr}</p>
    </div>
    <div style="background:#ffffff;border:1px solid #d5e0e6;border-top:none;border-radius:0 0 12px 12px;overflow:hidden;">
      <div class="desktop-table" style="overflow-x:auto;">
        ${tableHtml}
      </div>
      <div class="mobile-cards" style="padding:0 12px 4px;background:#f7fafc;">
        ${mobileCardsHtml}
      </div>
      <div style="padding:12px 16px;background:#f7fafc;border-top:1px solid #d5e0e6;">
        <p style="margin:0;font-size:11px;color:#546978;">${footerText}</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const errors: string[] = [];
  let successCount = 0;

  // Use Resend batch endpoint — single API call for up to 100 recipients
  // avoids the 2 req/sec rate limit that caused later recipients to be dropped.
  const subject = `Report: ${report.name} — ${new Date().toLocaleDateString()}`;
  const from = resendFrom(creds);
  const replyTo = resendReplyTo(creds);
  const chunkSize = 100;

  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    const payload = chunk.map((email: string) => ({
      from,
      ...replyTo,
      to: [email],
      subject,
      html: htmlContent,
      text: plainTextBody,
    }));

    try {
      const emailRes = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await emailRes.json();
      if (!emailRes.ok) {
        console.error("Resend batch failed:", emailRes.status, result);
        chunk.forEach((email: string) =>
          errors.push(`${email}: ${result.message || result.error || `HTTP ${emailRes.status}`}`)
        );
      } else {
        // Resend batch returns { data: [{ id }, ...] } — count entries with ids
        const sent = Array.isArray(result?.data) ? result.data.length : chunk.length;
        successCount += sent;
        if (sent < chunk.length) {
          errors.push(`Batch returned ${sent}/${chunk.length} ids`);
        }
      }
    } catch (e) {
      console.error("Batch send exception:", e);
      chunk.forEach((email: string) => errors.push(`${email}: ${(e as Error).message}`));
    }

    // Small pause between batches to stay well under provider limits
    if (i + chunkSize < recipients.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const finalStatus = errors.length === 0 ? "success" : successCount > 0 ? "partial" : "failed";
  if (execution) {
    await supabase.from("report_executions").update({
      status: finalStatus,
      error_message: errors.length > 0 ? errors.join("; ") : null,
      completed_at: new Date().toISOString(),
    }).eq("id", execution.id);
  }

  return { sent: successCount, failed: errors.length, errors, execution_id: execution?.id };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const { report_id } = body;

    if (report_id) {
      const { data: report, error: reportErr } = await supabase
        .from("saved_reports")
        .select("*")
        .eq("id", report_id)
        .single();

      if (reportErr || !report) throw new Error("Report not found");

      const result = await sendReportEmail(supabase, report, await getTenantIntegrations(report.tenant_id));
      return new Response(JSON.stringify({ success: result.errors.length === 0, ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Cron trigger: checking for due reports at", new Date().toISOString());

    const { data: allReports, error: reportsErr } = await supabase
      .from("saved_reports")
      .select("*")
      .neq("schedule", "none")
      .not("schedule", "is", null);

    if (reportsErr) throw new Error("Failed to fetch reports");

    const dueReports = (allReports || []).filter((r: any) => isDueNow(r.schedule));
    console.log(`Found ${allReports?.length || 0} scheduled reports, ${dueReports.length} are due now`);

    if (dueReports.length === 0) {
      return new Response(JSON.stringify({ message: "No reports due", checked: allReports?.length || 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const report of dueReports) {
      if (!report.recipients || report.recipients.length === 0) {
        console.log(`Skipping report "${report.name}" — no recipients`);
        continue;
      }
      console.log(`Sending report "${report.name}" to ${report.recipients.length} recipients`);
      const result = await sendReportEmail(supabase, report, await getTenantIntegrations(report.tenant_id));
      results.push({ report_name: report.name, ...result });
    }

    return new Response(JSON.stringify({ reports_processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-scheduled-report error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/send-scheduled-report")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      PATCH: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
