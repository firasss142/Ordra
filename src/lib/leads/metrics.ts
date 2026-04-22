import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEAD_STATUSES,
  type LeadStatus,
  type LeadSource,
  type LeadLostReason,
} from "@/types/lead";

export interface LeadsMetricsFilters {
  /** null = all markets (super_admin). */
  marketId: string | null;
  /** Optional ISO date lower-bound on created_at. */
  dateFrom?: string | null;
  /** Optional ISO date upper-bound on created_at. */
  dateTo?: string | null;
}

export interface LeadsMetrics {
  total: number;
  won: number;
  lost: number;
  overallConversionRate: number;
  callbacksDueToday: number;
  byStatus: Record<LeadStatus, number>;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    won: number;
    lost: number;
    total: number;
    conversionRate: number;
  }>;
  bySource: Array<{
    source: LeadSource;
    won: number;
    lost: number;
    total: number;
    conversionRate: number;
  }>;
  lostReasons: Array<{
    reason: LeadLostReason;
    count: number;
  }>;
}

interface MetricRow {
  status: LeadStatus;
  source: LeadSource;
  assigned_to: string | null;
  lost_reason: LeadLostReason | null;
  callback_scheduled_at: string | null;
}

const zeroByStatus = (): Record<LeadStatus, number> => {
  const out = {} as Record<LeadStatus, number>;
  for (const s of LEAD_STATUSES) out[s] = 0;
  return out;
};

const rate = (w: number, l: number) =>
  w + l === 0 ? 0 : Math.round((w / (w + l)) * 1000) / 1000;

export async function getLeadsMetrics(
  supabase: Pick<SupabaseClient, "from">,
  filters: LeadsMetricsFilters,
): Promise<LeadsMetrics> {
  let query = supabase
    .from("leads")
    .select("status, source, assigned_to, lost_reason, callback_scheduled_at")
    .limit(50000);

  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);

  const { data: rows, error } = await query;
  if (error) {
    throw new Error((error as { message?: string }).message ?? "leads metrics query failed");
  }

  const leads = (rows ?? []) as MetricRow[];

  // End-of-day boundary in server TZ. Market-specific TZ is future work —
  // both supported markets (TN/LY) sit on UTC+1, so the drift is bounded.
  const endOfToday = (() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return d.getTime();
  })();

  const byStatus = zeroByStatus();
  let won = 0;
  let lost = 0;
  let callbacksDueToday = 0;

  const byAgent = new Map<string, { won: number; lost: number; total: number }>();
  const bySource = new Map<LeadSource, { won: number; lost: number; total: number }>();
  const lostReasonCounts = new Map<LeadLostReason, number>();

  for (const l of leads) {
    if (l.status in byStatus) byStatus[l.status]++;
    if (l.status === "won") won++;
    if (l.status === "lost") lost++;

    if (
      l.status === "callback_scheduled" &&
      l.callback_scheduled_at &&
      new Date(l.callback_scheduled_at).getTime() <= endOfToday
    ) {
      callbacksDueToday++;
    }

    if (l.assigned_to) {
      const cur = byAgent.get(l.assigned_to) ?? { won: 0, lost: 0, total: 0 };
      cur.total++;
      if (l.status === "won") cur.won++;
      if (l.status === "lost") cur.lost++;
      byAgent.set(l.assigned_to, cur);
    }

    const srcCur = bySource.get(l.source) ?? { won: 0, lost: 0, total: 0 };
    srcCur.total++;
    if (l.status === "won") srcCur.won++;
    if (l.status === "lost") srcCur.lost++;
    bySource.set(l.source, srcCur);

    if (l.status === "lost" && l.lost_reason) {
      lostReasonCounts.set(
        l.lost_reason,
        (lostReasonCounts.get(l.lost_reason) ?? 0) + 1,
      );
    }
  }

  // Resolve agent display names in one round trip
  const agentIds = Array.from(byAgent.keys());
  const agentNames: Record<string, string> = {};
  if (agentIds.length > 0) {
    const { data: agents } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", agentIds);
    for (const u of (agents ?? []) as Array<{ id: string; full_name: string | null }>) {
      agentNames[u.id] = u.full_name ?? "";
    }
  }

  return {
    total: leads.length,
    won,
    lost,
    overallConversionRate: rate(won, lost),
    callbacksDueToday,
    byStatus,
    byAgent: Array.from(byAgent.entries())
      .map(([agentId, m]) => ({
        agentId,
        agentName: agentNames[agentId] ?? agentId,
        ...m,
        conversionRate: rate(m.won, m.lost),
      }))
      .sort((a, b) => b.total - a.total),
    bySource: Array.from(bySource.entries())
      .map(([source, m]) => ({
        source,
        ...m,
        conversionRate: rate(m.won, m.lost),
      }))
      .sort((a, b) => b.total - a.total),
    lostReasons: Array.from(lostReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
