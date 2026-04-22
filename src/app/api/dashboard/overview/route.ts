import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProfitability } from "@/lib/profitability-permissions";
import { calculateBusinessProfitability } from "@/lib/calculations/business-profitability";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canViewProfitability(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = todayISO();
  const fromDate = req.nextUrl.searchParams.get("from_date") ?? today;
  const toDate = req.nextUrl.searchParams.get("to_date") ?? today;

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
    marketId = actor.market_id!;
  }

  const dateLte = toDate + "T23:59:59.999Z";

  const [
    marketResult,
    totalOrdersResult,
    totalRejectedResult,
    deliveredResult,
    returnedResult,
    confirmedResult,
    adSpendResult,
  ] = await Promise.all([
    supabase.from("markets").select("currency").eq("id", marketId).single(),

    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),

    supabase
      .from("order_history")
      .select("id, orders!inner(market_id)", { count: "exact", head: true })
      .eq("status_to", "rejected")
      .eq("orders.market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),

    supabase
      .from("order_history")
      .select(
        "orders!inner(total_price, quantity, products(unit_cogs, packing_cost), carriers(delivery_fee, return_fee))"
      )
      .eq("status_to", "delivered")
      .eq("orders.market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),

    supabase
      .from("order_history")
      .select(
        "orders!inner(carriers(delivery_fee, return_fee))"
      )
      .eq("status_to", "returned")
      .eq("orders.market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),

    supabase
      .from("order_history")
      .select(
        "orders!inner(products(packing_cost))"
      )
      .eq("status_to", "confirmed")
      .eq("orders.market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),

    supabase
      .from("ad_spend")
      .select("id, market_id, product_id, amount, period_start, period_end, note, created_by, created_at, is_active")
      .eq("market_id", marketId)
      .eq("is_active", true)
      .is("product_id", null)
      .lte("period_start", toDate)
      .gte("period_end", fromDate)
      .order("period_start", { ascending: false }),
  ]);

  const currency = (marketResult.data as { currency?: string } | null)?.currency ?? "TND";

  const adSpendEntries = adSpendResult.data ?? [];
  const totalAdSpend = adSpendEntries.reduce((sum, r) => sum + Number(r.amount), 0);

  type DeliveredRow = {
    total_price: number;
    quantity: number;
    products: { unit_cogs: number; packing_cost: number } | null;
    carriers: { delivery_fee: number; return_fee: number } | null;
  };

  type ReturnedRow = {
    carriers: { delivery_fee: number; return_fee: number } | null;
  };

  type ConfirmedRow = {
    products: { packing_cost: number } | null;
  };

  const deliveredOrderShapes = (deliveredResult.data ?? []).map((h) => {
    const o = h.orders as unknown as DeliveredRow;
    return {
      total_price: Number(o.total_price),
      quantity: Number(o.quantity),
      status: "delivered" as const,
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
      carrier_return_fee: Number(o.carriers?.return_fee ?? 0),
      product_unit_cogs: Number(o.products?.unit_cogs ?? 0),
      product_packing_cost: Number(o.products?.packing_cost ?? 0),
    };
  });

  const returnedOrderShapes = (returnedResult.data ?? []).map((h) => {
    const o = h.orders as unknown as ReturnedRow;
    return {
      total_price: 0,
      quantity: 1,
      status: "returned" as const,
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
      carrier_return_fee: Number(o.carriers?.return_fee ?? 0),
      product_unit_cogs: 0,
      product_packing_cost: 0,
    };
  });

  const confirmedHistory = confirmedResult.data ?? [];
  const confirmedOrderShapes = confirmedHistory.map((h) => {
    const o = h.orders as unknown as ConfirmedRow;
    return {
      total_price: 0,
      quantity: 1,
      status: "confirmed" as const,
      carrier_delivery_fee: 0,
      carrier_return_fee: 0,
      product_unit_cogs: 0,
      product_packing_cost: Number(o.products?.packing_cost ?? 0),
    };
  });

  const allOrders = [
    ...deliveredOrderShapes,
    ...returnedOrderShapes,
    ...confirmedOrderShapes,
  ];

  const profitabilityResult = calculateBusinessProfitability({
    orders: allOrders,
    totalAdSpend,
    totalOrdersReceived: totalOrdersResult.count ?? 0,
    totalConfirmed: confirmedHistory.length,
    totalRejected: totalRejectedResult.count ?? 0,
  });

  return NextResponse.json({
    data: {
      profitability: {
        ...profitabilityResult,
        currency,
        period: { from_date: fromDate, to_date: toDate },
      },
      adSpend: adSpendEntries,
    },
  });
}
