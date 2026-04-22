import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, canManageProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";

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

  // Verify product exists and get its market_id
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("market_id")
    .eq("id", id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Agents can view variants for products in their own market (order creation picker)
  const agentCanView = role === "agent" && product.market_id === actorMarketId;
  if (!agentCanView && !canViewProducts(role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: variants, error } = await supabase
    .from("product_variants")
    .select("id, product_id, label, quantity, display_price, is_active")
    .eq("product_id", id)
    .order("label", { ascending: true });

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: variants ?? [] });
}

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
    .select("market_id")
    .eq("id", id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canManageProducts(role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { label, quantity, display_price } = body;

  if (typeof label !== "string" || label.trim() === "") {
    return NextResponse.json({ error: "label is required and must be non-empty" }, { status: 400 });
  }
  if (typeof quantity !== "number" || quantity < 1) {
    return NextResponse.json({ error: "quantity must be at least 1" }, { status: 400 });
  }
  if (typeof display_price !== "number" || display_price <= 0) {
    return NextResponse.json({ error: "display_price must be greater than 0" }, { status: 400 });
  }

  // Duplicate label check (case-insensitive)
  const { data: existing } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", id)
    .ilike("label", label.trim())
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "A variant with this label already exists" },
      { status: 409 }
    );
  }

  const { data: variant, error: insertError } = await supabase
    .from("product_variants")
    .insert({
      product_id: id,
      label: label.trim(),
      quantity,
      display_price,
      is_active: true,
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: variant }, { status: 201 });
}
