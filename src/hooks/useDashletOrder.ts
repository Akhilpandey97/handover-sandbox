import { useCallback, useState } from "react";

const DEFAULT_STORAGE_KEY = "dashboard_dashlet_order";

export interface CustomDashletConfig {
  /** Always prefixed with `custom:` so it can never clash with a built-in id. */
  id: string;
  title: string;
  /** Project field the dashlet groups by. */
  field: string;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

/**
 * Dashboard section order, visibility and tenant-built custom dashlets,
 * remembered per browser like the other view preferences.
 *
 * `storageKey` keeps separate arrangements apart — the manager dashboard, the
 * user dashboard and the KPI bar each remember their own layout.
 */
export const useDashletOrder = (defaultOrder: string[], storageKey: string = DEFAULT_STORAGE_KEY) => {
  const hiddenKey = `${storageKey}_hidden`;
  const customKey = `${storageKey}_custom`;

  const [custom, setCustom] = useState<CustomDashletConfig[]>(() => {
    const saved = read<CustomDashletConfig[]>(customKey, []);
    return Array.isArray(saved) ? saved : [];
  });

  const [hidden, setHidden] = useState<string[]>(() => {
    const saved = read<string[]>(hiddenKey, []);
    return Array.isArray(saved) ? saved : [];
  });

  const [order, setOrder] = useState<string[]>(() => {
    const known = [...defaultOrder, ...read<CustomDashletConfig[]>(customKey, []).map((c) => c.id)];
    const parsed = read<string[] | null>(storageKey, null);
    if (!Array.isArray(parsed) || parsed.length === 0) return known;
    // A section added since the last drag keeps its default position rather
    // than disappearing because the saved list never mentioned it.
    return [...parsed.filter((k) => known.includes(k)), ...known.filter((k) => !parsed.includes(k))];
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
    setOrder((current) => { write(storageKey, current); return current; });
  };

  const toggleHidden = useCallback((id: string) => {
    setHidden((current) => {
      const next = current.includes(id) ? current.filter((k) => k !== id) : [...current, id];
      write(hiddenKey, next);
      return next;
    });
  }, [hiddenKey]);

  const addCustom = useCallback((config: Omit<CustomDashletConfig, "id">) => {
    const id = `custom:${Date.now().toString(36)}`;
    setCustom((current) => { const next = [...current, { ...config, id }]; write(customKey, next); return next; });
    setOrder((current) => { const next = [...current, id]; write(storageKey, next); return next; });
  }, [customKey, storageKey]);

  const removeCustom = useCallback((id: string) => {
    setCustom((current) => { const next = current.filter((c) => c.id !== id); write(customKey, next); return next; });
    setOrder((current) => { const next = current.filter((k) => k !== id); write(storageKey, next); return next; });
  }, [customKey, storageKey]);

  const visibleOrder = order.filter((id) => !hidden.includes(id));

  return {
    order,
    visibleOrder,
    hidden,
    toggleHidden,
    custom,
    addCustom,
    removeCustom,
    dragging,
    onDragStart,
    onDragOver,
    onDragEnd,
  };
};
