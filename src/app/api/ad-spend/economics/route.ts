import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeBreakEven, marginPerLead } from "@/lib/ad-spend/break-even";
import { withRouteErrors } from "@/lib/journal/route-errors";

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
 * Campaign identity (20260906000001) and ad-set identity (20260930225232) live
 * in columns a database may not have taken yet. PostgREST answers an unknown
 * column with 42703 rather than ignoring it, so asking for them unconditionally
 * would take the whole page down on an un-migrated database. Ask for the most,
 * fall back tier by tier.
 */
const SPEND_COLUMNS_ADSET =
  "id, product_id, amount, period_start, period_end, note, campaign_name, source, external_campaign_id, ad_account_id, external_adset_id, adset_name, platform_results, allocation_basis";
const SPEND_COLUMNS_RICH =
  "id, product_id, amount, period_start, period_end, note, campaign_name, source, external_campaign_id";
const SPEND_COLUMNS_BASE = "id, product_id, amount, period_start, period_end, note";

interface OrderRow {
  id: string;
  product_id: string | null;
  status: string;
  created_at: string | null;
  total_price: number | string | null;
  quantity: number | null;
}

/**
 * What the carrier charged for one order (order_delivery_cost): Darb's invoice of
 * the delivered parcel, else the quote recorded at upload, else null; a failed
 * Darb parcel costs 0. Tunisia's carriers keep their flat fees until they send
 * invoices. The flat carriers.delivery_fee / return_fee are no longer read here
 * (owner, 2026-10-03: "use the invoices", every Darb figure).
 */
interface CostRow {
  order_id: string;
  invoiced: boolean | null;
  delivery_cost: number | string | null;
  return_cost: number | string | null;
}

interface ProductRow {
  id: string;
  name: string;
  image_url: string | null;
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
  ad_account_id?: string | null;
  external_adset_id?: string | null;
  adset_name?: string | null;
  platform_results?: number | null;
  allocation_basis?: string | null;
}

/**
 * Synced spend under a product (or the unmapped row), one line per campaign.
 *
 * Replaces the per-row list, which showed one line per DAY — 51 of them for a
 * single campaign — each with a "CPL" dividing a day's spend by the window's
 * leads. Leads cannot be attributed below the product (no order carries a
 * campaign), so a line carries spend, its share, and Meta's own purchase count.
 */
export interface CampaignSpend {
  campaign_id: string;
  ad_account_id: string | null;
  campaign_name: string | null;
  /** Charged to this product (or left unattributed) over the window. */
  amount: number;
  /** Fraction of the campaign's window spend this line carries; null when all of it. */
  share: number | null;
  /** How the campaign is split, when it is. */
  split: "auto" | "manual" | null;
  /** Meta-reported purchases, split the same way as the money. */
  results: number;
  adsets: { adset_id: string; adset_name: string | null; amount: number; results: number }[];
}

/** One `ad_spend` row a person entered (manual or CSV), under its product. */
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

async function handleGET(req: NextRequest) {
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
    for (const columns of [SPEND_COLUMNS_ADSET, SPEND_COLUMNS_RICH]) {
      try {
        return await fetchAllRows<SpendRow>(spendQuery(columns));
      } catch {
        // 42703 on a column this database has not taken yet — try the next tier.
      }
    }
    return await fetchAllRows<SpendRow>(spendQuery(SPEND_COLUMNS_BASE));
  };

  const [orders, products, spend, costs, avgInvoice] = await Promise.all([
    fetchAllRows<OrderRow>(
      supabase
        .from("orders")
        .select("id, product_id, status, created_at, total_price, quantity")
        .eq("market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", `${toDate}T23:59:59`)
        .order("id", { ascending: true }),
    ),
    fetchAllRows<ProductRow>(
      supabase
        .from("products")
        .select("id, name, image_url, unit_cogs, packing_cost, confirmation_processing_cost")
        .eq("market_id", marketId)
        .order("id", { ascending: true }),
    ),
    loadSpend(),
    fetchAllRows<CostRow>(
      supabase
        .from("order_delivery_cost")
        .select("order_id, invoiced, delivery_cost, return_cost")
        .eq("market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", `${toDate}T23:59:59`)
        .order("order_id", { ascending: true }),
    ),
    // The fallback for a delivered Darb parcel with neither invoice nor quote.
    supabase.rpc("market_avg_delivery_cost", { p_market_id: marketId }),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const costByOrder = new Map(costs.map((c) => [c.order_id, c]));
  const averageInvoice = Number((avgInvoice as { data: unknown }).data) || 0;
  const deliveryCostOf = (orderId: string): number => {
    const c = costByOrder.get(orderId);
    if (!c) return 0;
    if (c.delivery_cost !== null && c.delivery_cost !== undefined) return Number(c.delivery_cost) || 0;
    return c.invoiced ? averageInvoice : 0;
  };
  const returnCostOf = (orderId: string): number => Number(costByOrder.get(orderId)?.return_cost) || 0;

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
        // What the carrier charged THIS order: Darb's invoice, never a flat fee.
        t.deliveryFeeTotal += deliveryCostOf(o.id);
      }
      if (o.status === "returned") {
        t.returned += 1;
        // A failed Darb parcel costs nothing; Tunisia's flat return fee stays.
        t.returnFeeTotal += returnCostOf(o.id);
      }
    };
    bump(b);
    bump(market);
  }

  const spendByProduct = new Map<string, number>();
  const entriesByProduct = new Map<string, SpendEntry[]>();
  const unmappedEntries: SpendEntry[] = [];
  let marketLevelSpend = 0;
  let allSpend = 0;

  // Synced rows are grouped per (product | unmapped) × campaign × ad set. A
  // campaign's window total is kept apart so each line can say what share of
  // the campaign it carries.
  const UNMAPPED = "__unmapped";
  const campaignTotals = new Map<string, number>();
  const campaignLines = new Map<string, Map<string, {
    line: CampaignSpend;
    modes: Set<string>;
    adsets: Map<string, CampaignSpend["adsets"][number]>;
  }>>();

  for (const s of spend) {
    const amount = Number(s.amount) || 0;
    allSpend += amount;
    if (s.product_id) spendByProduct.set(s.product_id, (spendByProduct.get(s.product_id) ?? 0) + amount);
    else marketLevelSpend += amount;

    if (s.source === "meta" && s.external_campaign_id) {
      const cid = s.external_campaign_id;
      campaignTotals.set(cid, (campaignTotals.get(cid) ?? 0) + amount);
      const owner = s.product_id ?? UNMAPPED;
      let byCampaign = campaignLines.get(owner);
      if (!byCampaign) campaignLines.set(owner, (byCampaign = new Map()));
      let acc = byCampaign.get(cid);
      if (!acc) {
        acc = {
          line: {
            campaign_id: cid,
            ad_account_id: s.ad_account_id ?? null,
            campaign_name: s.campaign_name ?? null,
            amount: 0,
            share: null,
            split: null,
            results: 0,
            adsets: [],
          },
          modes: new Set(),
          adsets: new Map(),
        };
        byCampaign.set(cid, acc);
      }
      const results = Number(s.platform_results) || 0;
      acc.line.amount += amount;
      acc.line.results += results;
      if (s.allocation_basis) acc.modes.add(s.allocation_basis);
      if (s.external_adset_id) {
        let a = acc.adsets.get(s.external_adset_id);
        if (!a) {
          a = { adset_id: s.external_adset_id, adset_name: s.adset_name ?? null, amount: 0, results: 0 };
          acc.adsets.set(s.external_adset_id, a);
        }
        a.amount += amount;
        a.results += results;
      }
      continue;
    }

    const entry = toEntry(s);
    if (s.product_id) {
      const list = entriesByProduct.get(s.product_id);
      if (list) list.push(entry);
      else entriesByProduct.set(s.product_id, [entry]);
    } else {
      unmappedEntries.push(entry);
    }
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const campaignsOf = (owner: string): CampaignSpend[] =>
    [...(campaignLines.get(owner)?.values() ?? [])]
      .map(({ line, modes, adsets }) => {
        const total = campaignTotals.get(line.campaign_id) ?? 0;
        const share = total > 0 ? line.amount / total : 1;
        return {
          ...line,
          amount: round3(line.amount),
          // Within half a thousandth of the whole is the whole — rounding, not a split.
          share: share >= 0.9995 ? null : share,
          split: modes.has("manual") ? ("manual" as const) : [...modes].some((m) => m.startsWith("auto")) ? ("auto" as const) : null,
          adsets: [...adsets.values()]
            .map((a) => ({ ...a, amount: round3(a.amount) }))
            .sort((x, y) => y.amount - x.amount),
        };
      })
      .sort((x, y) => y.amount - x.amount);

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
        // Effective fees, from what the carriers actually charged per order.
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
        product_image_url: p.image_url ?? null,
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
        campaigns: campaignsOf(productId),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // Products with attributed spend first. A product with none has a margin
    // equal to its whole floor, which would otherwise sort it to the top and
    // present "we do not know what this costs" as the best performer on the
    // page. Within each group, best margin first.
    .sort(
      (a, b) =>
        Number(b.spend > 0) - Number(a.spend > 0) || b.margin_per_lead - a.margin_per_lead,
    );

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);

  const costCogs = sum((r) => r.cost_cogs);
  const costDelivery = sum((r) => r.cost_delivery);
  const costReturns = sum((r) => r.cost_returns);
  const costPacking = sum((r) => r.cost_packing);
  const costProcessing = sum((r) => r.cost_processing);

  // Every row, not the sum of the product rows: a product that took no lead in
  // the window has no row, yet a split may have charged it — that money was
  // still spent, and leaving it out would overstate profit.
  const totalSpend = allSpend;
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
      // Products that took leads in this window but carry no attributed spend.
      // Usually a campaign nobody has mapped, or a window the sync has not
      // reached back to — either way their margin is unknowable, not excellent.
      products_without_spend: rows.filter((r) => r.spend === 0).length,
      maturity_pct: market.leads > 0 ? market.terminal / market.leads : 0,
      unmapped: {
        spend: marketLevelSpend,
        entries: unmappedEntries,
        campaigns: campaignsOf(UNMAPPED),
      },
      from_date: fromDate,
      to_date: toDate,
    },
  });
}

export const GET = withRouteErrors("/api/ad-spend/economics", "GET", handleGET);
