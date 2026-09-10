import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { marketDayBounds, todayInMarket } from "@/lib/dates/market-day";

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
  /** Backlogs — "maintenant". No date window: a backlog is what is sitting there. */
  unassigned: number;
  toRecall: number;
  /**
   * Outcome counts — measured over `window`, which defaults to today.
   *
   * Dated by `created_at`, the same column /api/orders/list filters on, so the
   * tile and the table it opens count the same set. That means these read as
   * "orders that CAME IN during the window and are now uploaded / rejected /
   * delivered" — not "orders uploaded during the window". Deliberate: the
   * alternative dates by the transition and no longer matches the table.
   */
  uploaded: number;
  rejected: number;
  delivered: number;
  /**
   * Every order that came in during `window`, whatever became of it — the
   * denominator the outcome tiles above are read against.
   *
   * It was a fixed "orders created today" figure, which meant selecting
   * "30 derniers jours" moved every other tile and left this one on the current
   * day: one row describing two periods at once.
   *
   * Unlike `total`, this one excludes soft-deleted orders. It is navigation —
   * the tile opens the table filtered to the same window, and the working list
   * hides deleted orders, so counting them here would put a number on screen
   * that the list it opens cannot reproduce (design-system §4.17 G).
   */
  periodTotal: number;
  /** The window the period counts were measured over, echoed back for labelling. */
  window: { from: string | null; to: string | null };
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** What get_orders_kpi_counts returns — snake_case, straight from jsonb. */
interface KpiCounts {
  total: number;
  unassigned: number;
  to_recall: number;
  uploaded: number;
  rejected: number;
  delivered: number;
  period_total: number;
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
  const d7 = daysAgoIso(7);
  const d14 = daysAgoIso(14);

  /**
   * Outcome window. Anything that is not a bare YYYY-MM-DD is discarded rather
   * than passed to PostgREST, and an absent window falls back to today — the
   * default period the tiles are labelled with.
   */
  const rawFrom = req.nextUrl.searchParams.get("date_from");
  const rawTo = req.nextUrl.searchParams.get("date_to");
  const validFrom = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : null;
  const validTo = rawTo && ISO_DATE.test(rawTo) ? rawTo : null;
  // "Today" is the market's calendar day, not the server's (Vercel runs UTC).
  const windowFrom = validFrom ?? (validTo ? null : todayInMarket(marketId));
  const windowTo = validTo;
  // The dates name market-local days; created_at is UTC. Cut at the market's
  // day edges, exactly as /api/orders/list does, or the tile and the table it
  // opens disagree on every order placed after 22:00 in Tripoli.
  const windowUtc = marketDayBounds(windowFrom, windowTo, marketId);

  /**
   * Every tile in one pass.
   *
   * This was seven exact PostgREST head-counts in a Promise.all — seven round
   * trips asking the same table the same question with different filters, each
   * paying full network and planning cost. `get_orders_kpi_counts` answers all
   * seven with `count(*) FILTER (...)` over a single scan.
   *
   * The predicates live in the migration, copied verbatim from what this route
   * used to do; the equivalence was checked against the old head-counts on
   * production for both markets and for the all-markets scope before the
   * switch. The function is SECURITY INVOKER, so RLS still decides what a
   * market manager can count — verified from a manager session: own market
   * 3769, another market 0.
   */
  const [kpi, rateWindows] = await Promise.all([
    supabase.rpc("get_orders_kpi_counts", {
      p_market_id: marketId,
      p_from: windowUtc.fromIso,
      p_to: windowUtc.toIso,
    }) as unknown as Promise<{ data: KpiCounts | null; error: unknown }>,
    // Dated by the transition itself, not by orders.updated_at — see the
    // function's comment in the migration for why that distinction is the whole
    // bug. Counting DISTINCT order_id is why this cannot be a head-count:
    // confirmed → uploaded → confirmed retries inflate a raw row count by ~60%.
    supabase.rpc("get_confirmation_rate_windows", {
      p_market_id: marketId,
      p_current_from: d7,
      p_prev_from: d14,
    }) as unknown as Promise<{ data: RateWindows[] | null; error: unknown }>,
  ]);

  // A strip of zeroes reads as "a quiet day", which is a lie a manager would
  // act on — so a failed count is an error, never a default.
  if (kpi.error || !kpi.data) {
    const detail =
      kpi.error instanceof Error
        ? kpi.error.message
        : String((kpi.error as { message?: string })?.message ?? kpi.error ?? "no data");
    return NextResponse.json({ error: "Internal server error", detail }, { status: 500 });
  }

  const c = kpi.data;
  const n = (v: unknown) => Number(v ?? 0);

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
    unassigned: n(c.unassigned),
    toRecall: n(c.to_recall),
    uploaded: n(c.uploaded),
    rejected: n(c.rejected),
    delivered: n(c.delivered),
    periodTotal: n(c.period_total),
    window: { from: windowFrom, to: windowTo },
    confirmationRate: rate(Number(w?.current_yes ?? 0), currentTotal),
    confirmationRatePrev: rate(Number(w?.prev_yes ?? 0), prevTotal),
    confirmationSample: currentTotal,
    total: n(c.total),
  };

  return NextResponse.json(
    { data: counts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
