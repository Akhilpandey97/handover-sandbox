import { createFileRoute } from "@tanstack/react-router";
import Index from "@/page-views/Index";

export const Route = createFileRoute("/projects/list")({
  head: () => ({
    meta: [
      { title: "Projects List — Handover" },
      { name: "description", content: "Review and manage onboarding projects in a detailed list." },
      { property: "og:title", content: "Projects List — Handover" },
      { property: "og:description", content: "Review and manage onboarding projects in a detailed list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <Index initialProjectView="list" />,
});