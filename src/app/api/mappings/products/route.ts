import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings, canManageMappings } from "@/lib/mapping-permissions";

export const dynamic = "force-dynamic";

/**
 * Storefront -> OMS product mappings.
 *
 * GET  — list mappings for a market (joined to storefront + product names).
 * POST — create a mapping for (storefront_id, external_variant_id) and
 *        back-fill any still-open orders carrying that variant id so they
 *        flip from unmatched/needs_review to mapped without waiting for a
 *        new webhook.
 *
 * Market isolation is enforced by RLS on storefront_product_mappings (joins
 * through storefront_id -> storefronts.market_id). These checks fail fast at
 * the edge; they are not the security boundary.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // super_admin may target a specific market via ?market_id; others are pinned.
  const targetMarketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;

  if (actor.role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Storefronts in the target market — mappings are scoped through them.
  let storefrontQuery = supabase.from("storefronts").select("id, name, market_id");
  if (targetMarketId) {
    storefrontQuery = storefrontQuery.eq("market_id", targetMarketId);
  }
  const { data: storefronts, error: sfError } = await storefrontQuery;
  if (sfError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const storefrontIds = (storefronts ?? []).map((s) => s.id);
  if (storefrontIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await supabase
    .from("storefront_product_mappings")
    .select(
      "id, storefront_id, external_variant_id, external_product_id, product_id, product_variant_id, created_at, " +
        "storefronts(name), products(name, sku), product_variants(label)",
    )
    .in("storefront_id", storefrontIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storefrontId = typeof body.storefront_id === "string" ? body.storefront_id : "";
  const externalVariantId =
    typeof body.external_variant_id === "string" ? body.external_variant_id.trim() : "";
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const productVariantId =
    typeof body.product_variant_id === "string" && body.product_variant_id.trim() !== ""
      ? body.product_variant_id
      : null;
  const externalProductId =
    typeof body.external_product_id === "string" && body.external_product_id.trim() !== ""
      ? body.external_product_id.trim()
      : null;

  if (!storefrontId || !externalVariantId || !productId) {
    return NextResponse.json(
      { error: "storefront_id, external_variant_id and product_id are required" },
      { status: 400 },
    );
  }

  // The storefront and the product must be in the same market. RLS would
  // already block a cross-market write, but check explicitly for a clear 400.
  const [{ data: storefront }, { data: product }] = await Promise.all([
    supabase.from("storefronts").select("id, market_id").eq("id", storefrontId).maybeSingle(),
    supabase.from("products").select("id, market_id").eq("id", productId).maybeSingle(),
  ]);
  if (!storefront || !product) {
    return NextResponse.json({ error: "Storefront or product not found" }, { status: 404 });
  }
  if (storefront.market_id !== product.market_id) {
    return NextResponse.json(
      { error: "Product and storefront are in different markets" },
      { status: 400 },
    );
  }

  const { data: mapping, error: insertError } = await supabase
    .from("storefront_product_mappings")
    .insert({
      storefront_id: storefrontId,
      external_variant_id: externalVariantId,
      external_product_id: externalProductId,
      product_id: productId,
      product_variant_id: productVariantId,
    })
    .select("id")
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A mapping for this storefront variant already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Back-fill still-open orders carrying this external variant id. Only
  // pre-confirmation orders are touched — once an order is confirmed/uploaded
  // its product is locked. mapping_status is recomputed per order: the product
  // side is now resolved, so an order whose city is already resolved becomes
  // fully 'mapped'; one whose city is still null stays 'needs_review'.
  const { data: openOrders } = await supabase
    .from("orders")
    .select("id, city_id")
    .eq("storefront_id", storefrontId)
    .eq("external_variant_id", externalVariantId)
    .in("status", ["pending", "unverified"]);

  let backfilledCount = 0;
  for (const o of openOrders ?? []) {
    const nextStatus = o.city_id ? "mapped" : "needs_review";
    await supabase
      .from("orders")
      .update({
        product_id: productId,
        product_variant_id: productVariantId,
        mapping_status: nextStatus,
      })
      .eq("id", o.id);
    backfilledCount += 1;
  }

  return NextResponse.json(
    { data: { id: mapping.id }, backfilled: backfilledCount },
    { status: 201 },
  );
}
