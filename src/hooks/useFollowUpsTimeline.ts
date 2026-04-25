"use client";

import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/swr-config";
import type { FollowUpsListPage } from "@/lib/follow-ups/list";

const TIMELINE_LIMIT = 25;

export interface UseFollowUpsTimelineOptions {
  marketId: string | null;
  agentId: string | null;
  campaignId: string | null;
  fallbackFirstPage?: FollowUpsListPage;
}

export function useFollowUpsTimeline(opts: UseFollowUpsTimelineOptions) {
  const { marketId, agentId, campaignId, fallbackFirstPage } = opts;

  const baseQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("sort_by_due", "true");
    params.set("limit", String(TIMELINE_LIMIT));
    if (marketId) params.set("market_id", marketId);
    if (agentId) params.set("agent_id", agentId);
    if (campaignId) params.set("campaign_id", campaignId);
    return params;
  }, [marketId, agentId, campaignId]);

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

export type UseFollowUpsTimelineReturn = ReturnType<typeof useFollowUpsTimeline>;
