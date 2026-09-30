"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { RejectionReasonConfig } from "@/types/rejection-config";

interface Response {
  data: RejectionReasonConfig[];
}

/**
 * A market's rejection taxonomy — the same rows the manager edits in
 * Système › Paramètres › Motifs de rejet and the agent picks from.
 *
 * Every role in the market may read it (RLS allows SELECT market-wide), because
 * the agent's picker and the manager's status column are two views of one list.
 *
 * Cached hard on purpose: this changes when someone edits a settings screen,
 * not when an order moves, and it is read by every row of a thousand-row table.
 */
export function useRejectionReasons(marketId: string | null) {
  const key = marketId
    ? `/api/settings/rejection-reasons?market_id=${marketId}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<Response>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });

  return {
    // `Array.isArray` rather than `?? []`: a 500 answers with `{ error }` and an
    // aborted fetch with undefined, and every caller here does `rows.find`.
    rows: Array.isArray(data?.data) ? data.data : [],
    error,
    isLoading,
    mutate,
  };
}
