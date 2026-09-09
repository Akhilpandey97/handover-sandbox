import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/projects/list")({
  head: () => ({
    meta: [
      { title: "Projects List — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Review and manage onboarding projects in a detailed list." },
      { property: "og:title", content: "Projects List — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Review and manage onboarding projects in a detailed list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
