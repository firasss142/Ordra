"use client";

import useSWR from "swr";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";

/**
 * The buildings a market prepares from.
 *
 * Libya has two, Tripoli and Benghazi, one per Darb Assabil account; Tunisia
 * has one. The list is small, changes almost never, and is needed by two very
 * different screens — the user admin, to assign an agent, and the bench itself,
 * to name the building on show — so it is fetched once and cached.
 *
 * `marketId` is null for a super_admin who has not picked a market; the route
 * then answers with whatever the scope cookie says, which is the same rule
 * every other warehouse screen follows.
 */
const fetcher = async (url: string): Promise<WarehouseSitesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("sites_unavailable");
  return res.json();
};

export function useWarehouseSites(marketId?: string | null) {
  const key = marketId
    ? `/api/warehouse/sites?market_id=${encodeURIComponent(marketId)}`
    : "/api/warehouse/sites";

  const { data, error, isLoading } = useSWR<WarehouseSitesResponse>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

  return {
    sites: data?.sites ?? [],
    mine: data?.mine ?? null,
    pinned: data?.pinned ?? false,
    unassigned: data?.unassigned ?? false,
    isLoading,
    error,
  };
}
