import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProfitability } from "@/lib/profitability-permissions";
import { calculateProductProfitability } from "@/lib/calculations/product-profitability";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const CONFIRMED_STATUSES = ["confirmed", "uploaded"] as const;

export interface BulkProductMetrics {
  product_id: string;
  total_leads: number;
  confirmation_rate: number;
  delivery_rate: number;
  return_rate: number;
  revenue: number;
  simplified_net_profit: number;
  margin_pct: number;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = todayISO();
  const fromDate = req.nextUrl.searchParams.get("from_date") ?? today;
  const toDate = req.nextUrl.searchParams.get("to_date") ?? today;
  const toDateEnd = toDate + "T23:59:59.999Z";

  let marketId: string;
  if (actor.role === "super_admin") {
    const paramMarketId = req.nextUrl.searchParams.get("market_id");
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    marketId = actor.market_id!;
  }

  // Fetch market currency
  const { data: market } = await supabase
    .from("markets")
    .select("currency")
    .eq("id", marketId)
    .single();
  const currency = (market as { currency?: string } | null)?.currency ?? "TND";

  // Fetch all products for this market (cost inputs needed for calculation)
  const { data: products } = await supabase
    .from("products")
    .select("id, unit_cogs, packing_cost, confirmation_processing_cost")
    .eq("market_id", marketId);

  if (!products || products.length === 0) {
    return NextResponse.json({ data: [], currency });
  }

  const productIds = products.map((p: { id: string }) => p.id);

  type OrderRow = { product_id: string };
  type ConfirmedOrderRow = { order_id: string; orders: OrderRow };
  type DeliveredOrder = { product_id: string; total_price: number; quantity: number; carriers: { delivery_fee: number } | null };
  type ReturnedOrder = { product_id: string; carriers: { return_fee: number } | null };

  type AdSpendRow = { product_id: string; amount: number | string };

  const [leadsRows, confirmedRows, dispatchedRows, deliveredRows, returnedRows, adSpendRows] = await Promise.all([
    fetchAllRows<OrderRow>(
      supabase
        .from("orders")
        .select("product_id")
        .in("product_id", productIds)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
    fetchAllRows<ConfirmedOrderRow>(
      supabase
        .from("order_history")
        .select("order_id, orders!inner(product_id)")
        .in("status_to", CONFIRMED_STATUSES)
        .in("orders.product_id", productIds)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
    fetchAllRows<{ orders: OrderRow }>(
      supabase
        .from("order_history")
        .select("orders!inner(product_id)")
        .eq("status_to", "uploaded")
        .in("orders.product_id", productIds)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
    fetchAllRows<{ orders: DeliveredOrder }>(
      supabase
        .from("order_history")
        .select("orders!inner(product_id, total_price, quantity, carriers!orders_carrier_id_fkey(delivery_fee))")
        .eq("status_to", "delivered")
        .in("orders.product_id", productIds)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
    fetchAllRows<{ orders: ReturnedOrder }>(
      supabase
        .from("order_history")
        .select("orders!inner(product_id, carriers!orders_carrier_id_fkey(return_fee))")
        .eq("status_to", "returned")
        .in("orders.product_id", productIds)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
    fetchAllRows<AdSpendRow>(
      supabase
        .from("ad_spend")
        .select("product_id, amount")
        .in("product_id", productIds)
        .eq("is_active", true)
        .lte("period_start", toDate)
        .gte("period_end", fromDate)
    ),
  ]);

  const adSpendByProduct = new Map<string, number>();
  for (const row of adSpendRows) {
    if (!row.product_id) continue;
    adSpendByProduct.set(
      row.product_id,
      (adSpendByProduct.get(row.product_id) ?? 0) + Number(row.amount)
    );
  }

  // Build per-product aggregate maps
  const leadCount = new Map<string, number>();
  const confirmedOrderIds = new Map<string, Set<string>>();
  const dispatchedCount = new Map<string, number>();
  const deliveredByProduct = new Map<string, { total_price: number; quantity: number; carrier_delivery_fee: number }[]>();
  const returnedByProduct = new Map<string, { carrier_return_fee: number }[]>();

  for (const row of leadsRows) {
    leadCount.set(row.product_id, (leadCount.get(row.product_id) ?? 0) + 1);
  }

  for (const row of confirmedRows) {
    const pid = row.orders?.product_id;
    if (pid && row.order_id) {
      const ids = confirmedOrderIds.get(pid) ?? new Set<string>();
      ids.add(row.order_id);
      confirmedOrderIds.set(pid, ids);
    }
  }

  for (const row of dispatchedRows) {
    const pid = row.orders?.product_id;
    if (pid) dispatchedCount.set(pid, (dispatchedCount.get(pid) ?? 0) + 1);
  }

  for (const row of deliveredRows) {
    const o = row.orders;
    if (!o?.product_id) continue;
    const arr = deliveredByProduct.get(o.product_id) ?? [];
    arr.push({
      total_price: Number(o.total_price),
      quantity: Number(o.quantity),
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
    });
    deliveredByProduct.set(o.product_id, arr);
  }

  for (const row of returnedRows) {
    const o = row.orders;
    if (!o?.product_id) continue;
    const arr = returnedByProduct.get(o.product_id) ?? [];
    arr.push({ carrier_return_fee: Number(o.carriers?.return_fee ?? 0) });
    returnedByProduct.set(o.product_id, arr);
  }

  // Compute metrics per product
  const data: BulkProductMetrics[] = products.map((p: {
    id: string;
    unit_cogs: number;
    packing_cost: number;
    confirmation_processing_cost: number | null;
  }) => {
    const result = calculateProductProfitability({
      totalLeads: leadCount.get(p.id) ?? 0,
      confirmedCount: confirmedOrderIds.get(p.id)?.size ?? 0,
      dispatchedCount: dispatchedCount.get(p.id) ?? 0,
      deliveredCount: (deliveredByProduct.get(p.id) ?? []).length,
      returnedCount: (returnedByProduct.get(p.id) ?? []).length,
      unitCogs: Number(p.unit_cogs),
      packingCost: Number(p.packing_cost),
      adSpend: adSpendByProduct.get(p.id) ?? 0,
      confirmationProcessingCost: Number(p.confirmation_processing_cost ?? 0),
      deliveredOrders: deliveredByProduct.get(p.id) ?? [],
      returnedOrders: returnedByProduct.get(p.id) ?? [],
    });

    const marginPct =
      result.revenue === 0
        ? 0
        : Math.round((result.simplifiedNetProfit / result.revenue) * 1000) / 10;

    return {
      product_id: p.id,
      total_leads: result.totalLeads,
      confirmation_rate: result.confirmationRate,
      delivery_rate: result.deliveryRate,
      return_rate: result.returnRate,
      revenue: result.revenue,
      simplified_net_profit: result.simplifiedNetProfit,
      margin_pct: marginPct,
    };
  });

  return NextResponse.json({ data, currency });
}
