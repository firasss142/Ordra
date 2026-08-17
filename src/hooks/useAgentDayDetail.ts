"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AgentDayDetail } from "@/lib/team/types";

export function buildAgentDayKey(marketId: string, agentId: string, day: string): string {
  const p = new URLSearchParams({ market_id: marketId, agent_id: agentId, day });
  return `/api/team/agent-day?${p.toString()}`;
}

/**
 * One agent-day. A past day never changes, so this neither polls nor
 * revalidates on focus; SWR's cache makes re-opening a cell instant.
 */
export function useAgentDayDetail(marketId: string, agentId: string | null, day: string | null) {
  const key = agentId && day ? buildAgentDayKey(marketId, agentId, day) : null;
  const { data, error, isLoading } = useSWR<{ data: AgentDayDetail }>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  });
  return { detail: data?.data ?? null, error, isLoading };
}
