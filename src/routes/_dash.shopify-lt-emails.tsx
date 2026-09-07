import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/shopify-lt-emails")({
  head: () => ({
    meta: [
      { title: "Shopify LT Email Comms — Handover" },
      { name: "description", content: "Shopify long-tail integration email communications." },
      { property: "og:title", content: "Shopify LT Email Comms — Handover" },
      { property: "og:description", content: "Shopify long-tail integration email communications." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
