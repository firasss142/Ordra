import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { foldLedger, type LedgerEntry, type InvestorBalance } from "@/lib/calculations/investor-balance";
import { activeCapitalInPeriod, type CapitalPosition } from "@/lib/calculations/investor-allocation";

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
}

interface PositionRow {
  product_id: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  products: { name: string } | { name: string }[] | null;
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

function productName(row: PositionRow): string {
  const p = Array.isArray(row.products) ? row.products[0] : row.products;
  return p?.name ?? "—";
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
      .select("product_id, amount, effective_from, effective_to, status, products(name)")
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

  const [ledgerRows, statementRows] = await Promise.all([
    fetchAllRows<{ entry_type: string; amount: number }>(
      admin.from("investor_ledger").select("entry_type, amount").eq("investor_id", investorId)
    ),
    fetchAllRows<{ product_id: string; investor_share: number; period_end: string }>(
      admin
        .from("investor_statements")
        .select("product_id, investor_share, period_end")
        .eq("investor_id", investorId)
        .eq("status", "settled")
    ),
  ]);

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

  const lastSettledPeriodEnd =
    statementRows.length > 0
      ? statementRows.map((s) => s.period_end).sort().at(-1) ?? null
      : null;

  const summaries: PositionSummary[] = positions.map((pos) => {
    const rows = byProduct.get(pos.product_id) ?? [];

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

    return {
      productId: pos.product_id,
      productName: productName(pos),
      capital: Number(pos.amount),
      effectiveFrom: pos.effective_from,
      effectiveTo: pos.effective_to,
      status: pos.status,
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

  const today = new Date().toISOString().slice(0, 10);
  const totalInvested = positions
    .filter((p) => p.status === "active" && (p.effective_to === null || p.effective_to >= today))
    .reduce((acc, p) => acc + toMillimes(Number(p.amount)), 0);

  // Total capital per product — every holder, including the house and other
  // investors — so the share percentage is the real denominator. Only
  // aggregate figures derived from this leave the module; the composition of
  // other people's capital is never exposed.
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

  const unsettledEstimate = estimateUnsettled({
    summaries,
    positions,
    allPositions,
    statsByProduct: byProduct,
    lastSettledPeriodEnd,
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
  };
}

/**
 * The investor's share of profit earned since the last settled period.
 *
 * Explicitly an ESTIMATE, and deliberately not withdrawable. It is recomputed
 * from today's costs, so a late-arriving return or an edited price still moves
 * it; only a settlement snapshot turns it into money. Showing it is what makes
 * the "why can't I withdraw yet?" question answer itself.
 *
 * Days already covered by a settled statement are excluded, so this never
 * double-counts money the investor has already been credited.
 */
function estimateUnsettled(args: {
  summaries: PositionSummary[];
  positions: PositionRow[];
  allPositions: {
    product_id: string;
    investor_id: string | null;
    amount: number;
    effective_from: string;
    effective_to: string | null;
  }[];
  statsByProduct: Map<string, StatRow[]>;
  lastSettledPeriodEnd: string | null;
}): number {
  const { positions, allPositions, statsByProduct, lastSettledPeriodEnd } = args;
  const today = new Date().toISOString().slice(0, 10);

  let totalMillimes = 0;

  for (const pos of positions) {
    const rows = statsByProduct.get(pos.product_id) ?? [];

    // Only days after the last settled period count.
    const unsettledRows = lastSettledPeriodEnd
      ? rows.filter((r) => r.stat_date > lastSettledPeriodEnd)
      : rows;
    if (unsettledRows.length === 0) continue;

    const window = {
      start: lastSettledPeriodEnd ?? pos.effective_from,
      end: today,
    };

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

    const netProfitMillimes = unsettledRows.reduce(
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

    // Market-wide ad spend is NOT subtracted here — it can only be allocated
    // once the period's revenue across all products is known, at settlement.
    // That makes this estimate optimistic by design, so it is labelled as an
    // estimate in the UI rather than presented as a balance.
    totalMillimes += Math.round((netProfitMillimes * mine) / total);
  }

  // A loss period shows as zero pending rather than a negative balance; the
  // carried loss is applied at settlement.
  return Math.max(0, fromMillimes(totalMillimes));
}
