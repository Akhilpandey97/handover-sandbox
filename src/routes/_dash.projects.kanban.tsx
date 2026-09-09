import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/projects/kanban")({
  head: () => ({
    meta: [
      { title: "Projects Kanban — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Manage onboarding projects in the Handover Kanban view." },
      { property: "og:title", content: "Projects Kanban — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Manage onboarding projects in the Handover Kanban view." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
