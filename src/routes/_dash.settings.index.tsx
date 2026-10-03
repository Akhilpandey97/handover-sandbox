import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Workspace settings for this Handover workspace." },
      { property: "og:title", content: "Settings — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Workspace settings for this Handover workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
