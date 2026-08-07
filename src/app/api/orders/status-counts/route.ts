import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";

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
  confirmed: number;
  uploaded: number;
  /** Period counts — "aujourd'hui" */
  today: number;
  /** Health — 7-day confirmation rate, and the 7 days before it to trend against */
  confirmationRate: number | null;
  confirmationRatePrev: number | null;
  total: number;
}

const RECALL_STATUSES = ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"];

/** Awaiting carrier upload — the `Confirmées` tile's backlog. */
const CONFIRMED_STATUSES = ["confirmed", "dispatch_scheduled"];

/**
 * Every status that means "the customer said yes".
 *
 * Confirmation is transient — a confirmed order becomes uploaded, then scanned,
 * dispatched and delivered. Measuring the rate against CONFIRMED_STATUSES alone
 * counts every shipped order as a failure: Libya reported 7.7% where the real
 * figure is 78.7%.
 */
const REACHED_CONFIRMATION = [
  ...CONFIRMED_STATUSES,
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
  "to_be_returned",
];

const FAILED_STATUSES = ["rejected", "cancelled"];
/** A call that reached an outcome — the denominator of the confirmation rate. */
const RESOLVED_STATUSES = [...REACHED_CONFIRMATION, ...FAILED_STATUSES];

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
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
    confirmed,
    uploaded,
    todayCount,
    confirmed7,
    resolved7,
    confirmedPrev7,
    resolvedPrev7,
  ] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.is("assigned_to", null)),
    countWhere((q) => q.eq("status", "pending")),
    countWhere((q) => q.in("status", RECALL_STATUSES)),
    countWhere((q) => q.in("status", CONFIRMED_STATUSES)),
    countWhere((q) => q.eq("status", "uploaded")),
    countWhere((q) => q.gte("created_at", today)),
    countWhere((q) => q.in("status", REACHED_CONFIRMATION).gte("updated_at", d7)),
    countWhere((q) => q.in("status", RESOLVED_STATUSES).gte("updated_at", d7)),
    countWhere((q) => q.in("status", REACHED_CONFIRMATION).gte("updated_at", d14).lt("updated_at", d7)),
    countWhere((q) => q.in("status", RESOLVED_STATUSES).gte("updated_at", d14).lt("updated_at", d7)),
  ]);

  const firstError = [total, unassigned, waiting, toRecall, uploaded].find((r) => r?.error);
  if (firstError?.error) {
    const detail =
      firstError.error instanceof Error
        ? firstError.error.message
        : String((firstError.error as { message?: string })?.message ?? firstError.error);
    return NextResponse.json({ error: "Internal server error", detail }, { status: 500 });
  }

  const n = (r: { count: number | null }) => r?.count ?? 0;
  const rate = (num: { count: number | null }, den: { count: number | null }) =>
    n(den) === 0 ? null : Math.round((n(num) / n(den)) * 1000) / 10;

  const counts: StatusCounts = {
    unassigned: n(unassigned),
    waiting: n(waiting),
    toRecall: n(toRecall),
    confirmed: n(confirmed),
    uploaded: n(uploaded),
    today: n(todayCount),
    confirmationRate: rate(confirmed7, resolved7),
    confirmationRatePrev: rate(confirmedPrev7, resolvedPrev7),
    total: n(total),
  };

  return NextResponse.json(
    { data: counts },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } },
  );
}
