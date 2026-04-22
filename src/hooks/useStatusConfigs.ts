"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { StatusConfig, StatusScope } from "@/types/status-config";

interface Params {
  marketId: string | null;
  scope?: StatusScope;
}

interface Response {
  data: StatusConfig[];
}

/**
 * Fetches the configurable status rows for a market + optional scope.
 * Returns sorted by sort_order asc (server-enforced).
 *
 * Agents read the same list their kanban needs to render columns — RLS
 * allows SELECT for all roles in their market.
 */
export function useStatusConfigs({ marketId, scope }: Params) {
  const params = new URLSearchParams();
  if (marketId) params.set("market_id", marketId);
  if (scope) params.set("scope", scope);

  const key = marketId
    ? `/api/settings/statuses?${params.toString()}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<Response>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  return {
    configs: data?.data ?? [],
    error,
    isLoading,
    mutate,
  };
}
