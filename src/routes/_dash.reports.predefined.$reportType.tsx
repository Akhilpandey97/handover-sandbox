import { createFileRoute, redirect } from "@tanstack/react-router";
import { PREDEFINED_REPORT_TYPES, DEFAULT_REPORT_TYPE } from "@/lib/dashboard-routes";

const LABELS: Record<string, string> = {
  executive: "Executive Report",
  operational: "Operational Report",
  merchant: "Merchant Responsibility Report",
  tactical: "Tactical Lists",
  weeks_checklist: "Weeks per Checklist Report",
  tat: "TAT Report",
  project: "Project & Checklist Report",
  team: "Team & Owner Report",
};

export const Route = createFileRoute("/_dash/reports/predefined/$reportType")({
  beforeLoad: ({ params }) => {
    if (!(PREDEFINED_REPORT_TYPES as readonly string[]).includes(params.reportType)) {
      throw redirect({ to: "/reports/predefined/$reportType", params: { reportType: DEFAULT_REPORT_TYPE }, replace: true });
    }
  },
  head: ({ params }) => {
    const label = LABELS[params.reportType] || "Reports";
    const title = `${label} — Handover`;
    const description = `${label} across merchant onboarding projects.`;
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
