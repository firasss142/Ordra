"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useDebounce } from "@/hooks/useDebounce";
import {
  MARKET_SEARCH_MIN,
  type MarketSearchResult,
  type MarketSearchRow,
} from "@/lib/agent-search/market";

/** Long enough to skip the keystrokes of a word, short enough to feel live. */
const DEBOUNCE_MS = 250;

export interface AgentMarketSearch {
  rows: MarketSearchRow[];
  total: number;
  /** The market's answer for what is typed now has not arrived yet. */
  pending: boolean;
  error: boolean;
}

/**
 * The market half of the agent search (`/api/agent/search`), for the dropdown.
 *
 * Accuracy over smoothness: the global SWR config keeps the previous key's
 * data while the next one loads, which here would show "salima"'s orders as
 * the answer to "salima sfax". So `keepPreviousData` is off, and a result is
 * only returned for the query it answers; in between, `pending` says the
 * market is still being searched. The agent's own orders do not wait on this —
 * they are matched instantly from the shell's caches.
 */
export function useAgentMarketSearch(query: string, enabled: boolean): AgentMarketSearch {
  const typed = query.trim();
  const settled = useDebounce(typed, DEBOUNCE_MS);
  const wanted = enabled && typed.length >= MARKET_SEARCH_MIN;
  const key = wanted && settled === typed ? `/api/agent/search?q=${encodeURIComponent(settled)}` : null;

  const { data, error, isLoading } = useSWR<MarketSearchResult>(key, fetcher, {
    keepPreviousData: false,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 30_000,
  });

  const current = key !== null && !!data;
  return {
    rows: current ? data.rows : [],
    total: current ? data.total : 0,
    pending: wanted && (key === null || isLoading),
    error: key !== null && !!error,
  };
}
