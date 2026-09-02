import { createFileRoute } from "@tanstack/react-router";
import ProjectWorkspace from "@/pages/ProjectWorkspace";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search['tab'] === "string" ? search['tab'] : undefined,
    item: typeof search['item'] === "string" ? search['item'] : undefined,
    task: typeof search['task'] === "string" ? search['task'] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Project Details — Handover" },
      { name: "description", content: "Project workspace with checklist progress, activity timeline, notes and handover details." },
      { property: "og:title", content: "Project Details — Handover" },
      { property: "og:description", content: "Project workspace with checklist progress, activity timeline, notes and handover details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProjectWorkspace,
});
