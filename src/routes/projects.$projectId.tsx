import { createFileRoute } from "@tanstack/react-router";
import ProjectWorkspace from "@/pages/ProjectWorkspace";

type ProjectSearch = { tab?: string; item?: string; task?: string };

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const out: ProjectSearch = {};
    if (typeof search['tab'] === "string") out.tab = search['tab'];
    if (typeof search['item'] === "string") out.item = search['item'];
    if (typeof search['task'] === "string") out.task = search['task'];
    return out;
  },
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
