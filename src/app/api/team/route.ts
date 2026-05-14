import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { calculateConfirmationRate } from "@/lib/metrics";
import { TERMINAL_STATUSES } from "@/types/order-status";
import { computePercentileRanks } from "@/lib/team/percentile";
import { computeCoachingPrompts, type CoachingPrompt } from "@/lib/team/coaching";
import { computeFCR } from "@/lib/team/fcr";
import { computeTTFCMinutes, medianMinutes } from "@/lib/team/ttfc";
import type { Role } from "@/types";

export const dynamic = "force-dynamic";

const ATTEMPT_STATUSES = ["attempt_1", "attempt_2", "attempt_3"];
const ACTIONED_STATUSES = ["confirmed", "uploaded", "rejected"];

interface HistoryRow {
  actor_id: string | null;
  status_to: string;
  status_from: string | null;
  order_id: string;
  created_at: string;
}

function yesterdayISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function periodBounds(fromISO: string, toISO: string): { startIso: string; endIso: string } {
  const startIso = new Date(`${fromISO}T00:00:00.000Z`).toISOString();
  const endIso = new Date(`${toISO}T23:59:59.999Z`).toISOString();
  return { startIso, endIso };
}

function previousWindow(fromISO: string, toISO: string): { prevFrom: string; prevTo: string } {
  const start = new Date(`${fromISO}T00:00:00.000Z`).getTime();
  const end = new Date(`${toISO}T23:59:59.999Z`).getTime();
  const length = end - start + 1;
  const prevEnd = new Date(start - 1);
  const prevStart = new Date(start - length);
  return {
    prevFrom: prevStart.toISOString().slice(0, 10),
    prevTo: prevEnd.toISOString().slice(0, 10),
  };
}

interface AggregatedMetrics {
  actioned: Record<string, number>;
  confirmed: Record<string, number>;
  rejected: Record<string, number>;
  callsByAgent: Record<string, number>;
  confirmedOrdersByAgent: Record<string, string[]>;
  rejectedOrderIdsByAgent: Record<string, string[]>;
  firstAttemptAtByOrder: Record<string, string>;
  assignedAtByAgent: Record<string, Record<string, string>>;
}

function aggregate(history: HistoryRow[]): AggregatedMetrics {
  const actioned: Record<string, number> = {};
  const confirmed: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  const callsByAgent: Record<string, number> = {};
  const confirmedOrdersByAgent: Record<string, string[]> = {};
  const rejectedOrderIdsByAgent: Record<string, string[]> = {};
  const firstAttemptAtByOrder: Record<string, string> = {};
  const assignedAtByAgent: Record<string, Record<string, string>> = {};

  for (const row of history) {
    if (!row.actor_id) continue;
    const actor = row.actor_id;
    const isAttempt = ATTEMPT_STATUSES.includes(row.status_to);

    if (isAttempt) {
      callsByAgent[actor] = (callsByAgent[actor] ?? 0) + 1;
      const existing = firstAttemptAtByOrder[row.order_id];
      if (!existing || row.created_at < existing) {
        firstAttemptAtByOrder[row.order_id] = row.created_at;
      }
    }

    if (row.status_to === "assigned") {
      if (!assignedAtByAgent[actor]) assignedAtByAgent[actor] = {};
      assignedAtByAgent[actor][row.order_id] = row.created_at;
    }

    if (ACTIONED_STATUSES.includes(row.status_to)) {
      actioned[actor] = (actioned[actor] ?? 0) + 1;
    }
    if (row.status_to === "confirmed" || row.status_to === "uploaded") {
      confirmed[actor] = (confirmed[actor] ?? 0) + 1;
      if (!confirmedOrdersByAgent[actor]) confirmedOrdersByAgent[actor] = [];
      confirmedOrdersByAgent[actor].push(row.order_id);
    }
    if (row.status_to === "rejected") {
      rejected[actor] = (rejected[actor] ?? 0) + 1;
      if (!rejectedOrderIdsByAgent[actor]) rejectedOrderIdsByAgent[actor] = [];
      rejectedOrderIdsByAgent[actor].push(row.order_id);
    }
  }

  return {
    actioned,
    confirmed,
    rejected,
    callsByAgent,
    confirmedOrdersByAgent,
    rejectedOrderIdsByAgent,
    firstAttemptAtByOrder,
    assignedAtByAgent,
  };
}

async function fetchTeamData(
  role: Role,
  actorMarketId: string | null,
  paramMarketId: string | null,
  fromISO: string,
  toISO: string
) {
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
  const { startIso: periodStart, endIso: periodEnd } = periodBounds(fromISO, toISO);
  const { prevFrom, prevTo } = previousWindow(fromISO, toISO);
  const { startIso: prevStart, endIso: prevEnd } = periodBounds(prevFrom, prevTo);

  const [queueResult, periodHistoryResult, prevHistoryResult] = await Promise.all([
    supabase
      .from("orders")
      .select("assigned_to")
      .in("assigned_to", agentIds)
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`),
    supabase
      .from("order_history")
      .select("actor_id, status_to, status_from, order_id, created_at")
      .in("actor_id", agentIds)
      .gte("created_at", periodStart)
      .lte("created_at", periodEnd)
      .limit(50000),
    supabase
      .from("order_history")
      .select("actor_id, status_to, order_id")
      .in("actor_id", agentIds)
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd)
      .limit(50000),
  ]);

  const queueRows = queueResult.data ?? [];
  const periodHistory = (periodHistoryResult.data ?? []) as HistoryRow[];
  const prevHistory = (prevHistoryResult.data ?? []) as HistoryRow[];

  const period = aggregate(periodHistory);
  const prev = aggregate(prevHistory);

  const queueSizeByAgent: Record<string, number> = {};
  queueRows.forEach((row) => {
    if (row.assigned_to) {
      queueSizeByAgent[row.assigned_to] = (queueSizeByAgent[row.assigned_to] ?? 0) + 1;
    }
  });

  const rejectedOrderIds = Object.values(period.rejectedOrderIdsByAgent).flat();
  const rejectedCityByOrder: Record<string, string | null> = {};
  if (rejectedOrderIds.length > 0) {
    const { data: rejOrders } = await supabase
      .from("orders")
      .select("id, customer_city")
      .in("id", rejectedOrderIds);
    (rejOrders ?? []).forEach((o) => {
      rejectedCityByOrder[o.id] = o.customer_city ?? null;
    });
  }

  const attemptCountByOrder: Record<string, number> = {};
  for (const row of periodHistory) {
    if (ATTEMPT_STATUSES.includes(row.status_to)) {
      attemptCountByOrder[row.order_id] = (attemptCountByOrder[row.order_id] ?? 0) + 1;
    }
  }

  const preview = agents.map((agent) => {
    const actioned = period.actioned[agent.id] ?? 0;
    const confirmed = period.confirmed[agent.id] ?? 0;
    const rejected = period.rejected[agent.id] ?? 0;
    const rate = calculateConfirmationRate(confirmed, actioned);
    return { agent_id: agent.id, confirmation_rate: rate, actioned, rejected };
  });

  const prevPreview = agents.map((agent) => {
    const actioned = prev.actioned[agent.id] ?? 0;
    const confirmed = prev.confirmed[agent.id] ?? 0;
    const rate = calculateConfirmationRate(confirmed, actioned);
    return { agent_id: agent.id, confirmation_rate: rate };
  });

  const percentileMap = computePercentileRanks(preview);
  const coachingMap = computeCoachingPrompts(preview, prevPreview);
  const prevRateMap: Record<string, number> = {};
  prevPreview.forEach((p) => {
    prevRateMap[p.agent_id] = p.confirmation_rate;
  });

  const data = agents.map((agent) => {
    const actionedPeriod = period.actioned[agent.id] ?? 0;
    const confirmedPeriod = period.confirmed[agent.id] ?? 0;
    const rejectedPeriod = period.rejected[agent.id] ?? 0;
    const confirmationRatePeriod = calculateConfirmationRate(confirmedPeriod, actionedPeriod);
    const callsPeriod = period.callsByAgent[agent.id] ?? 0;

    const confirmedOrders = period.confirmedOrdersByAgent[agent.id] ?? [];
    const fcrInput = confirmedOrders.map((orderId) => ({
      order_id: orderId,
      attempts: attemptCountByOrder[orderId] ?? 0,
    }));
    const fcr = computeFCR(fcrInput);

    const totalAttempts = confirmedOrders.reduce(
      (sum, orderId) => sum + (attemptCountByOrder[orderId] ?? 0),
      0
    );
    const avgAttempts =
      confirmedPeriod > 0 ? Math.round((totalAttempts / confirmedPeriod) * 10) / 10 : 0;

    const assignedMap = period.assignedAtByAgent[agent.id] ?? {};
    const ttfcValues: Array<number | null> = Object.entries(assignedMap).map(
      ([orderId, assignedAt]) => {
        const firstAttempt = period.firstAttemptAtByOrder[orderId];
        return firstAttempt ? computeTTFCMinutes(assignedAt, firstAttempt) : null;
      }
    );
    const ttfcMedian = medianMinutes(ttfcValues);

    const rejectedOrders = period.rejectedOrderIdsByAgent[agent.id] ?? [];
    const cityCounts: Record<string, number> = {};
    let rejectedWithCity = 0;
    for (const orderId of rejectedOrders) {
      const city = rejectedCityByOrder[orderId];
      if (!city) continue;
      cityCounts[city] = (cityCounts[city] ?? 0) + 1;
      rejectedWithCity += 1;
    }
    const regionBreakdown = Object.entries(cityCounts)
      .map(([city, count]) => ({
        city,
        count,
        percentage: rejectedWithCity > 0 ? Math.round((count / rejectedWithCity) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      agent_id: agent.id,
      full_name: agent.full_name,
      avatar_url: agent.avatar_url ?? null,
      role: agent.role as "agent" | "market_manager",
      is_active: agent.is_active ?? false,
      last_seen_at: agent.last_seen_at ?? null,
      market_id: agent.market_id,
      queue_size: queueSizeByAgent[agent.id] ?? 0,

      actioned_period: actionedPeriod,
      confirmed_period: confirmedPeriod,
      rejected_period: rejectedPeriod,
      confirmation_rate_period: confirmationRatePeriod,
      calls_period: callsPeriod,
      avg_attempts: avgAttempts,
      fcr,
      ttfc_median: ttfcMedian,
      rejection_regions: regionBreakdown,

      prev_confirmation_rate: prevRateMap[agent.id] ?? null,
      percentile_rank: percentileMap[agent.id] ?? 0,
      coaching_prompt: coachingMap[agent.id] ?? (null as CoachingPrompt),
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
  const fromParam = req.nextUrl.searchParams.get("from_date");
  const toParam = req.nextUrl.searchParams.get("to_date");

  const fromISO = fromParam ?? yesterdayISO();
  const toISO = toParam ?? fromISO;

  const result = await fetchTeamData(role, actor.market_id, paramMarketId, fromISO, toISO);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
