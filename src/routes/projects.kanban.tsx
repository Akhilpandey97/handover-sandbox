import { createFileRoute } from "@tanstack/react-router";
import Index from "@/page-views/Index";

export const Route = createFileRoute("/projects/kanban")({
  head: () => ({
    meta: [
      { title: "Projects Kanban — Handover" },
      { name: "description", content: "Manage onboarding projects in the Handover Kanban view." },
      { property: "og:title", content: "Projects Kanban — Handover" },
      { property: "og:description", content: "Manage onboarding projects in the Handover Kanban view." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <Index initialProjectView="kanban" />,
});