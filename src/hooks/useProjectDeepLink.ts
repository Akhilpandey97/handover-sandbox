import { useEffect } from "react";
import { useSearchParams } from "@/lib/router-compat";

export interface ProjectDeepLink {
  tab: string | null;
  item: string | null;
  task: string | null;
  comment: string | null;
}

/**
 * Reads /projects/:id?tab=&item=&task=&comment= reactively, so clicking a second
 * notification while already on the workspace re-targets instead of doing nothing.
 */
export const useProjectDeepLink = (): ProjectDeepLink => {
  const [params] = useSearchParams();
  return {
    tab: params.get("tab"),
    item: params.get("item"),
    task: params.get("task"),
    comment: params.get("comment"),
  };
};

/**
 * Scrolls to an element that may not be mounted yet (the checklist renders after
 * its query resolves) and flashes a ring so the target is obvious on arrival.
 */
export const useScrollToAnchor = (elementId: string | null, enabled = true) => {
  useEffect(() => {
    if (!elementId || !enabled || typeof window === "undefined") return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(elementId);
      attempts += 1;
      if (el) {
        window.clearInterval(timer);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary", "ring-offset-2");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 4000);
      } else if (attempts > 30) {
        window.clearInterval(timer);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [elementId, enabled]);
};
