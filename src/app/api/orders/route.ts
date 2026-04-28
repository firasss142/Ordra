import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewOrders, canCreateOrders } from "@/lib/order-permissions";
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

  if (marketId && !canViewOrders(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pagination
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" });

  if (marketId) {
    query = query.eq("market_id", marketId);
  }

  // Agent scoping: agents only see their own assigned orders
  if (role === "agent") {
    query = query.eq("assigned_to", actor.id);
  }

  // Optional filters
  const status = req.nextUrl.searchParams.get("status");
  if (status) query = query.eq("status", status);

  const assignedTo = req.nextUrl.searchParams.get("agent_id");
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const productId = req.nextUrl.searchParams.get("product_id");
  if (productId) query = query.eq("product_id", productId);

  const city = req.nextUrl.searchParams.get("city");
  if (city) query = query.eq("customer_city", city);

  const dateFrom = req.nextUrl.searchParams.get("date_from");
  if (dateFrom) query = query.gte("created_at", dateFrom);

  const dateTo = req.nextUrl.searchParams.get("date_to");
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketId =
    role === "market_manager" || role === "agent"
      ? actorMarketId
      : (body.market_id as string) ?? actorMarketId;

  if (!canCreateOrders(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate required fields
  const {
    storefront_id,
    external_id,
    external_platform,
    customer_name,
    customer_phone,
    product_name,
    unit_price,
    total_price,
  } = body;

  if (!customer_name || !customer_phone || !product_name || total_price === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!storefront_id) {
    return NextResponse.json({ error: "storefront_id is required" }, { status: 400 });
  }

  const isAgent = role === "agent";
  const initialStatus = isAgent ? "assigned" : "pending";

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      market_id: marketId,
      storefront_id,
      external_id: external_id ?? `manual-${Date.now()}`,
      external_platform: external_platform ?? "manual",
      status: initialStatus,
      customer_name,
      customer_phone,
      customer_address: body.customer_address ?? null,
      customer_city: body.customer_city ?? null,
      customer_note: body.customer_note ?? null,
      product_id: body.product_id ?? null,
      product_name,
      variant_label: body.variant_label ?? null,
      quantity: body.quantity ?? 1,
      unit_price: unit_price ?? total_price,
      total_price,
      assigned_to: isAgent ? actor.id : null,
    })
    .select("id, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  // Insert initial history
  await supabase.from("order_history").insert({
    order_id: order.id,
    status_from: null,
    status_to: initialStatus,
    actor_id: actor.id,
    actor_type: isAgent ? "agent" : "manager",
    note: isAgent ? "Order created by agent (self-assigned)" : "Order created manually",
  });

  return NextResponse.json({ data: order }, { status: 201 });
}
