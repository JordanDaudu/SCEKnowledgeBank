import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Syncs a record of filter values to the URL query string.
 *
 * - Reads the current `search` string on each render so initial values can be
 *   derived from the URL by the caller.
 * - When the caller's `state` changes, writes a new query string via
 *   `setLocation(pathname?search, { replace: true })`.
 * - Values that are `undefined`, `null`, or an empty string are omitted from
 *   the URL. Arrays are serialized as repeated keys.
 */
export function useQueryStateSync(
  state: Record<string, string | number | string[] | undefined | null>,
) {
  const [location, setLocation] = useLocation();
  const currentSearch = useSearch();

  const nextSearch = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (value == null || value === "") continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v != null && v !== "") params.append(key, String(v));
        }
      } else {
        params.set(key, String(value));
      }
    }
    params.sort();
    return params.toString();
  }, [state]);

  useEffect(() => {
    const current = new URLSearchParams(currentSearch);
    current.sort();
    if (current.toString() === nextSearch) return;
    const target = nextSearch ? `${location}?${nextSearch}` : location;
    setLocation(target, { replace: true });
  }, [nextSearch, currentSearch, location, setLocation]);
}

export function parseSearch(search: string) {
  return new URLSearchParams(search);
}
