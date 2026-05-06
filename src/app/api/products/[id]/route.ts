import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, canManageProducts } from "@/lib/product-permissions";
import { isValidProduct } from "@/types/product";
import { isLowStock } from "@/lib/product-calculations";
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

  const { data: product, error } = await supabase
    .from("products")
    .select("*, product_variants(*)")
    .eq("id", id)
    .single();

  if (error || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canViewProducts(role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { product_variants, ...productFields } = product;

  return NextResponse.json({
    data: {
      ...productFields,
      variants: product_variants ?? [],
      stock_summary: {
        current_stock: product.current_stock,
        low_stock_threshold: product.low_stock_threshold,
        damaged_return_count: product.damaged_return_count,
        is_low_stock: isLowStock(product.current_stock, product.low_stock_threshold),
      },
    },
  });
}

export async function PATCH(
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

  // Fetch existing product
  const { data: existing, error: fetchError } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canManageProducts(role, existing.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow specific fields
  const allowedFields = [
    "name",
    "sku",
    "description",
    "image_url",
    "unit_cogs",
    "packing_cost",
    "confirmation_processing_cost",
    "default_price",
    "low_stock_threshold",
    "is_active",
  ];

  // Empty strings on these fields mean "clear" — store null so the unique
  // partial index on (market_id, sku) treats it as absent.
  const nullableTextFields = new Set(["sku", "description", "image_url"]);

  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      const v = body[key];
      if (nullableTextFields.has(key) && typeof v === "string" && v.trim() === "") {
        updates[key] = null;
      } else if (nullableTextFields.has(key) && typeof v === "string") {
        updates[key] = v.trim();
      } else {
        updates[key] = v;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Validate the merged product
  const merged = { ...existing, ...updates };
  if (!isValidProduct(merged)) {
    return NextResponse.json({ error: "Invalid product data" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("products")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    if ((updateError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: updated });
}
