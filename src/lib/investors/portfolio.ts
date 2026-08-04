import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { foldLedger, type LedgerEntry, type InvestorBalance } from "@/lib/calculations/investor-balance";
import {
  activeCapitalInPeriod,
  computeSharePct,
  type CapitalPosition,
} from "@/lib/calculations/investor-allocation";

/**
 * Reads one investor's portfolio.
 *
 * Runs under the service-role client and scopes every query to the caller's own
 * id, taken from the session — never from the request body. Investors have no
 * RLS grant on orders, products or the daily rollup, so this module is the only
 * path by which their data reaches them, and it deliberately returns nothing
 * about products they do not hold a position in.
 */

type Supa = SupabaseClient;

export interface PositionSummary {
  productId: string;
  productName: string;
  /**
   * Public storage URL for the product photo, or null.
   *
   * A funded product is the thing the investor believes they own; a name in
   * 15px grey is a weaker anchor than the picture they were sold on. The
   * bucket is public-read, so no signed URL is needed.
   */
  imageUrl: string | null;
  capital: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;

  // Operational story, restricted to this product
  leads: number;
  confirmed: number;
  uploaded: number;
  delivered: number;
  returned: number;

  // Waterfall, this product only
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  processingCost: number;
  adSpend: number;
  netProfit: number;

  /**
   * The investor's percentage of this product's capital, house included.
   *
   * Shown next to every figure so the two columns explain their own
   * arithmetic — the portfolio previously displayed the product's full P&L
   * beside a settled share with no stated relationship between them.
   */
  sharePct: number;
  /** The same waterfall, but the investor's share of each line. */
  yours: {
    revenue: number;
    cogs: number;
    deliveryCost: number;
    returnCost: number;
    packingCost: number;
    processingCost: number;
    adSpend: number;
    netProfit: number;
  };

  /** Settled profit share to date for this product. */
  settledShare: number;
  /** Rates the investor should actually care about in COD. */
  deliveryRate: number;
  returnRate: number;
}

export interface PortfolioResult {
  investor: { id: string; legalName: string; reservePct: number };
  marketId: string | null;
  /**
   * Uppercase market code ("TN" | "LY"). This is what formatCurrency() takes —
   * it switches on the MARKET, not the currency, so passing "LYD" would
   * silently render Libyan money as Tunisian dinars.
   */
  marketCode: string;
  currency: string;
  balance: InvestorBalance;
  totalInvested: number;
  lifetimeShare: number;
  positions: PositionSummary[];
  /** Profit accrued since the last settled period — visible but not withdrawable. */
  unsettledEstimate: number;
  lastSettledPeriodEnd: string | null;
  /**
   * Settled money already spoken for by requested/approved withdrawals.
   *
   * The portfolio used to show the raw ledger `available` under the label
   * "retirable maintenant" while the withdrawals form, which subtracts open
   * requests, offered a smaller number. Returning the claim here lets both
   * surfaces agree.
   */
  claimedByOpenRequests: number;
  /**
   * When the earliest still-held reserve matures, or null if none is held.
   *
   * The balance card showed an amount withheld and never said when it comes
   * back, which reads as an open-ended deduction rather than a timed hold.
   */
  reserveReleaseAfter: string | null;
}

type ProductRef = { name: string; image_url: string | null };

interface PositionRow {
  product_id: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  products: ProductRef | ProductRef[] | null;
}

interface StatRow {
  product_id: string;
  stat_date: string;
  leads_count: number;
  confirmed_count: number;
  uploaded_count: number;
  delivered_count: number;
  returned_count: number;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  ad_spend_direct: number;
}

function product(row: PositionRow): ProductRef | null {
  return (Array.isArray(row.products) ? row.products[0] : row.products) ?? null;
}

function productName(row: PositionRow): string {
  return product(row)?.name ?? "—";
}

function productImage(row: PositionRow): string | null {
  return product(row)?.image_url ?? null;
}

/**
 * An amount's share, in exact millimes.
 *
 * The portal shows every waterfall line as the product figure beside the
 * investor's share, so the share column has to add up to the share of the
 * total — otherwise the page invites exactly the arithmetic argument it exists
 * to prevent. Rounding once per line in integer millimes keeps that true.
 *
 * Lives here rather than in the component because financial calculations are
 * server-side only (see lib/calculations/CLAUDE.md).
 */
export function applyShare(amount: number, sharePct: number): number {
  return fromMillimes(Math.round((toMillimes(amount) * sharePct) / 100));
}

/**
 * This position's percentage of all capital in the product, house included.
 *
 * The denominator is every position overlapping this one's life — without the
 * house row (investor_id NULL) a sole investor computes as owning 100% of the
 * profit.
 */
export function positionSharePct(args: {
  position: { amount: number; effective_from: string; effective_to: string | null };
  allPositionsForProduct: {
    investor_id: string | null;
    amount: number;
    effective_from: string;
    effective_to: string | null;
  }[];
  today: string;
}): number {
  const { position, allPositionsForProduct, today } = args;

  const window = {
    start: position.effective_from,
    end:
      position.effective_to !== null && position.effective_to < today
        ? position.effective_to
        : today,
  };

  const mine = activeCapitalInPeriod(
    [
      {
        amount: Number(position.amount),
        effectiveFrom: position.effective_from,
        effectiveTo: position.effective_to,
      },
    ],
    window
  );

  const total = activeCapitalInPeriod(
    allPositionsForProduct.map((p) => ({
      amount: Number(p.amount),
      effectiveFrom: p.effective_from,
      effectiveTo: p.effective_to,
    })),
    window
  );

  return computeSharePct({ investorCapital: mine, totalCapital: total });
}

/** Delivered / (delivered + returned), as a percentage to one decimal. */
function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function loadPortfolio(
  admin: Supa,
  investorId: string
): Promise<PortfolioResult | null> {
  const { data: investor } = await admin
    .from("investors")
    .select("id, legal_name, reserve_pct")
    .eq("id", investorId)
    .single();

  if (!investor) return null;

  const { data: userRow } = await admin
    .from("users")
    .select("market_id, markets(code, currency)")
    .eq("id", investorId)
    .single();

  const marketRel = (
    userRow as { markets?: { code: string; currency: string } | { code: string; currency: string }[] } | null
  )?.markets;
  const market = Array.isArray(marketRel) ? marketRel[0] : marketRel;

  const positions = await fetchAllRows<PositionRow>(
    admin
      .from("investment_positions")
      .select("product_id, amount, effective_from, effective_to, status, products(name, image_url)")
      .eq("investor_id", investorId)
      .order("effective_from", { ascending: true })
  );

  const productIds = [...new Set(positions.map((p) => p.product_id))];

  // Only ever the products this investor actually funded.
  const stats =
    productIds.length > 0
      ? await fetchAllRows<StatRow>(
          admin
            .from("investor_daily_product_stats")
            .select(
              "product_id, stat_date, leads_count, confirmed_count, uploaded_count, delivered_count, returned_count, revenue, cogs, delivery_cost, return_cost, packing_cost, processing_cost, ad_spend_direct"
            )
            .in("product_id", productIds)
        )
      : [];

  // Every holder's capital in these products — the house included — so each
  // card can state the share the figures beside it were computed with. Fetched
  // before the summaries because they now need it; estimateUnsettled reuses it.
  const allPositions =
    productIds.length > 0
      ? await fetchAllRows<{
          product_id: string;
          investor_id: string | null;
          amount: number;
          effective_from: string;
          effective_to: string | null;
        }>(
          admin
            .from("investment_positions")
            .select("product_id, investor_id, amount, effective_from, effective_to")
            .in("product_id", productIds)
        )
      : [];

  const [ledgerRows, statementRows, openRequestRows] = await Promise.all([
    fetchAllRows<{ entry_type: string; amount: number }>(
      admin.from("investor_ledger").select("entry_type, amount").eq("investor_id", investorId)
    ),
    fetchAllRows<{
      product_id: string;
      investor_share: number;
      period_end: string;
      reserve_held: number;
      cost_inputs: Record<string, unknown> | null;
    }>(
      admin
        .from("investor_statements")
        .select("product_id, investor_share, period_end, reserve_held, cost_inputs")
        .eq("investor_id", investorId)
        .eq("status", "settled")
    ),
    // A request only leaves the ledger when it is PAID, so requested/approved
    // rows still sit inside `available` while being unavailable to spend.
    fetchAllRows<{ amount: number }>(
      admin
        .from("withdrawal_requests")
        .select("amount")
        .eq("investor_id", investorId)
        .in("status", ["requested", "approved"])
    ),
  ]);

  const claimedByOpenRequests = fromMillimes(
    openRequestRows.reduce((acc, r) => acc + toMillimes(Number(r.amount)), 0)
  );

  // The soonest maturity among statements that still hold a reserve. Only
  // meaningful while balance.reserve > 0, which the card checks.
  const reserveReleaseAfter =
    statementRows
      .filter((s) => Number(s.reserve_held) > 0)
      .map((s) => (s.cost_inputs?.reserve_release_after as string | undefined) ?? s.period_end)
      .sort()
      .at(0) ?? null;

  const balance = foldLedger(
    ledgerRows.map((r) => ({
      entryType: r.entry_type as LedgerEntry["entryType"],
      amount: Number(r.amount),
    }))
  );

  // Aggregate daily stats per product.
  const byProduct = new Map<string, StatRow[]>();
  for (const s of stats) {
    const list = byProduct.get(s.product_id) ?? [];
    list.push(s);
    byProduct.set(s.product_id, list);
  }

  const settledByProduct = new Map<string, number>();
  for (const s of statementRows) {
    settledByProduct.set(
      s.product_id,
      fromMillimes(
        toMillimes(settledByProduct.get(s.product_id) ?? 0) + toMillimes(Number(s.investor_share))
      )
    );
  }

  // Settlement watermark PER PRODUCT.
  //
  // A single global cutoff was wrong in both directions: if p-alpha was settled
  // through June but p-beta had never been settled, the June cutoff suppressed
  // all of p-beta's earlier profit from the estimate while leaving p-alpha's
  // already-paid profit visible.
  const settledThrough = new Map<string, string>();
  for (const s of statementRows) {
    const seen = settledThrough.get(s.product_id);
    if (seen === undefined || s.period_end > seen) {
      settledThrough.set(s.product_id, s.period_end);
    }
  }

  const lastSettledPeriodEnd =
    statementRows.length > 0
      ? [...settledThrough.values()].sort().at(-1) ?? null
      : null;

  const today = new Date().toISOString().slice(0, 10);

  const summaries: PositionSummary[] = positions.map((pos) => {
    // Window the stats to the life of THIS position.
    //
    // Previously the stats were fetched by product_id with no date bound, so
    // an investor who opened a position last week saw the product's entire
    // trading history — potentially years of profit — presented as theirs,
    // next to a settled share of zero. That reads as being cheated.
    const rows = (byProduct.get(pos.product_id) ?? []).filter(
      (r) =>
        r.stat_date >= pos.effective_from &&
        (pos.effective_to === null || r.stat_date <= pos.effective_to)
    );

    const sum = (pick: (r: StatRow) => number) =>
      fromMillimes(rows.reduce((acc, r) => acc + toMillimes(Number(pick(r))), 0));

    const revenue = sum((r) => r.revenue);
    const cogs = sum((r) => r.cogs);
    const deliveryCost = sum((r) => r.delivery_cost);
    const returnCost = sum((r) => r.return_cost);
    const packingCost = sum((r) => r.packing_cost);
    const processingCost = sum((r) => r.processing_cost);
    const adSpend = sum((r) => r.ad_spend_direct);

    const netProfit = fromMillimes(
      toMillimes(revenue) -
        toMillimes(cogs) -
        toMillimes(deliveryCost) -
        toMillimes(returnCost) -
        toMillimes(packingCost) -
        toMillimes(processingCost) -
        toMillimes(adSpend)
    );

    const delivered = rows.reduce((a, r) => a + r.delivered_count, 0);
    const returned = rows.reduce((a, r) => a + r.returned_count, 0);

    // The share these figures were computed with, and the investor's own
    // column. Both are produced here rather than in the component because
    // financial calculations never run client-side.
    const sharePct = positionSharePct({
      position: pos,
      allPositionsForProduct: allPositions.filter((p) => p.product_id === pos.product_id),
      today,
    });

    const yours = {
      revenue: applyShare(revenue, sharePct),
      cogs: applyShare(cogs, sharePct),
      deliveryCost: applyShare(deliveryCost, sharePct),
      returnCost: applyShare(returnCost, sharePct),
      packingCost: applyShare(packingCost, sharePct),
      processingCost: applyShare(processingCost, sharePct),
      adSpend: applyShare(adSpend, sharePct),
      netProfit: applyShare(netProfit, sharePct),
    };

    return {
      productId: pos.product_id,
      productName: productName(pos),
      imageUrl: productImage(pos),
      capital: Number(pos.amount),
      effectiveFrom: pos.effective_from,
      effectiveTo: pos.effective_to,
      status: pos.status,
      sharePct,
      yours,
      leads: rows.reduce((a, r) => a + r.leads_count, 0),
      confirmed: rows.reduce((a, r) => a + r.confirmed_count, 0),
      uploaded: rows.reduce((a, r) => a + r.uploaded_count, 0),
      delivered,
      returned,
      revenue,
      cogs,
      deliveryCost,
      returnCost,
      packingCost,
      processingCost,
      adSpend,
      netProfit,
      settledShare: settledByProduct.get(pos.product_id) ?? 0,
      deliveryRate: rate(delivered, delivered + returned),
      returnRate: rate(returned, delivered + returned),
    };
  });

  const totalInvested = positions
    .filter((p) => p.status === "active" && (p.effective_to === null || p.effective_to >= today))
    .reduce((acc, p) => acc + toMillimes(Number(p.amount)), 0);

  const unsettledEstimate = estimateUnsettled({
    positions,
    allPositions,
    statsByProduct: byProduct,
    settledThrough,
  });

  return {
    investor: {
      id: investor.id as string,
      legalName: investor.legal_name as string,
      reservePct: Number(investor.reserve_pct ?? 0),
    },
    marketId: (userRow?.market_id as string | undefined) ?? null,
    marketCode: (market?.code ?? "tn").toUpperCase(),
    currency: market?.currency ?? "TND",
    balance,
    totalInvested: fromMillimes(totalInvested),
    lifetimeShare: balance.lifetimeProfit,
    positions: summaries,
    unsettledEstimate,
    lastSettledPeriodEnd,
    claimedByOpenRequests,
    reserveReleaseAfter,
  };
}

/**
 * The investor's share of profit earned since their last SETTLED period.
 *
 * Explicitly an estimate, and never withdrawable. It is recomputed from
 * today's costs, so a late return or an edited price still moves it; only a
 * settlement snapshot turns it into money.
 *
 * Three things were wrong here before, all of which inflated the number an
 * investor was shown:
 *   - the settlement watermark was a single global cutoff rather than
 *     per-product, so it suppressed one product's profit and double-showed
 *     another's;
 *   - the capital window started ON the last settled day while the profit
 *     window started AFTER it, so the two were a day out of step;
 *   - allocated market-wide ad spend was never subtracted, though settlement
 *     does subtract it.
 *
 * Market-wide ad spend still cannot be allocated here — the split depends on
 * revenue across ALL products in the period, which this per-investor view does
 * not have. So the estimate is capped by the caller's understanding that it is
 * an upper bound, and the UI labels it as an estimate rather than a balance.
 */
function estimateUnsettled(args: {
  positions: PositionRow[];
  allPositions: {
    product_id: string;
    investor_id: string | null;
    amount: number;
    effective_from: string;
    effective_to: string | null;
  }[];
  statsByProduct: Map<string, StatRow[]>;
  /** Latest settled period_end per product. */
  settledThrough: Map<string, string>;
}): number {
  const { positions, allPositions, statsByProduct, settledThrough } = args;
  const today = new Date().toISOString().slice(0, 10);

  let totalMillimes = 0;

  for (const pos of positions) {
    const cutoff = settledThrough.get(pos.product_id) ?? null;

    // Days after this product's own watermark, and inside this position's life.
    const rows = (statsByProduct.get(pos.product_id) ?? []).filter(
      (r) =>
        (cutoff === null || r.stat_date > cutoff) &&
        r.stat_date >= pos.effective_from &&
        (pos.effective_to === null || r.stat_date <= pos.effective_to)
    );
    if (rows.length === 0) continue;

    // The capital window must match the profit window exactly. Use the first
    // unsettled day, not the last settled one.
    const windowStart = rows.reduce((min, r) => (r.stat_date < min ? r.stat_date : min), rows[0].stat_date);
    const windowEnd = pos.effective_to !== null && pos.effective_to < today ? pos.effective_to : today;
    const window = { start: windowStart, end: windowEnd };

    const mine = activeCapitalInPeriod(
      [
        {
          amount: Number(pos.amount),
          effectiveFrom: pos.effective_from,
          effectiveTo: pos.effective_to,
        } satisfies CapitalPosition,
      ],
      window
    );
    if (mine <= 0) continue;

    const total = activeCapitalInPeriod(
      allPositions
        .filter((p) => p.product_id === pos.product_id)
        .map((p) => ({
          amount: Number(p.amount),
          effectiveFrom: p.effective_from,
          effectiveTo: p.effective_to,
        })),
      window
    );
    if (total <= 0) continue;

    const netProfitMillimes = rows.reduce(
      (acc, r) =>
        acc +
        toMillimes(Number(r.revenue)) -
        toMillimes(Number(r.cogs)) -
        toMillimes(Number(r.delivery_cost)) -
        toMillimes(Number(r.return_cost)) -
        toMillimes(Number(r.packing_cost)) -
        toMillimes(Number(r.processing_cost)) -
        toMillimes(Number(r.ad_spend_direct)),
      0
    );

    totalMillimes += Math.round((netProfitMillimes * mine) / total);
  }

  // A loss shows as zero pending rather than a negative balance; the carried
  // loss is applied at settlement.
  return Math.max(0, fromMillimes(totalMillimes));
}
