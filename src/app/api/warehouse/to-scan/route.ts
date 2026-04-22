import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

const cacheHeaders = {
  "Cache-Control": "private, max-age=2",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  // Confirmed orders that HAVE a label_prints row but status is still confirmed
  // (i.e. labeled, not yet scanned-out).
  let query = supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at, products(current_stock, low_stock_threshold)",
    )
    .eq("status", "confirmed")
    .order("created_at", { ascending: true })
    .limit(200);

  if (actor.role !== "super_admin" && actor.market_id) {
    query = query.eq("market_id", actor.market_id);
  }

  const { data: confirmed, error } = await query;
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const orderIds = (confirmed ?? []).map((o) => o.id);
  if (orderIds.length === 0)
    return NextResponse.json({ orders: [] }, { headers: cacheHeaders });

  const { data: printed } = await supabase
    .from("label_prints")
    .select("order_id")
    .in("order_id", orderIds);

  const printedSet = new Set((printed ?? []).map((p) => p.order_id));
  const labeled = (confirmed ?? [])
    .filter((o) => printedSet.has(o.id))
    .map((o) => {
      const raw = o as Record<string, unknown>;
      const productRaw = raw.products as
        | { current_stock: number | null; low_stock_threshold: number | null }
        | Array<{ current_stock: number | null; low_stock_threshold: number | null }>
        | null;
      const product = Array.isArray(productRaw) ? productRaw[0] ?? null : productRaw;
      const { products: _p, ...rest } = raw;
      return {
        ...rest,
        current_stock: product?.current_stock ?? null,
        low_stock_threshold: product?.low_stock_threshold ?? null,
      };
    });

  return NextResponse.json({ orders: labeled }, { headers: cacheHeaders });
}
