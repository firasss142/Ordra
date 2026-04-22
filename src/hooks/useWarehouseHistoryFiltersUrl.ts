"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseWarehouseHistoryFilters,
  warehouseHistoryFiltersToSearchParams,
  type WarehouseHistoryFilters,
} from "@/lib/warehouse/list-filters";

export function useWarehouseHistoryFiltersUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseWarehouseHistoryFilters(new URLSearchParams(searchParams)),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: WarehouseHistoryFilters) => {
      const params = warehouseHistoryFiltersToSearchParams(next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const update = useCallback(
    (patch: Partial<WarehouseHistoryFilters>) => {
      setFilters({ ...filters, ...patch });
    },
    [filters, setFilters],
  );

  return { filters, setFilters, update };
}
