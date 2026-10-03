import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, canManageProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(
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

  /*
   * The two axes, both of them. An 'attribute' variant carries its own stock,
   * cost and SKU; a 'pack' tier carries none of those and multiplies the
   * quantity instead. Listing only the pack columns is how the product screen
   * ended up unable to show a size at all.
   *
   * AGENTS NEVER RECEIVE COST. What a product costs us is none of their
   * business, and this is the only route reading a variant that lets them
   * through — everything else refuses the agent before it gets near a cost
   * column. The boundary has to live here, in the column list: PostgreSQL
   * grants are per POSTGRES role (`authenticated`), which agent,
   * market_manager and super_admin all share, so revoking `unit_cogs` in the
   * database would take it from the super admin too and the product screen
   * would die on "permission denied".
   *
   * They keep what they need to offer a tier mid-call: the label, the price,
   * and whether there is any left.
   */
  const AGENT_VARIANT_COLUMNS =
    "id, product_id, kind, label, quantity, display_price, current_stock, is_active";
  const FULL_VARIANT_COLUMNS =
    "id, product_id, kind, label, sku, quantity, unit_cogs, display_price, " +
    "current_stock, damaged_return_count, is_active";

  const { data: variants, error } = await supabase
    .from("product_variants")
    .select(role === "agent" ? AGENT_VARIANT_COLUMNS : FULL_VARIANT_COLUMNS)
    .eq("product_id", id)
    .order("label", { ascending: true });

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: variants ?? [] });
}

async function handlePOST(
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

  /*
   * Which axis this variant sits on. The default stays 'pack' so every caller
   * written before the attribute axis existed keeps its exact meaning — and so
   * do the two pack tiers already in the database.
   */
  const kind = body.kind === undefined ? "pack" : body.kind;
  if (kind !== "pack" && kind !== "attribute") {
    return NextResponse.json(
      { error: "kind must be 'attribute' or 'pack'" },
      { status: 400 },
    );
  }
  const isAttribute = kind === "attribute";

  /*
   * A size is not a multiplier. "Grand" is one unit of a different object, so
   * its quantity is 1 by definition and is not the caller's to set; a pack tier
   * is exactly the opposite — its quantity IS the offer.
   */
  const resolvedQuantity = isAttribute ? 1 : quantity;
  if (!isAttribute && (typeof resolvedQuantity !== "number" || resolvedQuantity < 1)) {
    return NextResponse.json({ error: "quantity must be at least 1" }, { status: 400 });
  }

  if (typeof display_price !== "number" || display_price <= 0) {
    return NextResponse.json({ error: "display_price must be greater than 0" }, { status: 400 });
  }

  // Empty is not a SKU. Stored as "", it would occupy the market's unique index
  // and the next variant left blank would collide with it for no reason.
  const sku =
    typeof body.sku === "string" && body.sku.trim() !== "" ? body.sku.trim() : null;

  const unitCogs = body.unit_cogs === undefined ? 0 : body.unit_cogs;
  if (typeof unitCogs !== "number" || !Number.isFinite(unitCogs) || unitCogs < 0) {
    return NextResponse.json({ error: "unit_cogs must be zero or more" }, { status: 400 });
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
      kind,
      label: label.trim(),
      sku,
      quantity: resolvedQuantity,
      unit_cogs: unitCogs,
      display_price,
      is_active: true,
      // `current_stock` is deliberately absent. Stock has exactly five entry
      // points and all of them write the ledger; letting a create form seed a
      // balance would be a sixth, with no inventory_log row to explain it.
    })
    .select()
    .single();

  if (insertError) {
    // `products.sku` and `product_variants.sku` share one namespace per market,
    // enforced by a trigger that raises 23505. That is a taken name, not a
    // server fault.
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: variant }, { status: 201 });
}

export const GET = withRouteErrors("/api/products/[id]/variants", "GET", handleGET);
export const POST = withRouteErrors("/api/products/[id]/variants", "POST", handlePOST);
