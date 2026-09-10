import { useState } from "react";

const DEFAULT_STORAGE_KEY = "dashboard_dashlet_order";

/**
 * Dashboard section order, remembered per browser like the other view
 * preferences (tab order, list columns, kanban columns).
 *
 * `storageKey` keeps separate arrangements apart — the manager dashboard, the
 * user dashboard and the KPI bar each remember their own order.
 */
export const useDashletOrder = (defaultOrder: string[], storageKey: string = DEFAULT_STORAGE_KEY) => {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved ? (JSON.parse(saved) as string[]) : null;
      if (!Array.isArray(parsed) || parsed.length === 0) return defaultOrder;
      // A section added since the last drag keeps its default position rather
      // than disappearing because the saved list never mentioned it.
      return [...parsed.filter((k) => defaultOrder.includes(k)), ...defaultOrder.filter((k) => !parsed.includes(k))];
    } catch {
      return defaultOrder;
    }
  });


  const [dragging, setDragging] = useState<string | null>(null);

  const onDragStart = (id: string) => setDragging(id);

  const onDragOver = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    setOrder((current) => {
      const next = [...current];
      const from = next.indexOf(dragging);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return current;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const onDragEnd = () => {
    setDragging(null);
    // Read through the setter: `order` in this closure is the value from the
    // render that registered the handler, so the last move would be lost.
    setOrder((current) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
      return current;
    });
  };

  return { order, dragging, onDragStart, onDragOver, onDragEnd };
};
