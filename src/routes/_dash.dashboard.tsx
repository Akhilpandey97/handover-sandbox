import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/dashboard")({
  head: () => ({
    meta: [
      { title: "Workbench — Handover — Onboarding/Integrations Command Center" },
      { name: "description", content: "Your onboarding project workbench with incoming work, delivery health, risks and go-live readiness." },
      { property: "og:title", content: "Workbench — Handover — Onboarding/Integrations Command Center" },
      { property: "og:description", content: "Your onboarding project workbench with incoming work, delivery health, risks and go-live readiness." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
