import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/go-live")({
  head: () => ({
    meta: [
      { title: "Go-Live Tracker — Handover" },
      { name: "description", content: "Monthly go-live tracker for merchant onboarding projects." },
      { property: "og:title", content: "Go-Live Tracker — Handover" },
      { property: "og:description", content: "Monthly go-live tracker for merchant onboarding projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
