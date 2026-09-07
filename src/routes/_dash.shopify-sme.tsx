import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/shopify-sme")({
  head: () => ({
    meta: [
      { title: "Shopify SME — Handover" },
      { name: "description", content: "Shopify SME and Enterprise onboarding pipeline." },
      { property: "og:title", content: "Shopify SME — Handover" },
      { property: "og:description", content: "Shopify SME and Enterprise onboarding pipeline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
