import useSWR from "swr";
import type { CarrierPerfResponse } from "@/app/api/carriers/performance/route";

/**
 * Per-carrier 30-day delivery rate + median transit time, for the "meilleur
 * choix" comparison in the post-confirm carrier picker.
 *
 * Fails soft by design, like useCarrierRates: on error or while loading,
 * `performanceByCarrierId` is empty, so compareCarriers just scores on
 * whatever other metrics (cost) are available.
 */

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch carrier performance");
    return res.json() as Promise<CarrierPerfResponse>;
  });

export interface CarrierPerformanceInfo {
  deliveryRate30d: number | null;
  medianTransitHours: number | null;
  sampleSize: number;
}

export interface UseCarrierPerformanceResult {
  performanceByCarrierId: Record<string, CarrierPerformanceInfo>;
  isLoading: boolean;
}

export function useCarrierPerformance(
  marketId: string | null | undefined,
  enabled: boolean,
): UseCarrierPerformanceResult {
  const key =
    enabled && marketId
      ? `/api/carriers/performance?market_id=${marketId}`
      : null;

  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  });

  const performanceByCarrierId: Record<string, CarrierPerformanceInfo> = {};
  for (const row of data?.data ?? []) {
    performanceByCarrierId[row.carrier_id] = {
      deliveryRate30d: row.delivery_rate_30d,
      medianTransitHours: row.median_transit_hours,
      sampleSize: row.sample_size,
    };
  }

  return {
    performanceByCarrierId,
    isLoading: Boolean(key) && isLoading,
  };
}
