import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/projects/go-live")({
  head: () => ({
    meta: [
      { title: "Go-Live Tracker — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Track expected go-live dates and delivery readiness for onboarding projects." },
      { property: "og:title", content: "Go-Live Tracker — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Track expected go-live dates and delivery readiness for onboarding projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
