import type { SupabaseClient } from "@supabase/supabase-js";
import { TERMINAL_STATUSES } from "@/types/order-status";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import type { AvailableAgent } from "./auto-assignment-types";

const AGENT_COLS = "id, is_active, deleted_at, last_seen_at, is_available, available_since";

/**
 * Every agent a market could route to, with the counters the engines read.
 *
 * Deliberately does NOT filter on readiness, even though readiness now gates
 * all automatic distribution. This function also feeds `/api/agents/capacity`,
 * which is the manager's manual-assign rail — a manager must be able to hand
 * an order to a specific person whether or not that person has declared
 * themselves ready. The readiness filter belongs to the automatic callers
 * (`tryAutoAssign`, the bulk route, the drain), which apply
 * `isReadyForOrders`.
 *
 * Soft-deleted agents ARE excluded here: `assign_order` checks only
 * `is_active`, so a deleted agent can still be assigned work today, and that
 * omission should not be inherited by anything new.
 */
export async function fetchAgentCapacity(
  adminClient: SupabaseClient,
  marketId: string | null
): Promise<AvailableAgent[]> {
  let q = adminClient
    .from("users")
    .select(AGENT_COLS)
    .eq("role", "agent")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (marketId) {
    q = q.eq("market_id", marketId);
  }
  const { data: agentRows } = await q.order("id");

  if (!agentRows || agentRows.length === 0) return [];

  const agentIds = agentRows.map((r: { id: string }) => r.id);

  // Derived from TERMINAL_STATUSES rather than hand-listed: the literal here
  // omitted `deleted`, so soft-deleted orders counted against the agent they
  // were assigned to and made them look busier than they were — which skewed
  // auto-assignment toward agents who happened to have fewer deletions.
  //
  // idx_orders_assigned_status_partial is still usable: its predicate excludes
  // four terminal statuses and this one excludes five, so the query predicate
  // implies the index predicate. Narrowing the index to match would only make
  // it smaller, never correct.
  const { data: queueRows } = await adminClient
    .from("orders")
    .select("assigned_to")
    .in("assigned_to", agentIds)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);

  const queueSizeByAgent: Record<string, number> = {};
  (queueRows ?? []).forEach((row: { assigned_to: string | null }) => {
    if (row.assigned_to) {
      queueSizeByAgent[row.assigned_to] = (queueSizeByAgent[row.assigned_to] ?? 0) + 1;
    }
  });

  // Today's tally, for the percentage quota. Counted on the MARKET's local day
  // (Tunisia UTC+1, Libya UTC+2 — they do not roll over together), and on
  // `assigned_at` rather than `created_at`, so a manager's manual assignment
  // at 15:00 of an order that arrived yesterday spends today's share. That is
  // the decision: manual assignments count.
  //
  // One grouped read for the whole market, never one count per agent.
  const dayStart = marketDayStartUtc(todayInMarket(marketId), marketId);
  const assignedTodayByAgent: Record<string, number> = {};
  if (dayStart) {
    const { data: todayRows } = await adminClient
      .from("orders")
      .select("assigned_to")
      .in("assigned_to", agentIds)
      .gte("assigned_at", dayStart);

    (todayRows ?? []).forEach((row: { assigned_to: string | null }) => {
      if (row.assigned_to) {
        assignedTodayByAgent[row.assigned_to] =
          (assignedTodayByAgent[row.assigned_to] ?? 0) + 1;
      }
    });
  }

  const { data: lastActionRows } = await adminClient
    .from("order_history")
    .select("actor_id, created_at")
    .in("actor_id", agentIds)
    .order("created_at", { ascending: false });

  const lastActionByAgent: Record<string, string> = {};
  (lastActionRows ?? []).forEach((row: { actor_id: string | null; created_at: string }) => {
    if (row.actor_id && !lastActionByAgent[row.actor_id]) {
      lastActionByAgent[row.actor_id] = row.created_at;
    }
  });

  return agentRows.map(
    (row: {
      id: string;
      is_active: boolean;
      deleted_at: string | null;
      last_seen_at: string | null;
      is_available: boolean | null;
    }) => ({
      id: row.id,
      queue_size: queueSizeByAgent[row.id] ?? 0,
      last_action_at: lastActionByAgent[row.id] ?? null,
      assigned_today: assignedTodayByAgent[row.id] ?? 0,
      // `?? false` so a market whose migration has not yet run reads as
      // "nobody ready" rather than crashing — inert, not wrong.
      is_available: row.is_available ?? false,
      is_active: row.is_active,
      deleted_at: row.deleted_at,
      last_seen_at: row.last_seen_at,
    })
  );
}
