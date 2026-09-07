import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/")({
  head: () => ({
    meta: [
      { title: "Handover — Onboarding Command Center" },
      {
        name: "description",
        content:
          "Track merchant onboarding projects, checklists, risks and go-live timelines across Mint, Integration and Merchant Success teams.",
      },
      { property: "og:title", content: "Handover — Onboarding Command Center" },
      {
        property: "og:description",
        content:
          "Track merchant onboarding projects, checklists, risks and go-live timelines in one workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
