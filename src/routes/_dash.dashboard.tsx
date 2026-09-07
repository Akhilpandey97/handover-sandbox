import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Handover" },
      { name: "description", content: "Portfolio overview of onboarding projects, KPIs and team performance." },
      { property: "og:title", content: "Dashboard — Handover" },
      { property: "og:description", content: "Portfolio overview of onboarding projects, KPIs and team performance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
