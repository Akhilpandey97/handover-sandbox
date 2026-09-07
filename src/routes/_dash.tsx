import { createFileRoute } from "@tanstack/react-router";
import Index from "@/page-views/Index";

/**
 * Pathless layout for every dashboard tab. Each tab is a child route that
 * contributes only a path and page metadata, so moving between tabs keeps this
 * component mounted instead of remounting the dashboard and discarding its
 * filters, sorts and scroll position.
 */
export const Route = createFileRoute("/_dash")({
  component: Index,
});
