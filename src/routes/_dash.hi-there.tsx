import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/hi-there")({
  head: () => ({
    meta: [
      { title: "Hi there — Handover" },
      { name: "description", content: "Ask the assistant about your onboarding projects and take actions on them." },
      { property: "og:title", content: "Hi there — Handover" },
      { property: "og:description", content: "Ask the assistant about your onboarding projects and take actions on them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
