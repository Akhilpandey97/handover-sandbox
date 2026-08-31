import { Project, calculateTimeByParty, formatDuration } from "@/data/projectsData";
import { teamLabels as defaultTeamLabels } from "@/data/teams";
import { projectStateLabels as defaultStateLabels } from "@/data/projectsData";
import { CustomField } from "@/hooks/useCustomFields";

const escapeCSV = (value: string | number | undefined | null): string => {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

interface ExportLabels {
  teamLabels?: Record<string, string>;
  stateLabels?: Record<string, string>;
  responsibilityLabels?: Record<string, string>;
  getLabel?: (key: string) => string;
}

interface ExportCustomFields {
  fields: CustomField[];
  valuesMap: Record<string, Record<string, string>>; // projectId -> fieldId -> value
}

export const exportProjectsToCSV = (
  projects: Project[],
  labels?: ExportLabels,
  customFieldsData?: ExportCustomFields
) => {
  const teamLbls = labels?.teamLabels || defaultTeamLabels;
  const stateLbls = labels?.stateLabels || defaultStateLabels;
  const respLbls = labels?.responsibilityLabels || { gokwik: "GoKwik", merchant: "Merchant" };
  const getLabel = labels?.getLabel || ((key: string) => {
    const defaults: Record<string, string> = {
      field_merchant_name: "Merchant Name",
      field_mid: "MID",
      field_platform: "Platform",
      field_category: "Category",
      field_arr: "ARR",
      field_txns_per_day: "Txns/Day",
      field_aov: "AOV",
      field_go_live_percent: "Go Live %",
      field_kick_off_date: "Start Date (Kick Off)",
      field_expected_go_live_date: "Expected Go-Live Date",
      field_actual_go_live_date: "Go-Live Date",
      field_sales_spoc: "Sales SPOC",
      field_integration_type: "Integration Type",
      field_pg_onboarding: "PG Onboarding",
      field_brand_url: "Brand URL",
      field_jira_link: "JIRA Link",
      field_brd_link: "BRD Link",
      field_mint_notes: "MINT Notes",
      field_project_notes: "Project Notes",
      field_current_phase_comment: "Phase Comment",
    };
    return defaults[key] || key;
  });

  const customFields = customFieldsData?.fields || [];
  const customValuesMap = customFieldsData?.valuesMap || {};

  // Collect all unique checklist titles across projects (for column headers)
  const allChecklistTitles: string[] = [];
  const titleSet = new Set<string>();
  projects.forEach((p) => {
    p.checklist.forEach((item) => {
      const key = `${item.phase}|${item.title}`;
      if (!titleSet.has(key)) {
        titleSet.add(key);
        allChecklistTitles.push(key);
      }
    });
  });

  const mintLabel = teamLbls.mint || "MINT";
  const intLabel = teamLbls.integration || "Integration";
  const gokwikLabel = respLbls.gokwik || "GoKwik";
  const merchantLabel = respLbls.merchant || "Merchant";

  const headers = [
    getLabel("field_merchant_name"),
    getLabel("field_mid"),
    getLabel("field_platform"),
    getLabel("field_category"),
    getLabel("field_arr"),
    getLabel("field_txns_per_day"),
    getLabel("field_aov"),
    "Current Phase",
    "Current Team",
    "Assigned Owner",
    "Project State",
    "Pending Acceptance",
    getLabel("field_go_live_percent"),
    getLabel("field_kick_off_date"),
    getLabel("field_expected_go_live_date"),
    getLabel("field_actual_go_live_date"),
    getLabel("field_sales_spoc"),
    getLabel("field_integration_type"),
    getLabel("field_pg_onboarding"),
    "Responsibility",
    getLabel("field_brand_url"),
    getLabel("field_jira_link"),
    getLabel("field_brd_link"),
    getLabel("field_mint_notes"),
    getLabel("field_project_notes"),
    "Phase Comment",
    // Custom field headers
    ...customFields.map(f => f.field_label),
    "Checklist Total",
    "Checklist Completed",
    "Transfer Count",
    `Project ${gokwikLabel} Time`,
    `Project ${merchantLabel} Time`,
    `${mintLabel} Tasks Completed`,
    `${mintLabel} Tasks Total`,
    `${mintLabel} ${gokwikLabel} Time`,
    `${mintLabel} ${merchantLabel} Time`,
    `${intLabel} Tasks Completed`,
    `${intLabel} Tasks Total`,
    `${intLabel} ${gokwikLabel} Time`,
    `${intLabel} ${merchantLabel} Time`,
    ...allChecklistTitles.flatMap((key) => {
      const [, title] = key.split("|");
      return [
        `${title} - Status`,
        `${title} - Responsibility`,
        `${title} - ${gokwikLabel} Time`,
        `${title} - ${merchantLabel} Time`,
      ];
    }),
  ];

  const rows = projects.map((p) => {
    const completedChecklist = p.checklist.filter((c) => c.completed).length;
    const projectTime = calculateTimeByParty(p.responsibilityLog);

    const mintItems = p.checklist.filter((c) => c.ownerTeam === "mint");
    const intItems = p.checklist.filter((c) => c.ownerTeam === "integration");

    const mintCompleted = mintItems.filter((c) => c.completed).length;
    const intCompleted = intItems.filter((c) => c.completed).length;

    let mintGokwik = 0, mintMerchant = 0;
    mintItems.forEach((item) => {
      const t = calculateTimeByParty(item.responsibilityLog);
      mintGokwik += t.gokwik;
      mintMerchant += t.merchant;
    });

    let intGokwik = 0, intMerchant = 0;
    intItems.forEach((item) => {
      const t = calculateTimeByParty(item.responsibilityLog);
      intGokwik += t.gokwik;
      intMerchant += t.merchant;
    });

    const checklistMap = new Map<string, typeof p.checklist[0]>();
    p.checklist.forEach((item) => {
      checklistMap.set(`${item.phase}|${item.title}`, item);
    });

    const checklistColumns = allChecklistTitles.flatMap((key) => {
      const item = checklistMap.get(key);
      if (!item) return ["", "", "", ""];
      const time = calculateTimeByParty(item.responsibilityLog);
      return [
        item.completed ? "Done" : "Pending",
        item.currentResponsibility,
        formatDuration(time.gokwik),
        formatDuration(time.merchant),
      ];
    });

    // Custom field values for this project
    const projectCustomValues = customValuesMap[p.id] || {};
    const customFieldColumns = customFields.map(f => {
      const val = projectCustomValues[f.id] || "";
      if (f.field_type === "boolean") return val === "true" ? "Yes" : val === "false" ? "No" : "";
      return val;
    });

    return [
      p.merchantName,
      p.mid,
      p.platform,
      p.category,
      p.arr,
      p.txnsPerDay,
      p.aov,
      p.currentPhase,
      teamLbls[p.currentOwnerTeam] || p.currentOwnerTeam,
      p.assignedOwnerName || "",
      stateLbls[p.projectState] || p.projectState,
      p.pendingAcceptance ? "Yes" : "No",
      p.goLivePercent,
      p.dates.kickOffDate,
      p.dates.expectedGoLiveDate || "",
      p.dates.goLiveDate || "",
      p.salesSpoc,
      p.integrationType,
      p.pgOnboarding,
      p.currentResponsibility,
      p.links.brandUrl,
      p.links.jiraLink || "",
      p.links.brdLink || "",
      p.notes.mintNotes || "",
      p.notes.projectNotes || "",
      p.notes.currentPhaseComment || "",
      ...customFieldColumns,
      p.checklist.length,
      completedChecklist,
      p.transferHistory.length,
      formatDuration(projectTime.gokwik),
      formatDuration(projectTime.merchant),
      mintCompleted,
      mintItems.length,
      formatDuration(mintGokwik),
      formatDuration(mintMerchant),
      intCompleted,
      intItems.length,
      formatDuration(intGokwik),
      formatDuration(intMerchant),
      ...checklistColumns,
    ].map(escapeCSV);
  });

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `projects-export-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
