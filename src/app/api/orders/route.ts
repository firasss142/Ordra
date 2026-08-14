import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewOrders, canCreateOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

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
    product_id,
    variant_id,
  } = body;

  if (!customer_name || !customer_phone || !product_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  let resolvedStorefrontId =
    typeof storefront_id === "string" && storefront_id.trim() !== ""
      ? storefront_id
      : "";

  if (!resolvedStorefrontId) {
    const { data: storefront, error: storefrontError } = await supabase
      .from("storefronts")
      .select("id")
      .eq("market_id", marketId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (storefrontError || !storefront) {
      return NextResponse.json(
        { error: "No active storefront is configured for this market" },
        { status: 400 },
      );
    }
    resolvedStorefrontId = storefront.id;
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, market_id, name, default_price, is_active")
    .eq("id", product_id as string)
    .eq("market_id", marketId)
    .eq("is_active", true)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const requestedQty = Number(body.quantity ?? 1);
  if (!Number.isInteger(requestedQty) || requestedQty < 1) {
    return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }

  let quantity = requestedQty;
  const rawProductPrice = product.default_price as unknown;
  let unitPrice =
    rawProductPrice !== null && rawProductPrice !== undefined
      ? Number(rawProductPrice)
      : NaN;
  let variantLabel =
    typeof body.variant_label === "string" && body.variant_label.trim() !== ""
      ? body.variant_label.trim()
      : null;
  let productVariantId: string | null = null;

  if (typeof variant_id === "string" && variant_id.trim() !== "") {
    const { data: variant, error: variantError } = await supabase
      .from("product_variants")
      .select("id, product_id, label, quantity, display_price, is_active")
      .eq("id", variant_id)
      .eq("product_id", product.id)
      .eq("is_active", true)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    productVariantId = variant.id;
    variantLabel = variant.label;
    // A variant sets the unit price and the label; it no longer dictates the
    // quantity. It used to, which meant the panel could show "3 × 25,50 =
    // 76,50" and the order would save as one unit at 25,50 — the operator was
    // shown one number and the business recorded another.
    const rawVariantPrice = variant.display_price as unknown;
    unitPrice =
      rawVariantPrice !== null && rawVariantPrice !== undefined
        ? Number(rawVariantPrice)
        : NaN;
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json(
      { error: "Product price is not configured" },
      { status: 400 },
    );
  }

  const computedTotal = Math.round(quantity * unitPrice * 1000) / 1000;

  /**
   * An agreed price that is not quantity × unit price — a discount, a rounded
   * cash figure. Accepted only from a manager or admin, and only as a real
   * number ≥ 0; anything else falls back to the computed figure rather than
   * writing a NaN into the column revenue is read from.
   *
   * Agents cannot set it. `total_price` IS revenue (see CLAUDE.md), so letting
   * the confirmation queue rewrite it would make every reported figure a
   * function of whoever took the call.
   */
  const isAgent = role === "agent";
  let totalPrice = computedTotal;
  let totalOverridden = false;
  if (!isAgent && body.total_price !== undefined && body.total_price !== null) {
    const requested = Number(body.total_price);
    if (!Number.isFinite(requested) || requested < 0) {
      return NextResponse.json(
        { error: "total_price must be a positive number" },
        { status: 400 },
      );
    }
    const rounded = Math.round(requested * 1000) / 1000;
    if (rounded !== computedTotal) {
      totalPrice = rounded;
      totalOverridden = true;
    }
  }

  const initialStatus = "pending";

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      market_id: marketId,
      storefront_id: resolvedStorefrontId,
      external_id: external_id ?? `manual-${Date.now()}`,
      external_platform: external_platform ?? "manual",
      status: initialStatus,
      customer_name,
      customer_phone,
      customer_address: body.customer_address ?? null,
      customer_city: body.customer_city ?? null,
      customer_note: body.customer_note ?? null,
      product_id: product.id,
      product_variant_id: productVariantId,
      product_name: product.name,
      variant_label: variantLabel,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      dexpress_state_id:
        typeof body.dexpress_state_id === "number" ? body.dexpress_state_id : null,
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

  /**
   * A manually-set total gets its own history row, so a discounted order can
   * later be told apart from a mispriced one. Without it the only trace is a
   * total_price that happens not to divide by the quantity, which is not
   * evidence of anything.
   *
   * A same-status row is the established annotation shape here (thousands of
   * `pending → pending` rows already), and order_history is append-only.
   */
  if (totalOverridden) {
    await supabase.from("order_history").insert({
      order_id: order.id,
      status_from: initialStatus,
      status_to: initialStatus,
      actor_id: actor.id,
      actor_type: "manager",
      note: `Total overridden: ${computedTotal} → ${totalPrice} (${quantity} × ${unitPrice})`,
    });
  }

  return NextResponse.json({ data: order }, { status: 201 });
}
