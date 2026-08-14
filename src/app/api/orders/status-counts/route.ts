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
  /** Period counts — "aujourd'hui" */
  today: number;
  /** The window the outcome counts were measured over, echoed back for labelling. */
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

const RECALL_STATUSES = ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Local calendar date, matching how the client seeds its default window. */
function todayDateOnly(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

  /**
   * Outcome window. Anything that is not a bare YYYY-MM-DD is discarded rather
   * than passed to PostgREST, and an absent window falls back to today — the
   * default period the tiles are labelled with.
   */
  const rawFrom = req.nextUrl.searchParams.get("date_from");
  const rawTo = req.nextUrl.searchParams.get("date_to");
  const validFrom = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : null;
  const validTo = rawTo && ISO_DATE.test(rawTo) ? rawTo : null;
  const windowFrom = validFrom ?? (validTo ? null : todayDateOnly());
  const windowTo = validTo;

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

  /**
   * The outcome window, applied on `created_at` exactly as /api/orders/list
   * applies it — same column, same inclusive upper bound. Any divergence here
   * puts a number on a tile that the table it opens will not reproduce.
   */
  const inWindow = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
    q: T,
  ): T => {
    let out = q;
    if (windowFrom) out = out.gte("created_at", windowFrom);
    if (windowTo) out = out.lte("created_at", `${windowTo}T23:59:59.999Z`);
    return out;
  };

  const [
    total,
    unassigned,
    toRecall,
    uploaded,
    rejected,
    delivered,
    todayCount,
    rateWindows,
  ] = await Promise.all([
    // `total` and `today` deliberately count soft-deleted orders: they are
    // operational counts of what came through, not money. Only financial
    // figures exclude deleted orders — see the money RPCs in
    // supabase/migrations/*_exclude_deleted_from_money.sql.
    countWhere((q) => q),
    countWhere((q) => whereUnassigned(q as never)),
    countWhere((q) => q.in("status", RECALL_STATUSES)),
    countWhere((q) => inWindow(q).eq("status", "uploaded")),
    countWhere((q) => inWindow(q).eq("status", "rejected")),
    countWhere((q) => inWindow(q).eq("status", "delivered")),
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

  const firstError = [total, unassigned, toRecall, uploaded, rejected, delivered].find(
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
    toRecall: n(toRecall),
    uploaded: n(uploaded),
    rejected: n(rejected),
    delivered: n(delivered),
    today: n(todayCount),
    window: { from: windowFrom, to: windowTo },
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
