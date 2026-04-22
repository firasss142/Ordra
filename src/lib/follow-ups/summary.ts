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

// Matches both the legacy PostgREST message and the current "in the schema
// cache" variant emitted when the function hasn't been created yet.
const MISSING_RPC_PATTERN =
  /(Could not find the function|schema cache|does not exist|PGRST(202|301))/i;

export async function getFollowUpsSummary(
  supabase: Pick<SupabaseClient, "rpc" | "from">,
  filters: FollowUpsSummaryFilters,
): Promise<FollowUpsSummary> {
  const { data, error } = await supabase.rpc("follow_ups_status_counts", {
    p_market_id: filters.marketId,
    p_agent_id: filters.agentId,
    p_campaign_id: filters.campaignId,
  });

  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (MISSING_RPC_PATTERN.test(message)) {
      return computeSummaryFallback(supabase, filters);
    }
    throw new Error(message || "follow_ups_status_counts failed");
  }

  return aggregate((data ?? []) as StatusCountRow[]);
}

function aggregate(rows: StatusCountRow[]): FollowUpsSummary {
  const summary: FollowUpsSummary = { ...ZERO };
  for (const row of rows) {
    const raw = typeof row.count === "string" ? Number(row.count) : (row.count ?? 0);
    const n = Number.isFinite(raw) ? Number(raw) : 0;
    if (row.status in summary) summary[row.status] = n;
    summary.total += n;
  }
  return summary;
}

/**
 * Fallback when the `follow_ups_status_counts` RPC is missing (e.g., the
 * migration hasn't been applied yet). Pulls only the `status` column and
 * counts in memory. Scales well for typical market volumes; the RPC remains
 * the faster hot path once the migration lands.
 */
async function computeSummaryFallback(
  supabase: Pick<SupabaseClient, "from">,
  filters: FollowUpsSummaryFilters,
): Promise<FollowUpsSummary> {
  let query = supabase.from("order_follow_ups").select("status");
  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.agentId) query = query.eq("confirming_agent_id", filters.agentId);
  if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);

  const { data, error } = await query;
  if (error) {
    throw new Error((error as { message?: string }).message ?? "summary fallback failed");
  }

  const tally = new Map<FollowUpStatus, number>();
  for (const row of (data ?? []) as { status: FollowUpStatus }[]) {
    tally.set(row.status, (tally.get(row.status) ?? 0) + 1);
  }
  return aggregate(
    Array.from(tally, ([status, count]) => ({ status, count })),
  );
}
