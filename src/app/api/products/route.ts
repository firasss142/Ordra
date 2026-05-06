import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, canManageProducts } from "@/lib/product-permissions";
import { isValidProduct } from "@/types/product";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Determine which market to query
  let targetMarketId: string | null = null;
  if (role === "super_admin") {
    const qp = req.nextUrl.searchParams.get("market_id");
    targetMarketId = qp || null; // null = all markets
  } else {
    targetMarketId = actorMarketId;
  }

  // Agents are scoped to their own market (read-only — used for order creation picker)
  if (role === "agent" && !actorMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // market_manager with no market_id is a data integrity error — deny access
  if (role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission check (agents bypass canViewProducts — scoped to own market above)
  if (role !== "agent" && targetMarketId && !canViewProducts(role, targetMarketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Agents only need basic fields — serve from products table
  // Managers/admins get system_inventory + real_inventory from the view
  const useView = role !== "agent";

  const rawPage = req.nextUrl.searchParams.get("page");
  const paginate = rawPage !== null;
  const pageParam = Number(rawPage ?? "1");
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const limit = Math.max(
    1,
    Math.min(200, Number.isFinite(limitParam) ? limitParam : 50),
  );

  const countOpts = paginate ? { count: "exact" as const } : undefined;

  let query = useView
    ? supabase
        .from("product_inventory_view")
        .select("*, product_variants(count)", countOpts)
        .order("name", { ascending: true })
    : supabase
        .from("products")
        .select(
          "id, name, current_stock, is_active, market_id, product_variants(count)",
          countOpts,
        )
        .order("name", { ascending: true });

  if (paginate) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);
  }

  if (targetMarketId) {
    query = query.eq("market_id", targetMarketId);
  }

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const products = (data ?? []).map((p: Record<string, unknown>) => {
    const { product_variants, ...rest } = p;
    const variants = product_variants as { count: number }[] | undefined;
    return {
      ...rest,
      variant_count: variants?.[0]?.count ?? 0,
    };
  });

  if (!paginate) {
    return NextResponse.json({ data: products });
  }

  const total = count ?? products.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return NextResponse.json({
    data: products,
    pagination: { total, page, limit, totalPages },
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

  // Determine market_id: market_manager uses their own, super_admin can specify
  const marketId = role === "super_admin" ? (body.market_id as string) : actorMarketId;
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  if (!canManageProducts(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const initialStock = typeof body.initial_stock === "number" ? body.initial_stock : 0;

  const defaultPrice =
    typeof body.default_price === "number" && body.default_price >= 0
      ? body.default_price
      : null;

  const sku =
    typeof body.sku === "string" && body.sku.trim() !== ""
      ? body.sku.trim()
      : null;

  const productRow = {
    name: body.name,
    sku,
    unit_cogs: body.unit_cogs,
    packing_cost: body.packing_cost,
    market_id: marketId,
    confirmation_processing_cost:
      typeof body.confirmation_processing_cost === "number"
        ? body.confirmation_processing_cost
        : 0,
    default_price: defaultPrice,
    low_stock_threshold:
      typeof body.low_stock_threshold === "number" ? body.low_stock_threshold : 0,
    current_stock: initialStock,
    damaged_return_count: 0,
    is_active: true,
  };

  if (!isValidProduct(productRow)) {
    return NextResponse.json({ error: "Invalid product data" }, { status: 400 });
  }

  const { data: product, error: insertError } = await supabase
    .from("products")
    .insert(productRow)
    .select()
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // If initial_stock > 0, create inventory log entry
  if (initialStock > 0) {
    const { error: logError } = await supabase.from("inventory_log").insert({
      product_id: product.id,
      order_id: null,
      change: initialStock,
      balance_after: initialStock,
      reason: "initial_stock",
      note: null,
      actor_id: actor.id,
    });

    if (logError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: product }, { status: 201 });
}
