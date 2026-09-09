import { createFileRoute } from "@tanstack/react-router";
import MerchantPortal from "@/page-views/MerchantPortal";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Merchant Onboarding Portal | Handover — Onboarding/Integrations Command Center" },
      {
        name: "description",
        content:
          "Track your onboarding progress, pending actions, documents and go-live date in your merchant portal.",
      },
      { property: "og:title", content: "Merchant Onboarding Portal | Handover — Onboarding/Integrations Command Center" },
      {
        property: "og:description",
        content: "Live view of your onboarding progress and pending actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MerchantPortal,
});
