import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const { id, variantId } = await params;
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

  // Verify variant exists and belongs to this product
  const { data: existingVariant, error: variantError } = await supabase
    .from("product_variants")
    .select("*")
    .eq("id", variantId)
    .eq("product_id", id)
    .single();

  if (variantError || !existingVariant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedFields = ["label", "quantity", "display_price", "is_active"];
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Validate individual fields if present
  if ("label" in updates) {
    if (typeof updates.label !== "string" || (updates.label as string).trim() === "") {
      return NextResponse.json({ error: "label must be non-empty" }, { status: 400 });
    }
    updates.label = (updates.label as string).trim();
  }
  if ("quantity" in updates) {
    if (typeof updates.quantity !== "number" || (updates.quantity as number) < 1) {
      return NextResponse.json({ error: "quantity must be at least 1" }, { status: 400 });
    }
  }
  if ("display_price" in updates) {
    if (typeof updates.display_price !== "number" || (updates.display_price as number) <= 0) {
      return NextResponse.json({ error: "display_price must be greater than 0" }, { status: 400 });
    }
  }

  // Duplicate label check on rename (exclude self)
  if ("label" in updates) {
    const { data: dup } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", id)
      .ilike("label", updates.label as string)
      .neq("id", variantId)
      .limit(1);

    if (dup && dup.length > 0) {
      return NextResponse.json(
        { error: "A variant with this label already exists" },
        { status: 409 }
      );
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("product_variants")
    .update(updates)
    .eq("id", variantId)
    .eq("product_id", id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: updated });
}
