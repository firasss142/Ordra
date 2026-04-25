import useSWR from "swr";
import type { KeyedMutator } from "swr";

export interface CallbackRow {
  order_id: string;
  external_id: string | null;
  customer_name: string;
  callback_scheduled_at: string;
  minutes_until: number;
  agent_id: string | null;
  agent_full_name: string | null;
}

interface CallbacksDueResponse {
  data: CallbackRow[];
  now: string;
}

function buildKey(marketId: string | null, withinMinutes: number): string | null {
  if (!marketId) return null;
  const p = new URLSearchParams({
    market_id: marketId,
    within_minutes: String(withinMinutes),
  });
  return `/api/confirmation-flow/callbacks-due?${p.toString()}`;
}

export function useCallbacksDueSoon(
  marketId: string | null,
  withinMinutes = 30
): {
  rows: CallbackRow[];
  nowIso: string | null;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<CallbacksDueResponse>;
} {
  const key = buildKey(marketId, withinMinutes);
  const { data, error, isLoading, mutate } = useSWR<CallbacksDueResponse>(key, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  return {
    rows: data?.data ?? [],
    nowIso: data?.now ?? null,
    isLoading,
    error,
    mutate,
  };
}
