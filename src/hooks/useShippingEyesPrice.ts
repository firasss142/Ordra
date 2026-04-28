import useSWR from "swr";
import type { PriceResult } from "@/app/api/dexpress/price-calculator/route";

export type PriceStatus = "idle" | "loading" | "ready" | "fallback" | "error";

export interface UseShippingEyesPriceOptions {
  stateId: number | null;
  placeId?: number | null;
  womenDelivery?: boolean;
  weight?: number;
  /** Static carrier delivery_fee — used as the displayed amount in fallback/error states */
  fallbackDeliveryFee: number;
  /** Set false to skip the fetch even when stateId is set (e.g. picker not yet committed) */
  enabled?: boolean;
}

export interface UseShippingEyesPriceResult {
  /** The shipping cost we should attach to the order (live when ready, fallback otherwise) */
  effectiveShippingCost: number;
  /** Live shipping cost from the carrier, or null if not available */
  livePrice: number | null;
  status: PriceStatus;
  errorMessage: string | null;
  /** Optional breakdown when carrier provides one (basic + extra weight cost) */
  breakdown: PriceResult["breakdown"];
}

const fetcher = async (url: string): Promise<PriceResult> => {
  const res = await fetch(url);
  return (await res.json()) as PriceResult;
};

export function useShippingEyesPrice(
  opts: UseShippingEyesPriceOptions
): UseShippingEyesPriceResult {
  const { stateId, placeId, womenDelivery, weight, fallbackDeliveryFee, enabled = true } =
    opts;

  const params = new URLSearchParams();
  if (stateId != null) params.set("state_id", String(stateId));
  if (placeId != null) params.set("place_id", String(placeId));
  params.set("women_delivery", womenDelivery ? "1" : "0");
  if (typeof weight === "number") params.set("weight", String(weight));

  const shouldFetch = enabled && stateId != null;
  const key = shouldFetch
    ? `/api/dexpress/price-calculator?${params.toString()}`
    : null;

  const { data, error, isLoading } = useSWR<PriceResult>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    keepPreviousData: true,
  });

  if (!shouldFetch) {
    return {
      effectiveShippingCost: fallbackDeliveryFee,
      livePrice: null,
      status: "idle",
      errorMessage: null,
      breakdown: undefined,
    };
  }

  if (isLoading && !data) {
    return {
      effectiveShippingCost: fallbackDeliveryFee,
      livePrice: null,
      status: "loading",
      errorMessage: null,
      breakdown: undefined,
    };
  }

  if (error || !data) {
    return {
      effectiveShippingCost: fallbackDeliveryFee,
      livePrice: null,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "network",
      breakdown: undefined,
    };
  }

  if (data.ok && typeof data.shipping_cost === "number") {
    return {
      effectiveShippingCost: data.shipping_cost,
      livePrice: data.shipping_cost,
      status: "ready",
      errorMessage: null,
      breakdown: data.breakdown,
    };
  }

  // ok=false branch — not_found / carrier_error / invalid_input
  return {
    effectiveShippingCost: fallbackDeliveryFee,
    livePrice: null,
    status: data.reason === "not_found" ? "fallback" : "error",
    errorMessage: data.message ?? data.reason ?? null,
    breakdown: undefined,
  };
}
