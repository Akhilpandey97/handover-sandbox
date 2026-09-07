import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/archived")({
  head: () => ({
    meta: [
      { title: "Archived — Handover" },
      { name: "description", content: "Archived merchant onboarding projects." },
      { property: "og:title", content: "Archived — Handover" },
      { property: "og:description", content: "Archived merchant onboarding projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
