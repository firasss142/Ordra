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
  calculateProcessingCost,
  calculateCostPerDelivered,
  calculateDeliveryRate,
  calculateReturnRate,
} from "@/lib/calculations/profitability";
import { calculateConfirmationRate } from "@/lib/metrics";

const CONFIRMED_STATUSES = ["confirmed", "uploaded"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await params;
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

  // Fetch product info
  const { data: product } = await supabase
    .from("products")
    .select("id, name, unit_cogs, packing_cost, confirmation_processing_cost, market_id")
    .eq("id", productId)
    .single();

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const unitCogs = Number(product.unit_cogs);
  const packingCostPerOrder = Number(product.packing_cost);
  const processingCostPerOrder = Number(product.confirmation_processing_cost ?? 0);

  // --- Ad spend rows scoped to this product, overlapping the period ---
  const { data: adSpendRows } = await supabase
    .from("ad_spend")
    .select("amount")
    .eq("product_id", productId)
    .eq("is_active", true)
    .lte("period_start", toDate)
    .gte("period_end", fromDate);

  const adSpend = (adSpendRows ?? []).reduce(
    (sum, r) => sum + Number((r as { amount: number | string }).amount),
    0
  );

  // --- Delivered orders for this product in period ---
  const { data: deliveredHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, total_price, quantity, carrier_id, product_id)")
    .eq("status_to", "delivered")
    .eq("orders.product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const deliveredOrders = (deliveredHistory ?? []).map((h) => {
    const o = h.orders as unknown as {
      id: string; total_price: number; quantity: number; carrier_id: string | null;
    };
    return o;
  });

  // --- Returned orders for this product in period ---
  const { data: returnedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, carrier_id, product_id)")
    .eq("status_to", "returned")
    .eq("orders.product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const returnedOrders = (returnedHistory ?? []).map((h) => {
    const o = h.orders as unknown as { id: string; carrier_id: string | null };
    return o;
  });

  // --- Confirmed orders for this product in period ---
  const { data: confirmedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, product_id)")
    .in("status_to", CONFIRMED_STATUSES)
    .eq("orders.product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const confirmedCount = new Set(
    (confirmedHistory ?? []).map((row) => row.order_id).filter(Boolean)
  ).size;

  // --- Rejected orders for this product in period ---
  const { data: rejectedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, product_id)")
    .eq("status_to", "rejected")
    .eq("orders.product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const rejectedCount = (rejectedHistory ?? []).length;

  // --- Uploaded (= pushed to carrier) orders for this product in period ---
  const { data: dispatchedHistory } = await supabase
    .from("order_history")
    .select("order_id, orders!inner(id, product_id)")
    .eq("status_to", "uploaded")
    .eq("orders.product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  const dispatchedCount = (dispatchedHistory ?? []).length;

  // --- Total leads (orders received in period for this product) ---
  const { count: totalLeads } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .gte("created_at", fromDate)
    .lte("created_at", toDate);

  // --- Fetch carriers for fee lookup ---
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
        .eq("market_id", product.market_id)
    : { data: [] };

  const carrierMap = new Map(
    (carriers ?? []).map((c) => [c.id, { delivery_fee: Number(c.delivery_fee), return_fee: Number(c.return_fee) }])
  );

  // --- Calculate metrics ---
  const revenue = calculateRevenue(
    deliveredOrders.map((o) => ({ total_price: Number(o.total_price) }))
  );

  const cogs = calculateCogs(
    deliveredOrders.map((o) => ({ unit_cogs: unitCogs, quantity: o.quantity }))
  );

  // Delivery cost per-carrier
  const deliveryCarrierCounts = new Map<string, number>();
  for (const o of deliveredOrders) {
    if (o.carrier_id) {
      deliveryCarrierCounts.set(o.carrier_id, (deliveryCarrierCounts.get(o.carrier_id) ?? 0) + 1);
    }
  }
  const deliveryCost = calculateDeliveryCost(
    Array.from(deliveryCarrierCounts.entries()).map(([cid, count]) => ({
      count,
      delivery_fee: carrierMap.get(cid)?.delivery_fee ?? 0,
    }))
  );

  // Return cost per-carrier
  const returnCarrierCounts = new Map<string, number>();
  for (const o of returnedOrders) {
    if (o.carrier_id) {
      returnCarrierCounts.set(o.carrier_id, (returnCarrierCounts.get(o.carrier_id) ?? 0) + 1);
    }
  }
  const returnCost = calculateReturnCost(
    Array.from(returnCarrierCounts.entries()).map(([cid, count]) => ({
      count,
      return_fee: carrierMap.get(cid)?.return_fee ?? 0,
    }))
  );

  const packingCost = calculatePackingCost(
    Array.from({ length: confirmedCount }, () => ({ packing_cost: packingCostPerOrder }))
  );

  const processingCost = calculateProcessingCost(processingCostPerOrder, confirmedCount);

  const totalCosts = cogs + deliveryCost + returnCost + packingCost + adSpend + processingCost;

  const netProfit = calculateNetProfit({
    revenue,
    cogs,
    deliveryCost,
    returnCost,
    packingCost,
    adSpend: adSpend + processingCost,
  });

  const deliveredCount = deliveredOrders.length;
  const returnedCount = returnedOrders.length;
  const actionedCount = confirmedCount + rejectedCount;

  return NextResponse.json({
    data: {
      product_name: product.name,
      revenue,
      cogs,
      delivery_cost: deliveryCost,
      return_cost: returnCost,
      packing_cost: packingCost,
      ad_spend: adSpend,
      processing_cost: processingCost,
      total_costs: totalCosts,
      net_profit: netProfit,
      margin: calculateMargin(netProfit, revenue),
      cost_per_delivered: calculateCostPerDelivered(totalCosts, deliveredCount),
      confirmation_rate: calculateConfirmationRate(confirmedCount, actionedCount),
      delivery_rate: calculateDeliveryRate(deliveredCount, dispatchedCount),
      return_rate: calculateReturnRate(returnedCount, deliveredCount + returnedCount),
      delivered_count: deliveredCount,
      returned_count: returnedCount,
      confirmed_count: confirmedCount,
      rejected_count: rejectedCount,
      dispatched_count: dispatchedCount,
      total_leads: totalLeads ?? 0,
    },
  });
}
