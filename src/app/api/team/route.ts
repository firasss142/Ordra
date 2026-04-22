import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { calculateConfirmationRate } from "@/lib/metrics";
import { TERMINAL_STATUSES } from "@/types/order-status";
import type { Role } from "@/types";

const ATTEMPT_STATUSES = ["attempt_1", "attempt_2", "attempt_3"];
const TODAY_ACTIONED_STATUSES = ["confirmed", "dispatched", "rejected"];

async function fetchTeamData(role: Role, actorMarketId: string | null, paramMarketId: string | null) {
  const supabase = await createClient();

  let agentsQuery = supabase
    .from("users")
    .select("id, full_name, avatar_url, role, is_active, last_seen_at, market_id")
    .in("role", ["agent", "market_manager"])
    .eq("is_active", true)
    .limit(1000);

  if (role === "super_admin") {
    if (paramMarketId) agentsQuery = agentsQuery.eq("market_id", paramMarketId);
  } else {
    agentsQuery = agentsQuery.eq("market_id", actorMarketId);
  }

  const { data: agents, error: agentsError } = await agentsQuery;

  if (agentsError) return { error: "Internal server error" as const };
  if (!agents || agents.length === 0) return { data: [] };

  const agentIds = agents.map((a) => a.id);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [queueResult, historyResult] = await Promise.all([
    supabase
      .from("orders")
      .select("assigned_to")
      .in("assigned_to", agentIds)
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`),
    supabase
      .from("order_history")
      .select("actor_id, status_to, order_id")
      .in("actor_id", agentIds)
      .gte("created_at", todayStart.toISOString())
      .lte("created_at", todayEnd.toISOString())
      .limit(50000),
  ]);

  const queueRows = queueResult.data ?? [];
  const historyRows = historyResult.data ?? [];

  const attemptCountsByOrder: Record<string, number> = {};
  historyRows.forEach((row) => {
    if (ATTEMPT_STATUSES.includes(row.status_to)) {
      attemptCountsByOrder[row.order_id] = (attemptCountsByOrder[row.order_id] ?? 0) + 1;
    }
  });

  const queueSizeByAgent: Record<string, number> = {};
  queueRows.forEach((row) => {
    if (row.assigned_to) {
      queueSizeByAgent[row.assigned_to] = (queueSizeByAgent[row.assigned_to] ?? 0) + 1;
    }
  });

  const actionedByAgent: Record<string, number> = {};
  const confirmedByAgent: Record<string, number> = {};
  const rejectedByAgent: Record<string, number> = {};
  const confirmedOrdersByAgent: Record<string, string[]> = {};

  historyRows.forEach((row) => {
    if (!row.actor_id) return;
    if (TODAY_ACTIONED_STATUSES.includes(row.status_to)) {
      actionedByAgent[row.actor_id] = (actionedByAgent[row.actor_id] ?? 0) + 1;
    }
    if (row.status_to === "confirmed" || row.status_to === "dispatched") {
      confirmedByAgent[row.actor_id] = (confirmedByAgent[row.actor_id] ?? 0) + 1;
      if (!confirmedOrdersByAgent[row.actor_id]) confirmedOrdersByAgent[row.actor_id] = [];
      confirmedOrdersByAgent[row.actor_id].push(row.order_id);
    }
    if (row.status_to === "rejected") {
      rejectedByAgent[row.actor_id] = (rejectedByAgent[row.actor_id] ?? 0) + 1;
    }
  });

  const data = agents.map((agent) => {
    const actionedToday = actionedByAgent[agent.id] ?? 0;
    const confirmedToday = confirmedByAgent[agent.id] ?? 0;
    const rejectedToday = rejectedByAgent[agent.id] ?? 0;
    const confirmedOrders = confirmedOrdersByAgent[agent.id] ?? [];
    const totalAttempts = confirmedOrders.reduce(
      (sum, orderId) => sum + (attemptCountsByOrder[orderId] ?? 0),
      0
    );
    const avgAttempts =
      confirmedToday > 0 ? Math.round((totalAttempts / confirmedToday) * 10) / 10 : 0;

    return {
      agent_id: agent.id,
      full_name: agent.full_name,
      avatar_url: agent.avatar_url ?? null,
      role: agent.role as "agent" | "market_manager",
      is_active: agent.is_active ?? false,
      is_active_today: actionedToday > 0,
      last_seen_at: agent.last_seen_at ?? null,
      market_id: agent.market_id,
      queue_size: queueSizeByAgent[agent.id] ?? 0,
      actioned_today: actionedToday,
      confirmed_today: confirmedToday,
      rejected_today: rejectedToday,
      confirmation_rate: calculateConfirmationRate(confirmedToday, actionedToday),
      avg_attempts: avgAttempts,
    };
  });

  return { data };
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const paramMarketId = req.nextUrl.searchParams.get("market_id");
  const result = await fetchTeamData(role, actor.market_id, paramMarketId);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
