import { createFileRoute } from "@tanstack/react-router";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import { BuddyDrawer } from "@/components/buddy/BuddyDrawer";

type ProjectSearch = { tab?: string; item?: string; task?: string; comment?: string; from?: "kanban" | "list" | "go-live" };

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const out: ProjectSearch = {};
    if (typeof search['tab'] === "string") out.tab = search['tab'];
    if (typeof search['item'] === "string") out.item = search['item'];
    if (typeof search['task'] === "string") out.task = search['task'];
    if (typeof search['comment'] === "string") out.comment = search['comment'];
    if (search['from'] === "kanban" || search['from'] === "list" || search['from'] === "go-live") out.from = search['from'];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Project Details — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Project workspace with checklist progress, activity timeline, notes and handover details." },
      { property: "og:title", content: "Project Details — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Project workspace with checklist progress, activity timeline, notes and handover details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProjectWorkspacePage,
});

function ProjectWorkspacePage() {
  return (
    <>
      <ProjectWorkspace />
      <BuddyDrawer />
    </>
  );
}
