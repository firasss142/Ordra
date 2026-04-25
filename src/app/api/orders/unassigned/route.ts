import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  if (!canAssignOrders(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pagination
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("orders")
    .select("id, external_id, external_platform, storefront_id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, created_at", { count: "exact" })
    .eq("status", "new")
    .is("assigned_to", null);

  if (marketId) {
    query = query.eq("market_id", marketId);
  }

  const productId = req.nextUrl.searchParams.get("product_id");
  if (productId) query = query.eq("product_id", productId);

  const city = req.nextUrl.searchParams.get("city");
  if (city) query = query.ilike("customer_city", `%${city}%`);

  const dateFrom = req.nextUrl.searchParams.get("from_date");
  if (dateFrom) query = query.gte("created_at", dateFrom);

  const dateTo = req.nextUrl.searchParams.get("to_date");
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error, count } = await query
    .order("created_at", { ascending: true })
    .range(from, to);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    orders: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}
