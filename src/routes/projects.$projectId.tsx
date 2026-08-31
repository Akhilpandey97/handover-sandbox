import { createFileRoute } from "@tanstack/react-router";
import ProjectWorkspace from "@/pages/ProjectWorkspace";

export const Route = createFileRoute("/projects/$projectId")({
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
