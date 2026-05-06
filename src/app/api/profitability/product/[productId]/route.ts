import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProfitability } from "@/lib/profitability-permissions";
import {
  calculateProductProfitability,
  type ProductProfitabilityResult,
} from "@/lib/calculations/product-profitability";
import { getActor } from "@/lib/auth/actor";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PeriodCounts {
  totalLeads: number;
  confirmedCount: number;
  dispatchedCount: number;
  deliveredCount: number;
  returnedCount: number;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface ProductCostInputs {
  unitCogs: number;
  packingCost: number;
  cpl: number;
  confirmationProcessingCost: number;
}

async function computeForPeriod(
  supabase: SupabaseClient,
  productId: string,
  fromDate: string,
  toDate: string,
  costs: ProductCostInputs
): Promise<ProductProfitabilityResult & PeriodCounts & { period: { from_date: string; to_date: string } }> {
  const toDateEnd = toDate + "T23:59:59.999Z";

  type DeliveredRow = {
    total_price: number;
    quantity: number;
    carrier_id: string | null;
    carriers: { delivery_fee: number; return_fee: number } | null;
  };

  type ReturnedRow = {
    carrier_id: string | null;
    carriers: { delivery_fee: number; return_fee: number } | null;
  };

  const [
    { count: totalLeads },
    { count: confirmedCount },
    { count: dispatchedCount },
    deliveredHistory,
    returnedHistory,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .gte("created_at", fromDate)
      .lte("created_at", toDateEnd),

    supabase
      .from("order_history")
      .select("id, orders!inner(product_id)", { count: "exact", head: true })
      .eq("status_to", "confirmed")
      .eq("orders.product_id", productId)
      .gte("created_at", fromDate)
      .lte("created_at", toDateEnd),

    supabase
      .from("order_history")
      .select("id, orders!inner(product_id)", { count: "exact", head: true })
      .eq("status_to", "uploaded")
      .eq("orders.product_id", productId)
      .gte("created_at", fromDate)
      .lte("created_at", toDateEnd),

    fetchAllRows<{ orders: DeliveredRow }>(
      supabase
        .from("order_history")
        .select(
          "orders!inner(id, total_price, quantity, carrier_id, product_id, carriers!orders_carrier_id_fkey(delivery_fee, return_fee))"
        )
        .eq("status_to", "delivered")
        .eq("orders.product_id", productId)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),

    fetchAllRows<{ orders: ReturnedRow }>(
      supabase
        .from("order_history")
        .select(
          "orders!inner(id, carrier_id, product_id, carriers!orders_carrier_id_fkey(delivery_fee, return_fee))"
        )
        .eq("status_to", "returned")
        .eq("orders.product_id", productId)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
    ),
  ]);

  const deliveredOrders = deliveredHistory.map((h) => {
    const o = h.orders;
    return {
      total_price: Number(o.total_price),
      quantity: Number(o.quantity),
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
    };
  });

  const returnedOrders = returnedHistory.map((h) => {
    const o = h.orders;
    return {
      carrier_return_fee: Number(o.carriers?.return_fee ?? 0),
    };
  });

  const result = calculateProductProfitability({
    totalLeads: totalLeads ?? 0,
    confirmedCount: confirmedCount ?? 0,
    dispatchedCount: dispatchedCount ?? 0,
    deliveredCount: deliveredOrders.length,
    returnedCount: returnedOrders.length,
    unitCogs: costs.unitCogs,
    packingCost: costs.packingCost,
    cpl: costs.cpl,
    confirmationProcessingCost: costs.confirmationProcessingCost,
    deliveredOrders,
    returnedOrders,
  });

  return {
    ...result,
    confirmedCount: confirmedCount ?? 0,
    dispatchedCount: dispatchedCount ?? 0,
    deliveredCount: deliveredOrders.length,
    returnedCount: returnedOrders.length,
    period: { from_date: fromDate, to_date: toDate },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
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
  const previousFromDate = req.nextUrl.searchParams.get("previous_from_date");
  const previousToDate = req.nextUrl.searchParams.get("previous_to_date");

  // --- Fetch product, verify market ownership ---
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, name, unit_cogs, packing_cost, cpl, confirmation_processing_cost, market_id, current_stock, low_stock_threshold"
    )
    .eq("id", productId)
    .single();

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (role === "market_manager" && product.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Fetch market currency ---
  const { data: market } = await supabase
    .from("markets")
    .select("currency")
    .eq("id", product.market_id)
    .single();

  const currency = (market as { currency?: string } | null)?.currency ?? "TND";

  const costs: ProductCostInputs = {
    unitCogs: Number(product.unit_cogs),
    packingCost: Number(product.packing_cost),
    cpl: Number(product.cpl),
    confirmationProcessingCost: Number(product.confirmation_processing_cost ?? 0),
  };

  const current = await computeForPeriod(
    supabase,
    productId,
    fromDate,
    toDate,
    costs
  );

  const previous =
    previousFromDate && previousToDate
      ? await computeForPeriod(
          supabase,
          productId,
          previousFromDate,
          previousToDate,
          costs
        )
      : null;

  return NextResponse.json({
    data: {
      product_name: product.name,
      current_stock: product.current_stock,
      low_stock_threshold: product.low_stock_threshold,
      currency,
      ...current,
      previous,
    },
  });
}
