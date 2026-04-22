import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateConfirmationRate, calculateAvgAttempts } from "@/lib/metrics";
import { getActor } from "@/lib/auth/actor";

const ACTIONED_STATUSES = ["confirmed", "dispatched", "rejected"];
const ATTEMPT_STATUSES = ["attempt_1", "attempt_2", "attempt_3"];

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required" },
      { status: 400 }
    );
  }

  let marketId: string | null = null;
  if (role === "super_admin") {
    marketId = req.nextUrl.searchParams.get("market_id"); // null = all markets
  } else {
    marketId = actor.market_id;
  }

  // Fetch order_history rows in the period, scoped by market when provided.
  // order_history has no market_id or rejection_reason column — scope + rejection_reason via orders join.
  // Cap at 50k rows defensively: aggregation is in-memory and large windows bloat payload.
  let historyQuery = supabase
    .from("order_history")
    .select("actor_id, order_id, status_to, orders!inner(rejection_reason)")
    .gte("created_at", fromDate)
    .lte("created_at", toDate)
    .limit(50000);

  if (marketId) {
    historyQuery = historyQuery.eq("orders.market_id", marketId);
  }

  const { data: historyRows, error: historyError } = await historyQuery;

  if (historyError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Normalize rows: hoist rejection_reason from joined orders object
  const rows = (historyRows ?? []).map((r) => ({
    actor_id: r.actor_id,
    order_id: r.order_id,
    status_to: r.status_to,
    rejection_reason:
      (r.orders as unknown as { rejection_reason: string | null } | null)
        ?.rejection_reason ?? null,
  }));

  // Aggregate per agent
  const agentMap = new Map<
    string,
    { actioned: number; confirmed: number; rejected: number; attempts: number; orderIds: Set<string> }
  >();

  for (const row of rows) {
    const agentId = row.actor_id;
    if (!agentId) continue;

    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, { actioned: 0, confirmed: 0, rejected: 0, attempts: 0, orderIds: new Set() });
    }
    const agg = agentMap.get(agentId)!;

    if (row.order_id) agg.orderIds.add(row.order_id);

    if (ACTIONED_STATUSES.includes(row.status_to)) {
      agg.actioned++;
      if (row.status_to === "confirmed" || row.status_to === "dispatched") {
        agg.confirmed++;
      } else if (row.status_to === "rejected") {
        agg.rejected++;
      }
    }

    if (ATTEMPT_STATUSES.includes(row.status_to)) {
      agg.attempts++;
    }
  }

  // Fetch agent names for display
  const agentIds = Array.from(agentMap.keys());
  const { data: agentUsers } = agentIds.length > 0
    ? await supabase.from("users").select("id, full_name, avatar_url").in("id", agentIds)
    : { data: [] };
  const nameMap = new Map((agentUsers ?? []).map((u) => [u.id, u.full_name as string]));
  const avatarMap = new Map(
    (agentUsers ?? []).map((u) => [u.id, (u.avatar_url as string | null) ?? null])
  );

  const agents = Array.from(agentMap.entries()).map(([agentId, agg]) => ({
    agent_id: agentId,
    full_name: nameMap.get(agentId) ?? agentId,
    avatar_url: avatarMap.get(agentId) ?? null,
    assigned: agg.orderIds.size,
    actioned: agg.actioned,
    confirmed: agg.confirmed,
    rejected: agg.rejected,
    confirmation_rate: calculateConfirmationRate(agg.confirmed, agg.actioned),
    avg_attempts: calculateAvgAttempts(agg.attempts, agg.actioned),
  }));

  // Market-wide rejection reason breakdown
  const rejectionRows = rows.filter((r) => r.status_to === "rejected" && r.rejection_reason);
  const totalRejections = rejectionRows.length;
  const reasonCounts = new Map<string, number>();
  for (const row of rejectionRows) {
    const reason = row.rejection_reason as string;
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const ALL_REJECTION_REASONS = [
    "refus_client",
    "faux_numero",
    "doublon",
    "injoignable",
    "prix",
    "non_serieux",
    "autre",
  ];
  const rejection_breakdown = ALL_REJECTION_REASONS.map((reason) => {
    const count = reasonCounts.get(reason) ?? 0;
    return {
      reason,
      count,
      percentage: totalRejections > 0 ? Math.round((count / totalRejections) * 1000) / 10 : 0,
    };
  });

  return NextResponse.json({ data: { agents, rejection_breakdown } });
}
