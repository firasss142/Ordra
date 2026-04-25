import useSWR from "swr";
import type { KeyedMutator } from "swr";
import type {
  AgentMetrics,
  StageTransition,
  TtfcDistribution,
  FunnelStage,
} from "@/lib/confirmation-flow/aggregations";

export interface FunnelStageData {
  stage: FunnelStage;
  open_count: number;
  entered_count: number;
  avg_time_in_stage_minutes: number | null;
  drop_off_rate_pct: number | null;
}

export interface OverviewResponse {
  funnel: FunnelStageData[];
  stage_transitions: StageTransition[];
  agents: AgentMetrics[];
  ttfc_distribution: TtfcDistribution;
  window: { from: string; to: string };
  computed_at: string;
}

interface Options {
  marketId: string | null;
  from: string;
  to: string;
}

function buildKey(opts: Options): string | null {
  if (!opts.marketId) return null;
  const p = new URLSearchParams({
    market_id: opts.marketId,
    from_date: opts.from,
    to_date: opts.to,
  });
  return `/api/confirmation-flow/overview?${p.toString()}`;
}

export function useConfirmationFlowOverview(opts: Options): {
  data: OverviewResponse | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<{ data?: OverviewResponse } | OverviewResponse>;
} {
  const key = buildKey(opts);
  const { data, error, isLoading, mutate } = useSWR(key, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return {
    data: data as OverviewResponse | undefined,
    isLoading,
    error,
    mutate,
  };
}
