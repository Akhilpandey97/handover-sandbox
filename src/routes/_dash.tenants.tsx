import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dash/tenants")({
  head: () => ({
    meta: [
      { title: "Tenants — Handover" },
      { name: "description", content: "Manage tenant workspaces and their teams." },
      { property: "og:title", content: "Tenants — Handover" },
      { property: "og:description", content: "Manage tenant workspaces and their teams." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
