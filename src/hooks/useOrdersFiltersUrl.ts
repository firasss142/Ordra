"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  filtersToSearchParams,
  parseFiltersFromSearchParams,
  type OrderListFilters,
} from "@/lib/orders/list-filters";

/** URL params carried alongside filters but not part of the filter model. */
const PASSTHROUGH_PARAM_KEYS = ["open", "view"] as const;

export function useOrdersFiltersUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFiltersFromSearchParams(new URLSearchParams(searchParams)),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: OrderListFilters) => {
      const params = filtersToSearchParams(next);
      // Preserve UI-only params (detail panel deep-link, view mode) that live
      // outside the filter model — they must survive filter changes but never
      // enter SWR keys or the export URL.
      for (const key of PASSTHROUGH_PARAM_KEYS) {
        const value = searchParams?.get(key);
        if (value !== null && value !== undefined) params.set(key, value);
      }
      const qs = params.toString();
      // Native replaceState, not router.replace. The router version makes
      // Next refetch this page's RSC payload — middleware calls GoTrue,
      // page.tsx re-runs its exact count and agents query — on every facet
      // click and every search pause, for a render that ignores the filters
      // anyway. Next 14.1+ syncs useSearchParams with the History API, so the
      // filters still re-parse from the URL. The state MUST be null: the
      // patched replaceState returns early when the state already carries
      // Next's own `__NA` marker, and the current entry always does.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, searchParams],
  );

  const update = useCallback(
    (patch: Partial<OrderListFilters>) => {
      setFilters({ ...filters, ...patch });
    },
    [filters, setFilters],
  );

  return { filters, setFilters, update };
}
