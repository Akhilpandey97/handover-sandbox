import { createFileRoute, redirect } from "@tanstack/react-router";
import { REPORT_SUB_TABS, DEFAULT_REPORT_TYPE } from "@/lib/dashboard-routes";

const LABELS: Record<string, string> = {
  builder: "Report Builder",
  scheduler: "Report Scheduler",
  "pivot-table": "Pivot Table",
  sandbox: "Sandbox Testing",
  "portal-visits": "Portal Visits",
  "daily-report": "Daily Report",
  "weekly-report": "Weekly Report",
};

export const Route = createFileRoute("/_dash/reports/$subTab")({
  // A dynamic segment matches anything, so an unknown sub-tab would otherwise
  // render an empty page at a URL that looks valid.
  beforeLoad: ({ params }) => {
    if (params.subTab === "predefined") {
      throw redirect({ to: "/reports/predefined/$reportType", params: { reportType: DEFAULT_REPORT_TYPE }, replace: true });
    }
    if (!(REPORT_SUB_TABS as readonly string[]).includes(params.subTab)) {
      throw redirect({ to: "/reports/predefined/$reportType", params: { reportType: DEFAULT_REPORT_TYPE }, replace: true });
    }
  },
  head: ({ params }) => {
    const label = LABELS[params.subTab] || "Reports";
    const title = `${label} — Handover — Onboarding/Integrations Command Center`;
    const description = `${label} for merchant onboarding projects.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
});
