import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/")({
  head: () => ({
    meta: [
      { title: "Handover — Onboarding/Integrations Command Center" },
      {
        name: "description",
        content:
          "Customer onboarding/Integration software to track projects, checklists, risks and go-live timelines.",
      },
      { property: "og:title", content: "Handover — Onboarding/Integrations Command Center" },
      {
        property: "og:description",
        content:
          "Customer onboarding/Integration software to track projects, checklists, risks and go-live timelines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
