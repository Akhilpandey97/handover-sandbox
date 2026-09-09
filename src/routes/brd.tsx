import { createFileRoute } from "@tanstack/react-router";
import BrdForm from "@/page-views/BrdForm";

export const Route = createFileRoute("/brd")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Business Requirements Form | Handover — Onboarding/Integrations Command Center" },
      {
        name: "description",
        content:
          "Complete the guided business requirements document for your integration and submit it to your onboarding team.",
      },
      { property: "og:title", content: "Business Requirements Form" },
      {
        property: "og:description",
        content: "Guided BRD collection for merchant onboarding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BrdForm,
});
