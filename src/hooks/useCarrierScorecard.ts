"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { ParcelKind, Scorecard, ScorecardParcel } from "@/lib/carriers/scorecard/types";

export function buildCarrierScorecardKey(marketId: string, days: number): string {
  const p = new URLSearchParams({ market_id: marketId, days: String(days) });
  return `/api/carriers/scorecard?${p.toString()}`;
}

export function buildScorecardParcelsKey(marketId: string, carrierId: string, kind: ParcelKind): string {
  const p = new URLSearchParams({ market_id: marketId, carrier_id: carrierId, kind });
  return `/api/carriers/scorecard/parcels?${p.toString()}`;
}

/**
 * Transporteurs — read daily; the carrier sync moves the numbers every few
 * minutes, so a 5-minute poll is enough and focus does not refetch.
 */
export function useCarrierScorecard(marketId: string | null, days: number) {
  const { data, error, isLoading, mutate } = useSWR<{ data: Scorecard }>(
    marketId ? buildCarrierScorecardKey(marketId, days) : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false, keepPreviousData: true },
  );
  return { scorecard: data?.data ?? null, error, isLoading, mutate };
}

/** The parcels behind a number — loaded only while its drawer is open. */
export function useScorecardParcels(marketId: string | null, carrierId: string | null, kind: ParcelKind | null) {
  const { data, error, isLoading } = useSWR<{ data: ScorecardParcel[] }>(
    marketId && carrierId && kind ? buildScorecardParcelsKey(marketId, carrierId, kind) : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  return { parcels: data?.data ?? [], error, isLoading };
}
