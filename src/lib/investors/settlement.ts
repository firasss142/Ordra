import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { allocateMarketAdSpend } from "@/lib/calculations/ad-spend-allocation";
import {
  activeCapitalInPeriod,
  computeSharePct,
  settleInvestorShare,
  type CapitalPosition,
} from "@/lib/calculations/investor-allocation";
import type { LedgerEntryType } from "@/lib/calculations/investor-balance";

/**
 * Turns a period of daily rollup rows into immutable investor statements plus
 * the ledger entries that move the money.
 *
 * Pure by design. The API route loads and persists; this decides. That keeps
 * the one calculation that determines what a person is actually paid fully
 * unit-testable with hand-checked numbers.
 *
 * THE RULE THIS ENFORCES: a statement carries its own inputs. Everything the
 * figures depend on — unit_cogs, carrier fees, packing, processing, the capital
 * split — is written into cost_inputs at settlement time. Nothing here is ever
 * recomputed from a live join afterwards, so a later price edit or a
 * late-arriving return cannot rewrite a period that has already been paid.
 */

export interface PeriodProductTotals {
  productId: string;
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  processingCost: number;
  adSpendDirect: number;
  deliveredCount: number;
  returnedCount: number;
  confirmedCount: number;
}

export interface InvestorPositionsForProduct {
  productId: string;
  /** Positions per investor id. The house is keyed by HOUSE_KEY. */
  byHolder: Map<string, CapitalPosition[]>;
}

export const HOUSE_KEY = "__house__";

export interface SettlementInput {
  marketId: string;
  periodStart: string;
  periodEnd: string;
  products: PeriodProductTotals[];
  /** Market-wide ad spend (product_id IS NULL) for the period. */
  marketWideAdSpend: number;
  positions: InvestorPositionsForProduct[];
  /** Outstanding carried loss per `${investorId}:${productId}`. */
  carriedLosses: Map<string, number>;
  /** Reserve percentage per investor id. */
  reservePct: Map<string, number>;
}

export interface StatementRow {
  investor_id: string;
  product_id: string;
  market_id: string;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend_direct: number;
  ad_spend_allocated: number;
  processing_cost: number;
  net_profit: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
  investor_capital: number;
  total_capital: number;
  share_pct: number;
  investor_share: number;
  reserve_held: number;
  carried_loss_applied: number;
  cost_inputs: Record<string, unknown>;
  status: "draft";
}

export interface LedgerRow {
  investor_id: string;
  product_id: string;
  market_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  note: string;
}

export interface SettlementResult {
  statements: StatementRow[];
  ledger: LedgerRow[];
  /** Updated carried loss per `${investorId}:${productId}`. */
  carriedLossAfter: Map<string, number>;
  /** Product net profit, for reconciliation against the market P&L. */
  netProfitByProduct: Map<string, number>;
}

function netProfitOf(p: PeriodProductTotals, allocatedAds: number): number {
  return fromMillimes(
    toMillimes(p.revenue) -
      toMillimes(p.cogs) -
      toMillimes(p.deliveryCost) -
      toMillimes(p.returnCost) -
      toMillimes(p.packingCost) -
      toMillimes(p.processingCost) -
      toMillimes(p.adSpendDirect) -
      toMillimes(allocatedAds)
  );
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const period = { start: input.periodStart, end: input.periodEnd };

  // Market-wide ad spend is charged to products in proportion to the revenue
  // they actually produced this period. Without this, every product looks more
  // profitable than it is and product profits never reconcile to the market
  // P&L — which stops being cosmetic the moment it decides a payout.
  const allocation = allocateMarketAdSpend({
    marketWideSpend: input.marketWideAdSpend,
    productRevenues: input.products.map((p) => ({
      productId: p.productId,
      revenue: p.revenue,
    })),
  });

  const statements: StatementRow[] = [];
  const ledger: LedgerRow[] = [];
  const carriedLossAfter = new Map(input.carriedLosses);
  const netProfitByProduct = new Map<string, number>();

  const positionsByProduct = new Map(
    input.positions.map((p) => [p.productId, p.byHolder])
  );

  for (const product of input.products) {
    const allocatedAds = allocation.get(product.productId) ?? 0;
    const netProfit = netProfitOf(product, allocatedAds);
    netProfitByProduct.set(product.productId, netProfit);

    const holders = positionsByProduct.get(product.productId);
    if (!holders || holders.size === 0) continue; // nobody funded this product

    // Denominator includes house capital, so a business-funded restock dilutes
    // investors automatically rather than by renegotiation.
    let totalCapital = 0;
    const capitalByHolder = new Map<string, number>();
    for (const [holderId, positions] of holders) {
      const capital = activeCapitalInPeriod(positions, period);
      capitalByHolder.set(holderId, capital);
      totalCapital = fromMillimes(toMillimes(totalCapital) + toMillimes(capital));
    }

    for (const [holderId, investorCapital] of capitalByHolder) {
      if (holderId === HOUSE_KEY) continue; // the house gets no statement
      if (investorCapital <= 0) continue;

      const sharePct = computeSharePct({ investorCapital, totalCapital });
      const key = `${holderId}:${product.productId}`;
      const carriedLoss = input.carriedLosses.get(key) ?? 0;

      const outcome = settleInvestorShare({ netProfit, sharePct, carriedLoss });
      carriedLossAfter.set(key, outcome.carriedLossAfter);

      // Reserve is held against returns that land after the period closes.
      const pct = input.reservePct.get(holderId) ?? 0;
      const reserveHeld = fromMillimes(
        Math.round((toMillimes(outcome.payable) * pct) / 100)
      );

      statements.push({
        investor_id: holderId,
        product_id: product.productId,
        market_id: input.marketId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        revenue: product.revenue,
        cogs: product.cogs,
        delivery_cost: product.deliveryCost,
        return_cost: product.returnCost,
        packing_cost: product.packingCost,
        ad_spend_direct: product.adSpendDirect,
        ad_spend_allocated: allocatedAds,
        processing_cost: product.processingCost,
        net_profit: netProfit,
        delivered_count: product.deliveredCount,
        returned_count: product.returnedCount,
        confirmed_count: product.confirmedCount,
        investor_capital: investorCapital,
        total_capital: totalCapital,
        share_pct: sharePct,
        investor_share: outcome.payable,
        reserve_held: reserveHeld,
        carried_loss_applied: outcome.lossApplied,
        cost_inputs: {
          market_wide_ad_spend: input.marketWideAdSpend,
          allocated_ad_spend: allocatedAds,
          gross_share_before_loss: outcome.grossShare,
          carried_loss_before: carriedLoss,
          carried_loss_after: outcome.carriedLossAfter,
          reserve_pct: pct,
          capital_basis: { investor: investorCapital, total: totalCapital },
        },
        status: "draft",
      });

      // Nothing payable (loss period, or wholly absorbed by a carried loss)
      // still produces a statement — the investor is entitled to see the
      // period — but no money moves.
      if (outcome.payable <= 0) continue;

      const label = `${input.periodStart}..${input.periodEnd}`;
      ledger.push({
        investor_id: holderId,
        product_id: product.productId,
        market_id: input.marketId,
        entry_type: "accrual",
        amount: outcome.payable,
        note: `Profit share ${label}`,
      });
      ledger.push({
        investor_id: holderId,
        product_id: product.productId,
        market_id: input.marketId,
        entry_type: "settlement",
        amount: outcome.payable,
        note: `Settled ${label}`,
      });
      if (reserveHeld > 0) {
        ledger.push({
          investor_id: holderId,
          product_id: product.productId,
          market_id: input.marketId,
          entry_type: "reserve_hold",
          amount: reserveHeld,
          note: `Reserve ${pct}% held against late returns ${label}`,
        });
      }
    }
  }

  return { statements, ledger, carriedLossAfter, netProfitByProduct };
}
