import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  calculateRevenue,
  calculateCogs,
  calculateDeliveryCost,
  calculateReturnCost,
  calculatePackingCost,
  calculateNetProfit,
  calculateMargin,
} from "@/lib/calculations/profitability";

export interface ProfitabilitySummary {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
  margin: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
  leads_count: number;
}

type Supa = SupabaseClient;

export async function loadProfitabilitySummary(
  supabase: Supa,
  marketId: string,
  fromDate: string,
  toDate: string,
): Promise<ProfitabilitySummary> {
  type DeliveredHistoryRow = { orders: { id: string; total_price: number; quantity: number; product_id: string | null; carrier_id: string | null } };
  type ReturnedHistoryRow = { orders: { id: string; carrier_id: string | null } };
  type ConfirmedHistoryRow = { orders: { id: string; product_id: string | null } };

  const dateLte = toDate + "T23:59:59.999Z";

  const [
    deliveredRows,
    returnedRows,
    confirmedRows,
    leadsResult,
    adSpendResult,
  ] = await Promise.all([
    fetchAllRows<DeliveredHistoryRow>(
      supabase
        .from("order_history")
        .select("order_id, orders!inner(id, total_price, quantity, product_id, carrier_id, market_id)")
        .eq("status_to", "delivered")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte)
    ),
    fetchAllRows<ReturnedHistoryRow>(
      supabase
        .from("order_history")
        .select("order_id, orders!inner(id, carrier_id, market_id)")
        .eq("status_to", "returned")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte)
    ),
    fetchAllRows<ConfirmedHistoryRow>(
      supabase
        .from("order_history")
        .select("order_id, orders!inner(id, product_id, market_id)")
        .eq("status_to", "confirmed")
        .eq("orders.market_id", marketId)
        .gte("created_at", fromDate)
        .lte("created_at", dateLte)
    ),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),
    supabase
      .from("ad_spend")
      .select("amount")
      .eq("market_id", marketId)
      .is("product_id", null)
      .eq("is_active", true)
      .lte("period_start", toDate)
      .gte("period_end", fromDate),
  ]);

  const deliveredOrders = deliveredRows.map((h) => h.orders);
  const returnedOrders = returnedRows.map((h) => h.orders);

  const confirmedOrderProductIds = confirmedRows
    .map((h) => h.orders.product_id)
    .filter((pid): pid is string => pid !== null);

  const productIdSet = new Set<string>();
  for (const o of deliveredOrders) if (o.product_id) productIdSet.add(o.product_id);
  for (const pid of confirmedOrderProductIds) productIdSet.add(pid);
  const productIds = Array.from(productIdSet);

  const carrierIdSet = new Set<string>();
  for (const o of deliveredOrders) if (o.carrier_id) carrierIdSet.add(o.carrier_id);
  for (const o of returnedOrders) if (o.carrier_id) carrierIdSet.add(o.carrier_id);
  const carrierIds = Array.from(carrierIdSet);

  const [{ data: products }, { data: carriers }] = await Promise.all([
    productIds.length > 0
      ? supabase
          .from("products")
          .select("id, unit_cogs, packing_cost")
          .in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; unit_cogs: number; packing_cost: number }[] }),
    carrierIds.length > 0
      ? supabase
          .from("carriers")
          .select("id, delivery_fee, return_fee")
          .in("id", carrierIds)
      : Promise.resolve({ data: [] as { id: string; delivery_fee: number; return_fee: number }[] }),
  ]);

  const productMap = new Map(
    (products ?? []).map((p) => [
      p.id,
      { unit_cogs: Number(p.unit_cogs), packing_cost: Number(p.packing_cost) },
    ]),
  );

  const carrierMap = new Map(
    (carriers ?? []).map((c) => [
      c.id,
      { delivery_fee: Number(c.delivery_fee), return_fee: Number(c.return_fee) },
    ]),
  );

  const revenue = calculateRevenue(
    deliveredOrders.map((o) => ({ total_price: Number(o.total_price) })),
  );

  const cogs = calculateCogs(
    deliveredOrders
      .filter((o) => o.product_id && productMap.has(o.product_id))
      .map((o) => ({
        unit_cogs: productMap.get(o.product_id!)!.unit_cogs,
        quantity: o.quantity,
      })),
  );

  const deliveryCarrierCounts = new Map<string, number>();
  for (const o of deliveredOrders) {
    if (o.carrier_id) {
      deliveryCarrierCounts.set(
        o.carrier_id,
        (deliveryCarrierCounts.get(o.carrier_id) ?? 0) + 1,
      );
    }
  }
  const deliveryCost = calculateDeliveryCost(
    Array.from(deliveryCarrierCounts.entries()).map(([carrierId, count]) => ({
      count,
      delivery_fee: carrierMap.get(carrierId)?.delivery_fee ?? 0,
    })),
  );

  const returnCarrierCounts = new Map<string, number>();
  for (const o of returnedOrders) {
    if (o.carrier_id) {
      returnCarrierCounts.set(
        o.carrier_id,
        (returnCarrierCounts.get(o.carrier_id) ?? 0) + 1,
      );
    }
  }
  const returnCost = calculateReturnCost(
    Array.from(returnCarrierCounts.entries()).map(([carrierId, count]) => ({
      count,
      return_fee: carrierMap.get(carrierId)?.return_fee ?? 0,
    })),
  );

  const packingCost = calculatePackingCost(
    confirmedOrderProductIds
      .filter((pid) => productMap.has(pid))
      .map((pid) => ({ packing_cost: productMap.get(pid)!.packing_cost })),
  );

  const adSpend = (adSpendResult.data ?? []).reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );

  const netProfit = calculateNetProfit({
    revenue,
    cogs,
    deliveryCost,
    returnCost,
    packingCost,
    adSpend,
  });
  const margin = calculateMargin(netProfit, revenue);

  return {
    revenue,
    cogs,
    delivery_cost: deliveryCost,
    return_cost: returnCost,
    packing_cost: packingCost,
    ad_spend: adSpend,
    net_profit: netProfit,
    margin,
    delivered_count: deliveredOrders.length,
    returned_count: returnedOrders.length,
    confirmed_count: confirmedOrderProductIds.length,
    leads_count: leadsResult.count ?? 0,
  };
}
