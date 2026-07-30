"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

interface LatestActivityResponse {
  data: { latest_activity_date: string | null };
}

// Fetches the date of the most recent order_history activity for a market so the
// dashboard/P&L can anchor its default period to real data instead of "today".
// Pass null to skip the fetch (e.g. non-super_admins who never switch markets).
//
// Returns `forMarket` — the market the returned `latest` actually belongs to —
// so callers can avoid acting on a stale value during a market switch (SWR keeps
// the previous key's data momentarily while the new key loads).
export function useLatestActivity(marketId: string | null): {
  latest: string | null;
  forMarket: string | null;
  isLoading: boolean;
} {
  const key = marketId
    ? `/api/dashboard/latest-activity?market_id=${encodeURIComponent(marketId)}`
    : null;

  const { data, isLoading } = useSWR<LatestActivityResponse>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    keepPreviousData: false,
  });

  return {
    latest: data?.data?.latest_activity_date ?? null,
    forMarket: data ? marketId : null,
    isLoading,
  };
}
