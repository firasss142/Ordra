import useSWR from "swr";
import type { CarrierRateInfo } from "@/lib/carriers/rate-badge";

/**
 * Per-carrier delivery price for one order's destination, plus which account is
 * cheapest. Powers the price badge in both carrier pickers.
 *
 * Fails soft by design: on error or while loading, `ratesByCarrierId` is empty
 * and `recommendedCarrierId` is null, so the pickers render exactly as they did
 * before this feature existed.
 */

interface RateRow {
  carrier_id: string;
  quoted_fee: number | null;
  quote_usable: boolean;
  true_cost_per_delivered: number | null;
  effective_cost: number | null;
  is_cheapest: boolean;
}

interface RatesResponse {
  data: {
    recommended_carrier_id: string | null;
    reason: string;
    rates: RateRow[];
  };
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch carrier rates");
    return res.json() as Promise<RatesResponse>;
  });

export interface UseCarrierRatesResult {
  ratesByCarrierId: Record<string, CarrierRateInfo>;
  recommendedCarrierId: string | null;
  reason: string | null;
  isLoading: boolean;
}

export function useCarrierRates(
  orderId: string | null | undefined,
  enabled: boolean,
): UseCarrierRatesResult {
  const key = enabled && orderId ? `/api/carriers/rates?order_id=${orderId}` : null;

  const { data, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    // A missing badge is a non-event; don't hammer the carrier API path.
    shouldRetryOnError: false,
  });

  const ratesByCarrierId: Record<string, CarrierRateInfo> = {};
  for (const r of data?.data.rates ?? []) {
    ratesByCarrierId[r.carrier_id] = {
      carrierId: r.carrier_id,
      quotedFee: r.quoted_fee,
      quoteUsable: r.quote_usable,
      trueCostPerDelivered: r.true_cost_per_delivered,
      effectiveCost: r.effective_cost,
      isCheapest: r.is_cheapest,
    };
  }

  return {
    ratesByCarrierId,
    recommendedCarrierId: data?.data.recommended_carrier_id ?? null,
    reason: data?.data.reason ?? null,
    isLoading: Boolean(key) && isLoading,
  };
}
