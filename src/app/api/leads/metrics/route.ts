import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus, LeadSource, LeadLostReason } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";

interface LeadMetricRow {
  status: LeadStatus;
  source: LeadSource;
  assigned_to: string | null;
  lost_reason: LeadLostReason | null;
}

export interface CrmMetricsResponse {
  total: number;
  won: number;
  lost: number;
  overallConversionRate: number; // won / (won + lost)
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

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Agents don't get the metrics dashboard.
  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  // Optional date range
  const dateFrom = req.nextUrl.searchParams.get("date_from");
  const dateTo = req.nextUrl.searchParams.get("date_to");

  // TODO: replace with a materialized view / aggregated SQL function when
  // lead count grows past a few tens of thousands. Defensive limit guards runaway payloads.
  let query = supabase
    .from("leads")
    .select("status, source, assigned_to, lost_reason")
    .limit(50000);

  if (marketId) query = query.eq("market_id", marketId);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const leads = (rows ?? []) as LeadMetricRow[];

  // Gather agent names for attribution
  const agentIds = Array.from(
    new Set(leads.map((l) => l.assigned_to).filter(Boolean))
  ) as string[];

  const agentNameMap: Record<string, string> = {};
  if (agentIds.length > 0) {
    const { data: agentsData } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", agentIds);
    for (const u of agentsData ?? []) {
      agentNameMap[u.id as string] = (u.full_name as string) ?? "";
    }
  }

  let won = 0;
  let lost = 0;
  const byAgent = new Map<
    string,
    { won: number; lost: number; total: number }
  >();
  const bySource = new Map<
    LeadSource,
    { won: number; lost: number; total: number }
  >();
  const lostReasonCounts = new Map<LeadLostReason, number>();

  for (const l of leads) {
    if (l.status === "won") won++;
    if (l.status === "lost") lost++;

    if (l.assigned_to) {
      const cur = byAgent.get(l.assigned_to) ?? { won: 0, lost: 0, total: 0 };
      cur.total++;
      if (l.status === "won") cur.won++;
      if (l.status === "lost") cur.lost++;
      byAgent.set(l.assigned_to, cur);
    }

    const srcKey = l.source;
    const srcCur = bySource.get(srcKey) ?? { won: 0, lost: 0, total: 0 };
    srcCur.total++;
    if (l.status === "won") srcCur.won++;
    if (l.status === "lost") srcCur.lost++;
    bySource.set(srcKey, srcCur);

    if (l.status === "lost" && l.lost_reason) {
      lostReasonCounts.set(
        l.lost_reason,
        (lostReasonCounts.get(l.lost_reason) ?? 0) + 1
      );
    }
  }

  const rate = (w: number, l: number) =>
    w + l === 0 ? 0 : Math.round((w / (w + l)) * 1000) / 1000;

  const response: CrmMetricsResponse = {
    total: leads.length,
    won,
    lost,
    overallConversionRate: rate(won, lost),
    byAgent: Array.from(byAgent.entries())
      .map(([agentId, m]) => ({
        agentId,
        agentName: agentNameMap[agentId] ?? agentId,
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

  return NextResponse.json({ data: response });
}
