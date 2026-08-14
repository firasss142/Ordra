import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeBreakEven, marginPerLead } from "@/lib/ad-spend/break-even";

/**
 * Per-product acquisition economics for a cohort.
 *
 * The question this answers is the one the old page could not: not "how much
 * did we spend" but "can this product afford what we are paying for its leads".
 * Those are different questions because the break-even cost per lead is a
 * property of the PRODUCT, not the market — it falls out of that product's own
 * delivery rate, return rate, margin and carrier fees. On real Libya data the
 * floors range from 15.41 to 35.50 LYD, a 2.3x spread, which is why a single
 * blended CPL target is worse than none.
 *
 * Cohort basis, deliberately: leads are orders CREATED in the window, and their
 * outcomes are counted wherever they eventually landed. That matches how the
 * money was actually spent — you paid for the lead on the day it arrived — and
 * it is why the numbers here do not tie to the event-windowed P&L, which asks a
 * different question about the same orders. `maturityPct` says how far the
 * cohort has resolved, so a young window reads as unfinished rather than bad.
 */

export const dynamic = "force-dynamic";

const TERMINAL = ["delivered", "returned", "rejected", "cancelled", "deleted"];
const CONFIRMED_PHASE = [
  "confirmed",
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
];

/**
 * Campaign identity lives in columns added by 20260906000001, which production
 * has not taken yet. PostgREST answers an unknown column with 42703 rather than
 * ignoring it, so asking for them unconditionally would take the whole page
 * down on an un-migrated database. Ask for them, fall back without them.
 */
const SPEND_COLUMNS_RICH =
  "id, product_id, amount, period_start, period_end, note, campaign_name, source, external_campaign_id";
const SPEND_COLUMNS_BASE = "id, product_id, amount, period_start, period_end, note";

interface OrderRow {
  product_id: string | null;
  status: string;
  created_at: string | null;
  total_price: number | string | null;
  quantity: number | null;
  carriers: { delivery_fee: number | string; return_fee: number | string } | null;
}

interface ProductRow {
  id: string;
  name: string;
  unit_cogs: number | string;
  packing_cost: number | string | null;
  confirmation_processing_cost: number | string | null;
}

interface SpendRow {
  id: string;
  product_id: string | null;
  amount: number | string;
  period_start: string;
  period_end: string;
  note: string | null;
  campaign_name?: string | null;
  source?: string | null;
  external_campaign_id?: string | null;
}

/** One `ad_spend` row, as the campaign sub-row under a product. */
export interface SpendEntry {
  id: string;
  label: string | null;
  campaign_id: string | null;
  source: string;
  amount: number;
  period_start: string;
  period_end: string;
  /** Synced rows are overwritten by the next sync, so editing one is a lie. */
  editable: boolean;
}

function toEntry(s: SpendRow): SpendEntry {
  const source = s.source ?? "manual";
  return {
    id: s.id,
    label: s.campaign_name ?? s.note ?? null,
    campaign_id: s.external_campaign_id ?? null,
    source,
    amount: Number(s.amount) || 0,
    period_start: s.period_start,
    period_end: s.period_end,
    editable: source === "manual" || source === "csv",
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : (actor.market_id ?? null);

  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "from_date and to_date are required" }, { status: 400 });
  }

  const spendQuery = (columns: string) =>
    supabase
      .from("ad_spend")
      .select(columns)
      .eq("market_id", marketId)
      .eq("is_active", true)
      .lte("period_start", toDate)
      .gte("period_end", fromDate)
      .order("id", { ascending: true });

  const loadSpend = async (): Promise<SpendRow[]> => {
    try {
      return await fetchAllRows<SpendRow>(spendQuery(SPEND_COLUMNS_RICH));
    } catch {
      return await fetchAllRows<SpendRow>(spendQuery(SPEND_COLUMNS_BASE));
    }
  };

  const [orders, products, spend] = await Promise.all([
    fetchAllRows<OrderRow>(
      supabase
        .from("orders")
        .select(
          "product_id, status, created_at, total_price, quantity, carriers!orders_carrier_id_fkey(delivery_fee, return_fee)",
        )
        .eq("market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", `${toDate}T23:59:59`)
        .order("id", { ascending: true }),
    ),
    fetchAllRows<ProductRow>(
      supabase
        .from("products")
        .select("id, name, unit_cogs, packing_cost, confirmation_processing_cost")
        .eq("market_id", marketId)
        .order("id", { ascending: true }),
    ),
    loadSpend(),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));

  interface Bucket {
    leads: number;
    confirmed: number;
    delivered: number;
    returned: number;
    terminal: number;
    revenue: number;
    units: number;
    deliveryFeeTotal: number;
    returnFeeTotal: number;
    /** ISO day → leads created that day, for the sparkline. */
    byDay: Map<string, number>;
  }
  const empty = (): Bucket => ({
    leads: 0,
    confirmed: 0,
    delivered: 0,
    returned: 0,
    terminal: 0,
    revenue: 0,
    units: 0,
    deliveryFeeTotal: 0,
    returnFeeTotal: 0,
    byDay: new Map(),
  });

  const buckets = new Map<string, Bucket>();
  const market = empty();

  for (const o of orders) {
    if (!o.product_id) continue;
    let b = buckets.get(o.product_id);
    if (!b) {
      b = empty();
      buckets.set(o.product_id, b);
    }
    const day = o.created_at ? o.created_at.slice(0, 10) : null;
    const bump = (t: Bucket) => {
      t.leads += 1;
      if (day) t.byDay.set(day, (t.byDay.get(day) ?? 0) + 1);
      if (CONFIRMED_PHASE.includes(o.status)) t.confirmed += 1;
      if (TERMINAL.includes(o.status)) t.terminal += 1;
      if (o.status === "delivered") {
        t.delivered += 1;
        t.revenue += Number(o.total_price) || 0;
        t.units += Number(o.quantity) || 1;
        // Blended, not assumed: carriers differ per order and an inactive one
        // still priced the orders it carried.
        t.deliveryFeeTotal += Number(o.carriers?.delivery_fee) || 0;
      }
      if (o.status === "returned") {
        t.returned += 1;
        t.returnFeeTotal += Number(o.carriers?.return_fee) || 0;
      }
    };
    bump(b);
    bump(market);
  }

  const spendByProduct = new Map<string, number>();
  const entriesByProduct = new Map<string, SpendEntry[]>();
  const unmappedEntries: SpendEntry[] = [];
  let marketLevelSpend = 0;

  for (const s of spend) {
    const entry = toEntry(s);
    if (s.product_id) {
      spendByProduct.set(s.product_id, (spendByProduct.get(s.product_id) ?? 0) + entry.amount);
      const list = entriesByProduct.get(s.product_id);
      if (list) list.push(entry);
      else entriesByProduct.set(s.product_id, [entry]);
    } else {
      marketLevelSpend += entry.amount;
      unmappedEntries.push(entry);
    }
  }

  /** Days with at least one lead, chronologically — the sparkline's x-axis. */
  const sparkline = (byDay: Map<string, number>): number[] =>
    [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, n]) => n);

  const rows = [...buckets.entries()]
    .map(([productId, b]) => {
      const p = productById.get(productId);
      if (!p || b.leads === 0) return null;

      const deliveryRate = b.delivered / b.leads;
      const confirmRate = b.confirmed / b.leads;
      const returnRate = b.returned / b.leads;
      const aov = b.delivered > 0 ? b.revenue / b.delivered : 0;
      const unitsPerDelivered = b.delivered > 0 ? b.units / b.delivered : 1;

      const unitCogs = Number(p.unit_cogs) || 0;
      const packingCost = Number(p.packing_cost) || 0;
      const processingCost = Number(p.confirmation_processing_cost) || 0;
      const deliveryFee = b.delivered > 0 ? b.deliveryFeeTotal / b.delivered : 0;
      const returnFee = b.returned > 0 ? b.returnFeeTotal / b.returned : 0;

      const breakEven = computeBreakEven({
        aov,
        unitCogs,
        unitsPerDelivered,
        // Effective blended fees, derived from what the carriers actually charged.
        deliveryFee,
        returnFee,
        packingCost,
        processingCost,
        deliveryRate,
        confirmRate,
        returnRate,
      });

      const productSpend = spendByProduct.get(productId) ?? 0;
      const cpl = b.leads > 0 ? productSpend / b.leads : 0;
      const margin = marginPerLead(breakEven, cpl);

      // What a delivered order is worth once its own variable costs are paid.
      // The lever behind "point mort": at this CPL, the delivery rate that
      // would bring the cohort back to zero. Undefined when a delivered order
      // does not even cover its own COGS — no delivery rate rescues that.
      const netPerDelivered = aov - unitsPerDelivered * unitCogs - deliveryFee;
      const fixedPerLead = returnRate * returnFee + confirmRate * (packingCost + processingCost);
      const breakEvenDeliveryRate =
        netPerDelivered > 0 ? (cpl + fixedPerLead) / netPerDelivered : null;

      return {
        product_id: productId,
        product_name: p.name,
        leads: b.leads,
        confirmed: b.confirmed,
        delivered: b.delivered,
        returned: b.returned,
        revenue: b.revenue,
        aov,
        delivery_rate: deliveryRate,
        confirm_rate: confirmRate,
        return_rate: returnRate,
        maturity_pct: b.leads > 0 ? b.terminal / b.leads : 0,
        // The five non-ad cost buckets, on the same cohort. The stack chart
        // needs them named rather than lumped, because "where does the money
        // go" is the whole question that panel exists to answer.
        cost_cogs: b.units * unitCogs,
        cost_delivery: b.deliveryFeeTotal,
        cost_returns: b.returnFeeTotal,
        cost_packing: b.confirmed * packingCost,
        cost_processing: b.confirmed * processingCost,
        spend: productSpend,
        cpl,
        break_even_cpl: breakEven.cplFloor,
        break_even_cost_per_delivered: breakEven.costPerDeliveredFloor,
        break_even_roas: breakEven.roasFloor,
        break_even_delivery_rate: breakEvenDeliveryRate,
        margin_per_lead: margin,
        profit: margin * b.leads,
        roas: productSpend > 0 ? b.revenue / productSpend : null,
        daily_leads: sparkline(b.byDay),
        entries: entriesByProduct.get(productId) ?? [],
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.margin_per_lead - a.margin_per_lead);

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);

  const costCogs = sum((r) => r.cost_cogs);
  const costDelivery = sum((r) => r.cost_delivery);
  const costReturns = sum((r) => r.cost_returns);
  const costPacking = sum((r) => r.cost_packing);
  const costProcessing = sum((r) => r.cost_processing);

  const totalSpend = sum((r) => r.spend) + marketLevelSpend;
  // Summed from the named buckets rather than backed out of the rounded
  // per-lead floor, so the cost stack adds up to revenue exactly instead of
  // accumulating five separate rounding errors.
  const totalCosts =
    costCogs + costDelivery + costReturns + costPacking + costProcessing + totalSpend;

  return NextResponse.json({
    data: rows,
    meta: {
      market_level_spend: marketLevelSpend,
      total_spend: totalSpend,
      total_leads: market.leads,
      total_confirmed: market.confirmed,
      total_delivered: market.delivered,
      total_revenue: market.revenue,
      total_costs: totalCosts,
      total_profit: market.revenue - totalCosts,
      cost_cogs: costCogs,
      cost_delivery: costDelivery,
      cost_returns: costReturns,
      cost_packing: costPacking,
      cost_processing: costProcessing,
      maturity_pct: market.leads > 0 ? market.terminal / market.leads : 0,
      unmapped: {
        spend: marketLevelSpend,
        entries: unmappedEntries,
      },
      from_date: fromDate,
      to_date: toDate,
    },
  });
}
