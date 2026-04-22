"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  filtersToSearchParams,
  parseFiltersFromSearchParams,
  type OrderListFilters,
} from "@/lib/orders/list-filters";

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
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const update = useCallback(
    (patch: Partial<OrderListFilters>) => {
      setFilters({ ...filters, ...patch });
    },
    [filters, setFilters],
  );

  return { filters, setFilters, update };
}
