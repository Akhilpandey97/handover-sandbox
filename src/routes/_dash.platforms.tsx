import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/platforms")({
  head: () => ({
    meta: [
      { title: "Platforms — Handover" },
      { name: "description", content: "Merchant onboarding projects grouped by ecommerce platform." },
      { property: "og:title", content: "Platforms — Handover" },
      { property: "og:description", content: "Merchant onboarding projects grouped by ecommerce platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
