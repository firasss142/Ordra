"use client";

import { useMemo, useState } from "react";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import {
  applyScannedFilters,
  scannedFacets,
  sortScanned,
  EMPTY_SCANNED_FILTER,
  type ScannedFilter,
} from "@/lib/warehouse/scanned-filters";

/**
 * The filter state of the scanned list, held once for both surfaces.
 *
 * The phone and the desk showed the same hundred rows in two different orders
 * and with no way to narrow either. Sharing the state as well as the functions
 * is what stops "à vérifier" meaning one thing on a phone and another at a desk.
 */
export function useScannedView(rows: ScannedRow[]) {
  const [filter, setFilter] = useState<ScannedFilter>(EMPTY_SCANNED_FILTER);

  const facets = useMemo(() => scannedFacets(rows), [rows]);
  const shown = useMemo(() => sortScanned(applyScannedFilters(rows, filter)), [rows, filter]);
  const active =
    filter.seg !== "all" ||
    filter.hex !== null ||
    filter.product !== null ||
    filter.who !== null ||
    filter.q.trim() !== "";

  return {
    filter,
    setFilter,
    patch: (next: Partial<ScannedFilter>) => setFilter((f) => ({ ...f, ...next })),
    clear: () => setFilter(EMPTY_SCANNED_FILTER),
    facets,
    shown,
    active,
  };
}
