import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { attributeOrderRevenue } from "@/lib/calculations/order-revenue-attribution";

/**
 * Releases matured reserves.
 *
 * A reserve is held at settlement so a payout does not leave before the return
 * window closes. It only works if it eventually ends — otherwise it is simply a
 * permanent deduction. `reserve_release` was declared in the entry_type CHECK
 * and folded by investor-balance.ts from day one, but nothing ever wrote it, so
 * investors quietly lost reserve_pct of every payout forever.
 *
 * ── WHY THE RESERVE IS NOT A SECOND CHARGE ────────────────────────────────
 * rollup.ts books a return against the day its `returned` transition landed,
 * REVERSING the revenue and adding the return fee into that later period. A
 * continuing investor therefore already bears the entire reversal through the
 * next period's reduced profit. Charging the reserve as well takes the same
 * money twice, and the ledger is append-only so it cannot be given back.
 *
 * An earlier version summed `return_cost` from investor_daily_product_stats for
 * every day after period_end and capped it at the hold. That charged an
 * investor for returns of orders delivered in LATER periods — orders their
 * March capital never funded — and because the cap bound almost immediately, it
 * confiscated 100% of the reserve on any product with ongoing returns. Verified
 * against production: a 67.260 hold met 416.000 of unrelated April returns and
 * vanished entirely.
 *
 * So: release in full, and charge only an investor who has EXITED — no active
 * position and no later settled statement for that product. They have no future
 * period to absorb the reversal, which is the one case the reserve must cover.
 */

type Supa = SupabaseClient;

export interface ReserveReleaseResult {
  released: number;
  releasedAmount: number;
  corrections: number;
  correctionAmount: number;
}

/** One order that was delivered and later returned, costed to a single product. */
export interface LateReturnCandidate {
  /** ISO date the order's `delivered` transition landed. */
  deliveredOn: string;
  /** ISO date the order's `returned` transition landed. */
  returnedOn: string;
  /** This product's share of the order's return fee, in currency units. */
  returnCost: number;
}

/**
 * The investor's share of returns that are genuinely late for this period:
 * delivered INSIDE it, returned after it and on or before today.
 *
 * Pure so the money rule is testable with hand-checked numbers.
 */
export function lateReturnCharge(args: {
  periodStart: string;
  periodEnd: string;
  today: string;
  sharePct: number;
  /** A continuing investor absorbs the reversal via the next period instead. */
  investorExited: boolean;
  candidates: LateReturnCandidate[];
}): number {
  const { periodStart, periodEnd, today, sharePct, investorExited, candidates } = args;

  if (!investorExited) return 0;

  const lateMillimes = candidates.reduce((acc, c) => {
    const deliveredInPeriod = c.deliveredOn >= periodStart && c.deliveredOn <= periodEnd;
    const returnedAfterPeriod = c.returnedOn > periodEnd && c.returnedOn <= today;
    if (!deliveredInPeriod || !returnedAfterPeriod) return acc;
    return acc + toMillimes(Number(c.returnCost ?? 0));
  }, 0);

  return fromMillimes(Math.round((lateMillimes * Number(sharePct ?? 0)) / 100));
}

interface StatementRow {
  id: string;
  investor_id: string;
  product_id: string;
  market_id: string;
  period_start: string;
  period_end: string;
  reserve_held: number;
  share_pct: number;
  cost_inputs: Record<string, unknown> | null;
}

interface HistoryRow {
  order_id: string;
  created_at: string;
  orders: { id: string; carrier_id: string | null } | null;
}

/** ISO day of a timestamp, matching how the rollup buckets transitions. */
function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

/**
 * @param today ISO date. Injected rather than read from the clock so the
 *              behaviour is testable and a backfill can replay a past day.
 */
export async function releaseMaturedReserves(
  admin: Supa,
  today: string
): Promise<ReserveReleaseResult> {
  const result: ReserveReleaseResult = {
    released: 0,
    releasedAmount: 0,
    corrections: 0,
    correctionAmount: 0,
  };

  const statements = await fetchAllRows<StatementRow>(
    admin
      .from("investor_statements")
      .select(
        "id, investor_id, product_id, market_id, period_start, period_end, reserve_held, share_pct, cost_inputs"
      )
      .in("status", ["settled", "paid"])
      .gt("reserve_held", 0)
  );

  if (statements.length === 0) return result;

  // Already-released holds, so a re-run is idempotent. The ledger is
  // append-only, so double-releasing would be unrepairable.
  const releasedRows = await fetchAllRows<{ statement_id: string | null }>(
    admin
      .from("investor_ledger")
      .select("statement_id")
      .eq("entry_type", "reserve_release")
      .not("statement_id", "is", null)
  );
  const alreadyReleased = new Set(releasedRows.map((r) => r.statement_id));

  const matured = statements.filter((s) => {
    if (alreadyReleased.has(s.id)) return false;
    const releaseAfter = s.cost_inputs?.reserve_release_after as string | undefined;
    // A statement written before release dates existed still matures — fall
    // back to its period end so old holds are not stranded forever.
    return (releaseAfter ?? s.period_end) <= today;
  });

  if (matured.length === 0) return result;

  const investorIds = [...new Set(matured.map((s) => s.investor_id))];
  const productIds = [...new Set(matured.map((s) => s.product_id))];

  // Exit detection inputs, fetched once for the whole batch.
  const [openPositions, laterStatements, carrierRows] = await Promise.all([
    fetchAllRows<{ investor_id: string | null; product_id: string; effective_to: string | null; status: string }>(
      admin
        .from("investment_positions")
        .select("investor_id, product_id, effective_to, status")
        .in("investor_id", investorIds)
        .in("product_id", productIds)
    ),
    fetchAllRows<{ investor_id: string; product_id: string; period_start: string }>(
      admin
        .from("investor_statements")
        .select("investor_id, product_id, period_start")
        .in("investor_id", investorIds)
        .in("product_id", productIds)
        .in("status", ["settled", "paid"])
    ),
    admin.from("carriers").select("id, return_fee").then((r) => r.data ?? []),
  ]);

  const returnFees = new Map<string, number>(
    (carrierRows as { id: string; return_fee: number | null }[]).map((c) => [
      c.id,
      Number(c.return_fee ?? 0),
    ])
  );

  /** Still invested in this product today? */
  const stillHolding = (investorId: string, productId: string): boolean =>
    openPositions.some(
      (p) =>
        p.investor_id === investorId &&
        p.product_id === productId &&
        p.status === "active" &&
        (p.effective_to === null || p.effective_to >= today)
    );

  /** A later settled period will absorb the reversal on their behalf. */
  const hasLaterPeriod = (investorId: string, productId: string, periodEnd: string): boolean =>
    laterStatements.some(
      (s) => s.investor_id === investorId && s.product_id === productId && s.period_start > periodEnd
    );

  for (const s of matured) {
    const exited =
      !stillHolding(s.investor_id, s.product_id) &&
      !hasLaterPeriod(s.investor_id, s.product_id, s.period_end);

    let charge = 0;

    // Only an exited investor can be charged, so skip the (expensive) order
    // lookup entirely for everyone else.
    if (exited) {
      const [returnedRows, deliveredRows] = await Promise.all([
        fetchAllRows<HistoryRow>(
          admin
            .from("order_history")
            .select("order_id, created_at, orders!inner(id, carrier_id)")
            .eq("status_to", "returned")
            .eq("market_id", s.market_id)
            .gt("created_at", `${s.period_end}T23:59:59.999Z`)
            .lte("created_at", `${today}T23:59:59.999Z`)
        ),
        fetchAllRows<HistoryRow>(
          admin
            .from("order_history")
            .select("order_id, created_at, orders!inner(id, carrier_id)")
            .eq("status_to", "delivered")
            .eq("market_id", s.market_id)
            .gte("created_at", `${s.period_start}T00:00:00.000Z`)
            .lte("created_at", `${s.period_end}T23:59:59.999Z`)
        ),
      ]);

      const deliveredOn = new Map<string, string>();
      for (const d of deliveredRows) deliveredOn.set(d.order_id, dayOf(d.created_at));

      // Only orders delivered inside the period AND returned after it.
      const lateOrders = returnedRows.filter((r) => deliveredOn.has(r.order_id));

      if (lateOrders.length > 0) {
        const items = await fetchAllRows<{
          order_id: string;
          product_id: string | null;
          line_total: number;
        }>(
          admin
            .from("order_items")
            .select("order_id, product_id, line_total")
            .in("order_id", lateOrders.map((r) => r.order_id))
        );

        const linesByOrder = new Map<string, { productId: string | null; lineTotal: number }[]>();
        for (const it of items) {
          const list = linesByOrder.get(it.order_id) ?? [];
          list.push({ productId: it.product_id, lineTotal: Number(it.line_total) });
          linesByOrder.set(it.order_id, list);
        }

        const candidates: LateReturnCandidate[] = [];
        for (const r of lateOrders) {
          const fee = r.orders?.carrier_id ? returnFees.get(r.orders.carrier_id) ?? 0 : 0;
          if (fee <= 0) continue;
          // The carrier charges ONE return fee per parcel, split across the
          // products inside it — same rule the rollup uses.
          const share =
            attributeOrderRevenue({
              totalPrice: fee,
              lines: linesByOrder.get(r.order_id) ?? [],
            }).get(s.product_id) ?? 0;
          if (share <= 0) continue;
          candidates.push({
            deliveredOn: deliveredOn.get(r.order_id)!,
            returnedOn: dayOf(r.created_at),
            returnCost: share,
          });
        }

        charge = lateReturnCharge({
          periodStart: s.period_start,
          periodEnd: s.period_end,
          today,
          sharePct: Number(s.share_pct ?? 0),
          investorExited: true,
          candidates,
        });
      }
    }

    // Release and late-return charge happen in ONE transaction inside the RPC.
    // Doing them as two calls could release the money and then fail to charge
    // the return — unrecoverable on an append-only ledger.
    const { data, error } = await admin.rpc("release_investor_reserve", {
      p_statement_id: s.id,
      p_late_charge: charge,
    });

    if (error) {
      console.error(`[reserve-release] statement ${s.id} failed:`, error.message);
      continue;
    }

    const outcome = data as { released: boolean; amount?: number; late_charge?: number };
    if (!outcome?.released) continue;

    result.released += 1;
    result.releasedAmount = fromMillimes(
      toMillimes(result.releasedAmount) + toMillimes(Number(outcome.amount ?? 0))
    );

    if (Number(outcome.late_charge ?? 0) > 0) {
      result.corrections += 1;
      result.correctionAmount = fromMillimes(
        toMillimes(result.correctionAmount) + toMillimes(Number(outcome.late_charge))
      );
    }
  }

  return result;
}
