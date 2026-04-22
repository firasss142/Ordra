import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpStatus } from "@/types/follow-up";

export interface FollowUpsSummaryFilters {
  /** null = all markets (super_admin) */
  marketId: string | null;
  /** Filter to follow-ups confirmed by this agent. */
  agentId: string | null;
  /** Filter to a specific campaign. */
  campaignId: string | null;
}

export interface FollowUpsSummary {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  escalated: number;
}

const ZERO: FollowUpsSummary = {
  total: 0,
  open: 0,
  in_progress: 0,
  resolved: 0,
  escalated: 0,
};

interface StatusCountRow {
  status: FollowUpStatus;
  count: number | string | null;
}

export async function getFollowUpsSummary(
  supabase: Pick<SupabaseClient, "rpc">,
  filters: FollowUpsSummaryFilters,
): Promise<FollowUpsSummary> {
  const { data, error } = await supabase.rpc("follow_ups_status_counts", {
    p_market_id: filters.marketId,
    p_agent_id: filters.agentId,
    p_campaign_id: filters.campaignId,
  });

  if (error) {
    const message = (error as { message?: string }).message ?? "follow_ups_status_counts failed";
    throw new Error(message);
  }

  const rows = (data ?? []) as StatusCountRow[];
  const summary: FollowUpsSummary = { ...ZERO };

  for (const row of rows) {
    const count = typeof row.count === "string" ? Number(row.count) : (row.count ?? 0);
    const n = Number.isFinite(count) ? Number(count) : 0;
    if (row.status in summary) {
      summary[row.status] = n;
    }
    summary.total += n;
  }

  return summary;
}
