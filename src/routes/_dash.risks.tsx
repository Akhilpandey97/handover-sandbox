import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/risks")({
  head: () => ({
    meta: [
      { title: "Risks — Handover" },
      { name: "description", content: "Projects flagged as at risk across the onboarding portfolio." },
      { property: "og:title", content: "Risks — Handover" },
      { property: "og:description", content: "Projects flagged as at risk across the onboarding portfolio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
