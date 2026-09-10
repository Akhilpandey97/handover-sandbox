import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/reports/")({
  head: () => ({
    meta: [
      { title: "Reports — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Executive, operational and merchant reports across onboarding projects." },
      { property: "og:title", content: "Reports — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Executive, operational and merchant reports across onboarding projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
