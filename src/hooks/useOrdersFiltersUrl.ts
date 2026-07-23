"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  filtersToSearchParams,
  parseFiltersFromSearchParams,
  type OrderListFilters,
} from "@/lib/orders/list-filters";

/** URL params carried alongside filters but not part of the filter model. */
const PASSTHROUGH_PARAM_KEYS = ["open", "view"] as const;

export function useOrdersFiltersUrl() {
  const router = useRouter();
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
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const update = useCallback(
    (patch: Partial<OrderListFilters>) => {
      setFilters({ ...filters, ...patch });
    },
    [filters, setFilters],
  );

  return { filters, setFilters, update };
}
