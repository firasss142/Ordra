"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AgentPanel, TeamDay, TeamFunnel } from "@/lib/team/room/types";
import type { PeriodRange } from "@/lib/team/room/period";

/**
 * Salle de contrôle — one hook per RPC. Today refreshes every minute (who is
 * working changes by the minute); a past day and a period do not move, so they
 * are read once and kept while the user looks at something else.
 */
export function useTeamDay(marketId: string, day: string, live: boolean) {
  const key = `/api/team/day?${new URLSearchParams({ market_id: marketId, day })}`;
  const { data, error, isLoading, mutate } = useSWR<{ data: TeamDay }>(key, fetcher, {
    refreshInterval: live ? 60_000 : 0,
    revalidateOnFocus: live,
    keepPreviousData: true,
  });
  const payload = data?.data && "agents" in data.data ? data.data : null;
  return { day: payload, error, isLoading, mutate };
}

export function useTeamFunnel(marketId: string, range: PeriodRange) {
  const key = `/api/team/funnel?${new URLSearchParams({
    market_id: marketId,
    from: range.from,
    to: range.to,
    prev_from: range.prevFrom,
    prev_to: range.prevTo,
  })}`;
  const { data, error, isLoading } = useSWR<{ data: TeamFunnel }>(key, fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const payload = data?.data && "agents" in data.data ? data.data : null;
  return { funnel: payload, error, isLoading };
}

export function useTeamAgentPanel(marketId: string, agentId: string | null, from: string, to: string) {
  const key = agentId
    ? `/api/team/agent-panel?${new URLSearchParams({ market_id: marketId, agent_id: agentId, from, to })}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: AgentPanel }>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  });
  return { panel: data?.data ?? null, error, isLoading, mutate };
}
