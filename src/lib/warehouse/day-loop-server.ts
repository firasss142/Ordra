import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayLoopRows, QueueStatsRow } from "./day-loop-assemble";
import { marketTimezone } from "@/lib/markets";

/** The market's own calendar day — a UTC boundary would split a Libyan evening. */
export function marketToday(marketId: string | null, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: marketTimezone(marketId) }).format(now);
}

/**
 * The reads behind « Aujourd'hui ». Counts only — what a row MEANS is decided in
 * `day-loop-assemble.ts`, which is pure and tested. Every query is small and
 * scoped to one market; the per-building figures reuse the bench's own RPC so
 * this screen cannot disagree with the bench about what « à scanner » is.
 */
export async function fetchDayLoopRows(
  supabase: SupabaseClient,
  input: { marketId: string | null },
): Promise<DayLoopRows> {
  const { marketId } = input;

  const warehousesQuery = marketId
    ? supabase
        .from("warehouses")
        .select("id, code, name_fr, name_ar")
        .eq("market_id", marketId)
        .eq("is_active", true)
        // The default building first (Tripoli), so the order never reshuffles.
        .order("is_default", { ascending: false })
        .order("code", { ascending: true })
    : Promise.resolve({ data: [] as DayLoopRows["warehouses"] });

  // Every read is one market's. Written out rather than through a generic
  // helper: Supabase's builder types recurse past tsc's depth limit otherwise.
  let returningQuery = supabase.from("orders").select("warehouse_id").eq("status", "returning").is("archived_at", null);
  let receptionsQuery = supabase
    .from("receptions")
    .select("warehouse_id, status, expected_at, reception_lines(count)")
    .in("status", ["draft", "submitted"]);
  let productsQuery = supabase.from("products").select("id").eq("is_active", true);
  let agentsQuery = supabase
    .from("users")
    .select("id, full_name, warehouse_id")
    .eq("role", "warehouse_agent")
    .is("deleted_at", null);
  if (marketId) {
    returningQuery = returningQuery.eq("market_id", marketId);
    receptionsQuery = receptionsQuery.eq("market_id", marketId);
    productsQuery = productsQuery.eq("market_id", marketId);
    agentsQuery = agentsQuery.eq("market_id", marketId);
  }

  const [
    { data: warehouses },
    { data: marketQueue },
    { data: returning },
    { data: receptions },
    { data: products },
    { data: agents },
    { data: leaderboard },
    { data: dayStats },
    { data: goalRow },
  ] = await Promise.all([
    warehousesQuery,
    supabase.rpc("get_warehouse_queue_stats", { p_market_id: marketId, p_warehouse_id: null }),
    returningQuery,
    receptionsQuery,
    productsQuery,
    agentsQuery,
    supabase.rpc("get_warehouse_leaderboard", { p_market_id: marketId }),
    supabase.rpc("get_warehouse_day_stats", { p_market_id: marketId }),
    marketId
      ? supabase
          .from("settings")
          .select("value")
          .eq("market_id", marketId)
          .eq("key", "goal_daily_scanned")
          .maybeSingle<{ value: unknown }>()
      : Promise.resolve({ data: null }),
  ]);

  const sites = (warehouses ?? []) as DayLoopRows["warehouses"];
  const productIds = ((products ?? []) as Array<{ id: string }>).map((p) => p.id);

  const [queues, { data: countRows }] = await Promise.all([
    Promise.all(
      sites.map((w) =>
        supabase
          .rpc("get_warehouse_queue_stats", { p_market_id: marketId, p_warehouse_id: w.id })
          .then((r) => [w.id, (r.data ?? {}) as QueueStatsRow] as const),
      ),
    ),
    productIds.length
      ? supabase
          .from("inventory_log")
          .select("product_id, warehouse_id")
          .eq("reason", "stock_count")
          .in("product_id", productIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    warehouses: sites,
    queueBySite: Object.fromEntries(queues),
    marketQueue: (marketQueue ?? {}) as QueueStatsRow,
    returning: (returning ?? []) as DayLoopRows["returning"],
    receptions: ((receptions ?? []) as Array<{
      warehouse_id: string | null;
      status: string;
      expected_at: string | null;
      reception_lines: Array<{ count: number }> | null;
    }>).map((r) => ({
      warehouse_id: r.warehouse_id,
      status: r.status,
      expected_at: r.expected_at,
      line_count: Number(r.reception_lines?.[0]?.count ?? 0),
    })),
    productIds,
    countRows: (countRows ?? []) as DayLoopRows["countRows"],
    agents: (agents ?? []) as DayLoopRows["agents"],
    leaderboard: (leaderboard ?? []) as DayLoopRows["leaderboard"],
    marketScannedToday: Number((dayStats as { scanned_today?: number } | null)?.scanned_today ?? 0),
    goal: readGoal(goalRow?.value),
  };
}

/**
 * Settings are stored both as a bare value and as { value }, depending on when
 * the row was written. Null, not a default: a goal the market never set is not
 * a goal of 40.
 */
export function readGoal(raw: unknown): number | null {
  const v = raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw;
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? num : null;
}
