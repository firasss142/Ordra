import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAdjustStock, canViewProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Verify product exists
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("market_id, current_stock, damaged_return_count")
    .eq("id", id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canAdjustStock(role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { change, reason, note } = body;

  if (typeof change !== "number" || !Number.isInteger(change) || change === 0) {
    return NextResponse.json({ error: "change must be a non-zero integer" }, { status: 400 });
  }

  if (reason !== "manual_adjustment" && reason !== "damaged_writeoff") {
    return NextResponse.json(
      { error: "reason must be 'manual_adjustment' or 'damaged_writeoff'" },
      { status: 400 }
    );
  }

  if (typeof note !== "string" || note.trim() === "") {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  // damaged_writeoff must be negative
  if (reason === "damaged_writeoff" && change > 0) {
    return NextResponse.json(
      { error: "damaged_writeoff change must be negative" },
      { status: 400 }
    );
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "adjust_product_stock",
    {
      p_product_id: id,
      p_change: change,
      p_reason: reason,
      p_note: (note as string).trim(),
      p_actor_id: actor.id,
      p_is_damaged_writeoff: reason === "damaged_writeoff",
    }
  );

  if (rpcError) {
    const msg = rpcError.message ?? "";
    if (msg.includes("stock cannot go below zero")) {
      return NextResponse.json({ error: "stock cannot go below zero" }, { status: 400 });
    }
    if (msg.includes("Product not found")) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  return NextResponse.json(
    { new_stock: row.new_stock, log_entry: { id: row.log_id } },
    { status: 200 }
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Verify product exists
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("market_id")
    .eq("id", id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canViewProducts(role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pagination
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data: logs, error, count } = await supabase
    .from("inventory_log")
    .select("*", { count: "exact" })
    .eq("product_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: logs ?? [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
    },
  });
}
