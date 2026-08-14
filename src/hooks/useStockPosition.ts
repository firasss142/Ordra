import useSWR from "swr";
import type {
  DemandWindowDays,
  StockPosition,
} from "@/lib/inventory/stock-position-types";

/**
 * Exported so "changing the window changes the key" is a unit test rather than
 * a hope. The window belongs IN the key: SWR then caches each window
 * separately and toggling 7↔90 is instant instead of clobbering the cache.
 */
export function buildStockKey(o: {
  windowDays: DemandWindowDays;
  marketId?: string | null;
}): string {
  const p = new URLSearchParams({ window: String(o.windowDays) });
  if (o.marketId) p.set("market_id", o.marketId);
  return `/api/inventory/position?${p.toString()}`;
}

export function useStockPosition(key: string) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: StockPosition }>(
    key,
    {
      revalidateOnFocus: false,
      refreshInterval: 120_000,
      dedupingInterval: 30_000,
      keepPreviousData: true,
    },
  );

  return { position: data?.data ?? null, error, isLoading, isValidating, mutate };
}
