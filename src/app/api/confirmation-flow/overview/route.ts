import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  computeFunnelOpenCounts,
  computeStageTransitions,
  computeAvgTimeInStage,
  computeAgentMetrics,
  computeTtfcDistribution,
  FUNNEL_STAGES,
  type FunnelStage,
  type HistoryRow,
  type OpenOrderRow,
  type OverdueCallbackRow,
} from "@/lib/confirmation-flow/aggregations";

const CONFIRMATION_STATUSES = [
  "pending",
  ...FUNNEL_STAGES,
  "confirmed",
  "dispatched",
  "rejected",
] as const;

function sevenDaysAgoISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoStart(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function isoEnd(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

export async function GET(req: NextRequest) {
  try {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const paramMarketId = params.get("market_id");

  // Resolve effective market ID
  let marketId: string;
  if (actor.role === "super_admin") {
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id is required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    // market_manager always uses own market — param ignored
    if (!actor.market_id) {
      return NextResponse.json({ error: "Market not found for actor" }, { status: 400 });
    }
    marketId = actor.market_id;
  }

  const fromISO = params.get("from_date") ?? sevenDaysAgoISO();
  const toISO = params.get("to_date") ?? todayISO();

  const supabase = await createClient();

  // 1. Fetch current open orders in funnel stages
  const { data: openOrders, error: openErr } = await supabase
    .from("orders")
    .select("id, status, assigned_to")
    .eq("market_id", marketId)
    .in("status", ["pending", ...FUNNEL_STAGES])
    .limit(10000);

  if (openErr) {
    console.error("[GET /api/confirmation-flow/overview] open orders error", openErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // 2. Fetch overdue callbacks
  const { data: overdueCallbacks, error: overdueErr } = await supabase
    .from("orders")
    .select("id, assigned_to")
    .eq("market_id", marketId)
    .eq("status", "callback_scheduled")
    .lt("callback_scheduled_at", new Date().toISOString())
    .limit(5000);

  if (overdueErr) {
    console.error("[GET /api/confirmation-flow/overview] overdue callbacks error", overdueErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // 3. Fetch order_history for the window via inner-join on orders to scope by market
  //    (order_history table has no market_id column, so filter via FK relation)
  const { data: history, error: histErr } = await supabase
    .from("order_history")
    .select("order_id, status_from, status_to, actor_id, created_at, orders!inner(market_id)")
    .eq("orders.market_id", marketId)
    .in("status_to", [...CONFIRMATION_STATUSES])
    .gte("created_at", isoStart(fromISO))
    .lte("created_at", isoEnd(toISO))
    .limit(50000);

  if (histErr) {
    console.error("[GET /api/confirmation-flow/overview] history error", histErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const historyRows = (history ?? []) as HistoryRow[];
  const openRows = (openOrders ?? []) as OpenOrderRow[];
  const overdueRows = (overdueCallbacks ?? []) as OverdueCallbackRow[];

  // 4. Build funnel
  const openCounts = computeFunnelOpenCounts(openRows);
  const transitions = computeStageTransitions(historyRows);

  // Compute entered_count and avg_time per stage from history
  const funnelStages = FUNNEL_STAGES.map((stage, idx) => {
    const enteredCount = historyRows.filter((r) => r.status_to === stage).length;
    const avgTime = computeAvgTimeInStage(stage as FunnelStage, historyRows);

    // Drop-off: entered_count of this stage vs previous stage
    let dropOffRatePct: number | null = null;
    if (idx > 0) {
      const prevStage = FUNNEL_STAGES[idx - 1];
      const prevEntered = historyRows.filter((r) => r.status_to === prevStage).length;
      if (prevEntered > 0) {
        dropOffRatePct = Math.round(((prevEntered - enteredCount) / prevEntered) * 100);
      }
    }

    return {
      stage,
      open_count: openCounts[stage],
      entered_count: enteredCount,
      avg_time_in_stage_minutes: avgTime,
      drop_off_rate_pct: dropOffRatePct,
    };
  });

  // 5. Build per-agent metrics from open orders + history
  // Collect unique agents referenced in history or open orders
  const agentIdSet = new Set<string>();
  for (const row of openRows) {
    if (row.assigned_to) agentIdSet.add(row.assigned_to);
  }
  for (const row of historyRows) {
    if (row.actor_id) agentIdSet.add(row.actor_id);
  }

  let agentProfiles: Array<{ agent_id: string; full_name: string; avatar_url: string | null }> = [];
  if (agentIdSet.size > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", [...agentIdSet])
      .limit(200);

    agentProfiles = (users ?? []).map((u) => ({
      agent_id: u.id,
      full_name: u.full_name ?? u.id,
      avatar_url: u.avatar_url ?? null,
    }));
  }

  const agentMetrics = computeAgentMetrics(
    agentProfiles,
    openRows,
    overdueRows,
    historyRows
  );

  // 6. TTFC distribution from agent metrics samples
  const allSamples = agentMetrics.flatMap((a) =>
    a.ttfc_samples.map((ttfc) => ({ agent_id: a.agent_id, ttfc }))
  );
  const ttfcDistribution = computeTtfcDistribution(allSamples);

  return NextResponse.json({
    funnel: funnelStages,
    stage_transitions: transitions,
    agents: agentMetrics,
    ttfc_distribution: ttfcDistribution,
    window: { from: fromISO, to: toISO },
    computed_at: new Date().toISOString(),
  });
  } catch (e) {
    console.error("[GET /api/confirmation-flow/overview] caught", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
