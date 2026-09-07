import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/emails")({
  head: () => ({
    meta: [
      { title: "Emails — Handover" },
      { name: "description", content: "Parsed onboarding emails matched to merchant projects." },
      { property: "og:title", content: "Emails — Handover" },
      { property: "og:description", content: "Parsed onboarding emails matched to merchant projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
