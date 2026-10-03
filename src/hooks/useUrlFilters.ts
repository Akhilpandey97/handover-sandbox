import { useCallback, useMemo } from "react";
import { useSearchParams } from "@/lib/router-compat";

export type FilterValue = string | string[];

/**
 * Filter state that lives in the URL.
 *
 * Filters were component state, so they died on reload and could not be sent to
 * anyone: the reason a filtered table gets screenshotted instead of linked. Held
 * here they survive a refresh, the back button walks through them, and the
 * address bar is the share link.
 *
 * Arrays round-trip as comma-separated values. A filter at its default is left
 * out of the URL entirely, so an unfiltered view stays a clean address.
 */
export const useUrlFilters = <T extends Record<string, FilterValue>>(
  prefix: string,
  defaults: T,
) => {
  const [params, setParams] = useSearchParams();

  const key = useCallback((name: string) => (prefix ? `${prefix}_${name}` : name), [prefix]);

  const values = useMemo(() => {
    const out = { ...defaults };
    for (const name of Object.keys(defaults) as Array<keyof T & string>) {
      const raw = params.get(key(name));
      if (raw === null) continue;
      out[name] = (Array.isArray(defaults[name])
        ? (raw ? raw.split(",").filter(Boolean) : [])
        : raw) as T[keyof T & string];
    }
    return out;
  }, [params, defaults, key]);

  const setValue = useCallback(
    (name: keyof T & string, value: FilterValue) => {
      setParams((prev: URLSearchParams) => {
        const next = new URLSearchParams(prev);
        const dflt = defaults[name];
        const isDefault = Array.isArray(dflt)
          ? Array.isArray(value) && value.length === 0
          : value === dflt;
        if (isDefault) next.delete(key(name));
        else next.set(key(name), Array.isArray(value) ? value.join(",") : value);
        return next;
      });
    },
    [setParams, defaults, key],
  );

  /** Add or remove one value of a multi-select filter. */
  const toggleValue = useCallback(
    (name: keyof T & string, value: string) => {
      const current = values[name];
      const list: string[] = Array.isArray(current) ? current : [];
      setValue(name, list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    },
    [values, setValue],
  );

  const clear = useCallback(() => {
    setParams((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev);
      for (const name of Object.keys(defaults)) next.delete(key(name));
      return next;
    });
  }, [setParams, defaults, key]);

  /** How many filters are away from their default — the number on the trigger. */
  const activeCount = useMemo(
    () =>
      (Object.keys(defaults) as Array<keyof T & string>).filter((name) => {
        const v = values[name];
        const d = defaults[name];
        return Array.isArray(d) ? Array.isArray(v) && v.length > 0 : v !== d;
      }).length,
    [values, defaults],
  );

  return { values, setValue, toggleValue, clear, activeCount };
};
