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

interface OrderRow {
  product_id: string | null;
  status: string;
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
  product_id: string | null;
  amount: number | string;
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

  const [orders, products, spend] = await Promise.all([
    fetchAllRows<OrderRow>(
      supabase
        .from("orders")
        .select(
          "product_id, status, total_price, quantity, carriers!orders_carrier_id_fkey(delivery_fee, return_fee)",
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
    fetchAllRows<SpendRow>(
      supabase
        .from("ad_spend")
        .select("product_id, amount")
        .eq("market_id", marketId)
        .eq("is_active", true)
        .lte("period_start", toDate)
        .gte("period_end", fromDate)
        .order("id", { ascending: true }),
    ),
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
    const bump = (t: Bucket) => {
      t.leads += 1;
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
  let marketLevelSpend = 0;
  for (const s of spend) {
    const amt = Number(s.amount) || 0;
    if (s.product_id) {
      spendByProduct.set(s.product_id, (spendByProduct.get(s.product_id) ?? 0) + amt);
    } else {
      marketLevelSpend += amt;
    }
  }

  const rows = [...buckets.entries()]
    .map(([productId, b]) => {
      const p = productById.get(productId);
      if (!p || b.leads === 0) return null;

      const deliveryRate = b.delivered / b.leads;
      const confirmRate = b.confirmed / b.leads;
      const returnRate = b.returned / b.leads;
      const aov = b.delivered > 0 ? b.revenue / b.delivered : 0;
      const unitsPerDelivered = b.delivered > 0 ? b.units / b.delivered : 1;

      const breakEven = computeBreakEven({
        aov,
        unitCogs: Number(p.unit_cogs) || 0,
        unitsPerDelivered,
        // Effective blended fees, derived from what the carriers actually charged.
        deliveryFee: b.delivered > 0 ? b.deliveryFeeTotal / b.delivered : 0,
        returnFee: b.returned > 0 ? b.returnFeeTotal / b.returned : 0,
        packingCost: Number(p.packing_cost) || 0,
        processingCost: Number(p.confirmation_processing_cost) || 0,
        deliveryRate,
        confirmRate,
        returnRate,
      });

      const productSpend = spendByProduct.get(productId) ?? 0;
      const cpl = b.leads > 0 ? productSpend / b.leads : 0;
      const margin = marginPerLead(breakEven, cpl);

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
        maturity_pct: b.leads > 0 ? b.terminal / b.leads : 0,
        spend: productSpend,
        cpl,
        break_even_cpl: breakEven.cplFloor,
        break_even_cost_per_delivered: breakEven.costPerDeliveredFloor,
        break_even_roas: breakEven.roasFloor,
        margin_per_lead: margin,
        profit: margin * b.leads,
        roas: productSpend > 0 ? b.revenue / productSpend : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.margin_per_lead - a.margin_per_lead);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0) + marketLevelSpend;
  const totalCosts =
    rows.reduce((s, r) => s + (r.revenue - r.margin_per_lead * r.leads - r.spend), 0) + totalSpend;

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
      maturity_pct: market.leads > 0 ? market.terminal / market.leads : 0,
      from_date: fromDate,
      to_date: toDate,
    },
  });
}
