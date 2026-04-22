import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  calculateRevenue,
  calculateCogs,
  calculateDeliveryCost,
  calculateReturnCost,
  calculatePackingCost,
  calculateNetProfit,
  calculateMargin,
} from "@/lib/calculations/profitability";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required" },
      { status: 400 }
    );
  }

  let marketId: string;
  if (role === "super_admin") {
    const paramMarketId = req.nextUrl.searchParams.get("market_id");
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    marketId = actor.market_id ?? "";
  }

  // --- Delivered orders in period (via order_history) ---
  const { data: deliveredHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, total_price, quantity, product_id, carrier_id, market_id)")
    .eq("status_to", "delivered")
    .eq("orders.market_id", marketId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const deliveredOrders = (deliveredHistory ?? []).map((h) => {
    const o = h.orders as unknown as {
      id: string;
      total_price: number;
      quantity: number;
      product_id: string | null;
      carrier_id: string | null;
    };
    return o;
  });

  // --- Returned orders in period ---
  const { data: returnedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, carrier_id, market_id)")
    .eq("status_to", "returned")
    .eq("orders.market_id", marketId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const returnedOrders = (returnedHistory ?? []).map((h) => {
    const o = h.orders as unknown as { id: string; carrier_id: string | null };
    return o;
  });

  // --- Confirmed orders in period (for packing cost) ---
  const { data: confirmedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, product_id, market_id)")
    .eq("status_to", "confirmed")
    .eq("orders.market_id", marketId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const confirmedOrderProductIds = (confirmedHistory ?? []).map((h) => {
    const o = h.orders as unknown as { id: string; product_id: string | null };
    return o.product_id;
  }).filter((pid): pid is string => pid !== null);

  // --- Fetch products for COGS + packing cost ---
  const allProductIds = new Set<string>();
  for (const o of deliveredOrders) {
    if (o.product_id) allProductIds.add(o.product_id);
  }
  for (const pid of confirmedOrderProductIds) {
    allProductIds.add(pid);
  }

  const productIds = Array.from(allProductIds);
  const { data: products } = productIds.length > 0
    ? await supabase
        .from("products")
        .select("id, unit_cogs, packing_cost")
        .in("id", productIds)
    : { data: [] };

  const productMap = new Map(
    (products ?? []).map((p) => [p.id, { unit_cogs: Number(p.unit_cogs), packing_cost: Number(p.packing_cost) }])
  );

  // --- Fetch carriers for delivery/return fees ---
  const allCarrierIds = new Set<string>();
  for (const o of deliveredOrders) {
    if (o.carrier_id) allCarrierIds.add(o.carrier_id);
  }
  for (const o of returnedOrders) {
    if (o.carrier_id) allCarrierIds.add(o.carrier_id);
  }

  const carrierIds = Array.from(allCarrierIds);
  const { data: carriers } = carrierIds.length > 0
    ? await supabase
        .from("carriers")
        .select("id, delivery_fee, return_fee")
        .in("id", carrierIds)
    : { data: [] };

  const carrierMap = new Map(
    (carriers ?? []).map((c) => [c.id, { delivery_fee: Number(c.delivery_fee), return_fee: Number(c.return_fee) }])
  );

  // --- Calculate revenue ---
  const revenue = calculateRevenue(
    deliveredOrders.map((o) => ({ total_price: Number(o.total_price) }))
  );

  // --- Calculate COGS ---
  const cogs = calculateCogs(
    deliveredOrders
      .filter((o) => o.product_id && productMap.has(o.product_id))
      .map((o) => ({
        unit_cogs: productMap.get(o.product_id!)!.unit_cogs,
        quantity: o.quantity,
      }))
  );

  // --- Calculate delivery cost (per-carrier groups) ---
  const deliveryCarrierCounts = new Map<string, number>();
  for (const o of deliveredOrders) {
    if (o.carrier_id) {
      deliveryCarrierCounts.set(o.carrier_id, (deliveryCarrierCounts.get(o.carrier_id) ?? 0) + 1);
    }
  }
  const deliveryCost = calculateDeliveryCost(
    Array.from(deliveryCarrierCounts.entries()).map(([carrierId, count]) => ({
      count,
      delivery_fee: carrierMap.get(carrierId)?.delivery_fee ?? 0,
    }))
  );

  // --- Calculate return cost (per-carrier groups) ---
  const returnCarrierCounts = new Map<string, number>();
  for (const o of returnedOrders) {
    if (o.carrier_id) {
      returnCarrierCounts.set(o.carrier_id, (returnCarrierCounts.get(o.carrier_id) ?? 0) + 1);
    }
  }
  const returnCost = calculateReturnCost(
    Array.from(returnCarrierCounts.entries()).map(([carrierId, count]) => ({
      count,
      return_fee: carrierMap.get(carrierId)?.return_fee ?? 0,
    }))
  );

  // --- Calculate packing cost ---
  const packingCost = calculatePackingCost(
    confirmedOrderProductIds
      .filter((pid) => productMap.has(pid))
      .map((pid) => ({ packing_cost: productMap.get(pid)!.packing_cost }))
  );

  // --- Ad spend (market-wide, product_id IS NULL) ---
  const { data: adSpendRows } = await supabase
    .from("ad_spend")
    .select("amount")
    .eq("market_id", marketId)
    .is("product_id", null)
    .eq("is_active", true)
    .lte("period_start", toDate)
    .gte("period_end", fromDate);

  const adSpend = (adSpendRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  // --- Net profit + margin ---
  const netProfit = calculateNetProfit({
    revenue,
    cogs,
    deliveryCost,
    returnCost,
    packingCost,
    adSpend,
  });
  const margin = calculateMargin(netProfit, revenue);

  // --- Counts for context ---
  const deliveredCount = deliveredOrders.length;
  const returnedCount = returnedOrders.length;
  const confirmedCount = confirmedOrderProductIds.length;

  return NextResponse.json({
    data: {
      revenue,
      cogs,
      delivery_cost: deliveryCost,
      return_cost: returnCost,
      packing_cost: packingCost,
      ad_spend: adSpend,
      net_profit: netProfit,
      margin,
      delivered_count: deliveredCount,
      returned_count: returnedCount,
      confirmed_count: confirmedCount,
    },
  });
}
