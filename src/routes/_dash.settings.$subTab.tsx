import { createFileRoute, redirect } from "@tanstack/react-router";
import { SETTINGS_SUB_TABS, DEFAULT_SETTINGS_SUB_TAB } from "@/lib/dashboard-routes";

const LABELS: Record<string, string> = {
  general: "General Settings",
  fields: "Field Labels",
  "custom-fields": "Custom Fields",
  "checklist-forms": "Checklist Forms",
  checklist: "Checklist & Teams",
  users: "User Management",
  colours: "Colours",
  email: "Email Settings",
  workflows: "Workflows",
  "pivot-table": "Pivot Table Settings",
  funnel: "Project Stages",
  "activity-log": "Activity Log",
  "slack-alerts": "Slack Alerts",
  integrations: "Integrations",
  navigation: "Navigation",
};

export const Route = createFileRoute("/_dash/settings/$subTab")({
  beforeLoad: ({ params }) => {
    if (!(SETTINGS_SUB_TABS as readonly string[]).includes(params.subTab)) {
      throw redirect({ to: "/settings/$subTab", params: { subTab: DEFAULT_SETTINGS_SUB_TAB }, replace: true });
    }
  },
  head: ({ params }) => {
    const label = LABELS[params.subTab] || "Settings";
    const title = `${label} — Handover`;
    const description = `${label} for this Handover workspace.`;
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
