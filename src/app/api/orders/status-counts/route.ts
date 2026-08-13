import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { whereUnassigned } from "@/lib/orders/unassigned";

export const dynamic = "force-dynamic";

/**
 * Counts behind the orders KPI strip.
 *
 * Queue tiles are standing backlogs ("maintenant"); outcome tiles are
 * period counts ("aujourd'hui"). The strip labels which is which, so the
 * two must not be conflated here either.
 *
 * Every figure comes from an exact head-count. The previous version did
 * `.select("status")` and tallied the returned array, which PostgREST caps
 * at 1000 rows — so a market with 2578 orders reported "1000 au total" and
 * every bucket was derived from an arbitrary truncated sample.
 */
export interface StatusCounts {
  /** Backlogs — "maintenant" */
  unassigned: number;
  waiting: number;
  toRecall: number;
  uploaded: number;
  /**
   * Standing count of a terminal status, not a backlog — nobody works it down.
   * It is still a "maintenant" figure, and it still has to equal what the table
   * shows for `status=rejected`, which is every rejection ever and not a window
   * over the last seven days.
   */
  rejected: number;
  /** Period counts — "aujourd'hui" */
  today: number;
  /** Health — 7-day confirmation rate, and the 7 days before it to trend against */
  confirmationRate: number | null;
  confirmationRatePrev: number | null;
  /**
   * How many decisions the current rate is computed from. A percentage with no
   * sample size cannot be judged: 100% of two calls and 100% of two hundred are
   * the same number and completely different facts.
   */
  confirmationSample: number;
  total: number;
}

const RECALL_STATUSES = ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"];

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

interface RateWindows {
  current_yes: number;
  current_total: number;
  prev_yes: number;
  prev_total: number;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? null
      : actorMarketId;

  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const today = startOfTodayIso();
  const d7 = daysAgoIso(7);
  const d14 = daysAgoIso(14);

  /** head-only exact count — never returns rows, so it cannot truncate. */
  const countWhere = (build: (q: ReturnType<typeof baseQuery>) => unknown) => {
    const q = baseQuery();
    return build(q) as Promise<{ count: number | null; error: unknown }>;
  };

  function baseQuery() {
    let q = supabase.from("orders").select("*", { count: "exact", head: true });
    if (marketId) q = q.eq("market_id", marketId);
    return q;
  }

  const [
    total,
    unassigned,
    waiting,
    toRecall,
    uploaded,
    rejected,
    todayCount,
    rateWindows,
  ] = await Promise.all([
    // `total` and `today` deliberately count soft-deleted orders: they are
    // operational counts of what came through, not money. Only financial
    // figures exclude deleted orders — see the money RPCs in
    // supabase/migrations/*_exclude_deleted_from_money.sql.
    countWhere((q) => q),
    countWhere((q) => whereUnassigned(q as never)),
    countWhere((q) => q.eq("status", "pending")),
    countWhere((q) => q.in("status", RECALL_STATUSES)),
    countWhere((q) => q.eq("status", "uploaded")),
    countWhere((q) => q.eq("status", "rejected")),
    countWhere((q) => q.gte("created_at", today)),
    // Dated by the transition itself, not by orders.updated_at — see the
    // function's comment in the migration for why that distinction is the whole
    // bug. Counting DISTINCT order_id is why this cannot be a PostgREST
    // head-count: confirmed → uploaded → confirmed retries inflate a raw row
    // count by ~60%.
    supabase.rpc("get_confirmation_rate_windows", {
      p_market_id: marketId,
      p_current_from: d7,
      p_prev_from: d14,
    }) as unknown as Promise<{ data: RateWindows[] | null; error: unknown }>,
  ]);

  const firstError = [total, unassigned, waiting, toRecall, uploaded, rejected].find(
    (r) => r?.error,
  );
  if (firstError?.error) {
    const detail =
      firstError.error instanceof Error
        ? firstError.error.message
        : String((firstError.error as { message?: string })?.message ?? firstError.error);
    return NextResponse.json({ error: "Internal server error", detail }, { status: 500 });
  }

  const n = (r: { count: number | null }) => r?.count ?? 0;

  /**
   * A rate over no decisions is not 0% and it is not 100% — it is *unknown*.
   * The previous version divided by a denominator that was sometimes 1, got
   * 100%, and rendered a confident "▼ 40.8" against it.
   */
  const rate = (yes: number, den: number) =>
    den === 0 ? null : Math.round((yes / den) * 1000) / 10;

  const w = rateWindows.data?.[0];
  const currentTotal = Number(w?.current_total ?? 0);
  const prevTotal = Number(w?.prev_total ?? 0);

  const counts: StatusCounts = {
    unassigned: n(unassigned),
    waiting: n(waiting),
    toRecall: n(toRecall),
    uploaded: n(uploaded),
    rejected: n(rejected),
    today: n(todayCount),
    confirmationRate: rate(Number(w?.current_yes ?? 0), currentTotal),
    confirmationRatePrev: rate(Number(w?.prev_yes ?? 0), prevTotal),
    confirmationSample: currentTotal,
    total: n(total),
  };

  return NextResponse.json(
    { data: counts },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } },
  );
}
