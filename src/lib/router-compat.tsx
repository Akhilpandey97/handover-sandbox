/**
 * Small compatibility layer so the ported screens can keep using the familiar
 * `useSearchParams` / `useParams` / `useLocation` API while the app actually
 * runs on TanStack Router.
 */
import { useCallback, useMemo } from "react";
import {
  useLocation as useTanstackLocation,
  useParams as useTanstackParams,
  useRouter,
} from "@tanstack/react-router";

export function useLocation() {
  const loc = useTanstackLocation();
  return {
    pathname: loc.pathname,
    search: loc.searchStr,
    hash: loc.hash,
    state: loc.state,
  };
}

export function useParams<T extends Record<string, string | undefined>>(): T {
  return useTanstackParams({ strict: false }) as T;
}

type SetSearchParams = (
  next: URLSearchParams | Record<string, string> | ((prev: URLSearchParams) => URLSearchParams),
) => void;

export function useSearchParams(): [URLSearchParams, SetSearchParams] {
  const loc = useTanstackLocation();
  const router = useRouter();

  const searchParams = useMemo(() => new URLSearchParams(loc.searchStr), [loc.searchStr]);

  const setSearchParams = useCallback<SetSearchParams>(
    (next) => {
      let params: URLSearchParams;
      if (typeof next === "function") {
        params = next(new URLSearchParams(loc.searchStr));
      } else if (next instanceof URLSearchParams) {
        params = next;
      } else {
        params = new URLSearchParams(next);
      }
      const qs = params.toString();
      router.navigate({ to: loc.pathname + (qs ? `?${qs}` : ""), replace: true });
    },
    [loc.pathname, loc.searchStr, router],
  );

  return [searchParams, setSearchParams];
}
