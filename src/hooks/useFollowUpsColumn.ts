"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import type { FollowUpsListPage } from "@/lib/follow-ups/list";
import type { FollowUpStatus } from "@/types/follow-up";

const fetcher = async (url: string): Promise<FollowUpsListPage> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`follow-ups list ${res.status}`);
  return res.json();
};

const COLUMN_LIMIT = 25;

export interface UseFollowUpsColumnOptions {
  status: FollowUpStatus;
  marketId: string | null;
  agentId: string | null;
  campaignId: string | null;
  /** SSR-prefetched first page so the Kanban renders instantly. */
  fallbackFirstPage?: FollowUpsListPage;
}

export function useFollowUpsColumn(opts: UseFollowUpsColumnOptions) {
  const { status, marketId, agentId, campaignId, fallbackFirstPage } = opts;

  const baseQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("limit", String(COLUMN_LIMIT));
    if (marketId) params.set("market_id", marketId);
    if (agentId) params.set("agent_id", agentId);
    if (campaignId) params.set("campaign_id", campaignId);
    return params;
  }, [status, marketId, agentId, campaignId]);

  const getKey = useCallback(
    (pageIndex: number, previousPage: FollowUpsListPage | null) => {
      if (previousPage && !previousPage.nextCursor) return null;
      const params = new URLSearchParams(baseQuery);
      if (previousPage?.nextCursor) params.set("cursor", previousPage.nextCursor);
      return `/api/follow-ups?${params.toString()}`;
    },
    [baseQuery],
  );

  const {
    data,
    error,
    isLoading,
    isValidating,
    setSize,
    size,
    mutate,
  } = useSWRInfinite<FollowUpsListPage>(getKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    fallbackData: fallbackFirstPage ? [fallbackFirstPage] : undefined,
    keepPreviousData: true,
  });

  const rows = useMemo(
    () => (data ? data.flatMap((p) => p.rows) : []),
    [data],
  );
  const hasMore = data ? Boolean(data[data.length - 1]?.nextCursor) : false;
  const loadingMore = isValidating && data != null && size > data.length;

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) setSize(size + 1);
  }, [hasMore, loadingMore, setSize, size]);

  return {
    status,
    rows,
    pages: data ?? [],
    error,
    isLoading: isLoading && !data,
    isValidating,
    hasMore,
    loadingMore,
    loadMore,
    mutate,
  };
}

export type UseFollowUpsColumnReturn = ReturnType<typeof useFollowUpsColumn>;
