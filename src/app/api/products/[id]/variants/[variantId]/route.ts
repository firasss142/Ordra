import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

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
    .select("id, kind, current_stock, damaged_return_count")
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

  /*
   * `current_stock` and `damaged_return_count` are deliberately NOT here.
   * Stock has exactly five entry points and every one of them writes an
   * inventory_log row; an edit form would be a sixth, leaving a balance with
   * nothing to explain it in an append-only ledger.
   */
  const allowedFields = [
    "label", "kind", "sku", "quantity", "unit_cogs", "display_price", "is_active",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  /*
   * Changing the axis redefines what the row IS: a pack tier holds no stock,
   * an attribute variant does. Flipping one that still carries units would
   * leave them allocated to a row that no longer holds any, and the market
   * total would keep counting them with nothing to say which size they are.
   */
  if ("kind" in updates) {
    if (updates.kind !== "pack" && updates.kind !== "attribute") {
      return NextResponse.json(
        { error: "kind must be 'attribute' or 'pack'" },
        { status: 400 },
      );
    }
    const stock = Number(existingVariant.current_stock ?? 0);
    const damaged = Number(existingVariant.damaged_return_count ?? 0);
    if (updates.kind !== existingVariant.kind && (stock > 0 || damaged > 0)) {
      return NextResponse.json(
        {
          error:
            "Cette variante porte encore du stock — soldez-le avant d'en changer la nature",
        },
        { status: 409 },
      );
    }
  }

  if ("sku" in updates) {
    if (updates.sku !== null && typeof updates.sku !== "string") {
      return NextResponse.json({ error: "sku must be a string or null" }, { status: 400 });
    }
    // Empty clears it rather than storing "", which would occupy the market's
    // unique index and collide with the next variant left blank.
    const trimmed = typeof updates.sku === "string" ? updates.sku.trim() : "";
    updates.sku = trimmed === "" ? null : trimmed;
  }

  if ("unit_cogs" in updates) {
    const cogs = updates.unit_cogs;
    if (typeof cogs !== "number" || !Number.isFinite(cogs) || cogs < 0) {
      return NextResponse.json({ error: "unit_cogs must be zero or more" }, { status: 400 });
    }
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

  if (updateError) {
    if ((updateError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: updated });
}

/**
 * Delete a variant — hard when nothing refers to it, soft otherwise.
 *
 * This route simply did not exist: a variant could be created and edited but
 * never removed. The rule follows the rejection-reasons precedent
 * (docs/rejection-reasons.md): hard-delete while the row is still unused, and
 * retire it (`is_active = false`) once any order, ledger line or storefront
 * mapping points at it — history has to stay readable. An order placed on
 * "Grand" must still say "Grand" months after the size left the catalogue.
 *
 * Stock is checked FIRST and refuses outright. Deleting a variant that still
 * carries units would leave them inside `products.current_stock` with nothing
 * left to say which size they are — an untraceable loss rather than a visible
 * one. Zero it through the ledger first.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("market_id")
    .eq("id", id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canManageProducts(actor.role, product.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: variant, error: variantError } = await supabase
    .from("product_variants")
    .select("id, kind, current_stock, damaged_return_count")
    .eq("id", variantId)
    .eq("product_id", id)
    .single();

  if (variantError || !variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  if (Number(variant.current_stock ?? 0) > 0 || Number(variant.damaged_return_count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Cette variante porte encore du stock — soldez-le avant de la supprimer",
      },
      { status: 409 },
    );
  }

  /*
   * Everything that can point at a variant, cheapest first. `order_items`
   * carries two columns — `variant_id` (the size that shipped) and
   * `pack_variant_id` (the offer that was sold) — and either one is a reason to
   * keep the row readable.
   */
  const referenceChecks: { table: string; run: () => PromiseLike<{ data: unknown }> }[] = [
    {
      table: "order_items",
      run: () =>
        supabase
          .from("order_items")
          .select("id")
          .or(`variant_id.eq.${variantId},pack_variant_id.eq.${variantId}`)
          .limit(1),
    },
    {
      table: "orders",
      run: () =>
        supabase.from("orders").select("id").eq("product_variant_id", variantId).limit(1),
    },
    {
      table: "inventory_log",
      run: () =>
        supabase.from("inventory_log").select("id").eq("variant_id", variantId).limit(1),
    },
    {
      table: "storefront_product_mappings",
      run: () =>
        supabase
          .from("storefront_product_mappings")
          .select("id")
          .eq("product_variant_id", variantId)
          .limit(1),
    },
  ];

  let referenced = false;
  for (const check of referenceChecks) {
    const { data } = await check.run();
    if (Array.isArray(data) ? data.length > 0 : Boolean(data)) {
      referenced = true;
      break;
    }
  }

  if (referenced) {
    const { error } = await supabase
      .from("product_variants")
      .update({ is_active: false })
      .eq("id", variantId)
      .eq("product_id", id);
    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ deleted: false, retired: true });
  }

  const { error: deleteError } = await supabase
    .from("product_variants")
    .delete()
    .eq("id", variantId)
    .eq("product_id", id);

  if (deleteError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, retired: false });
}
