import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings } from "@/lib/mapping-permissions";

export const dynamic = "force-dynamic";

/**
 * Review surface: open orders whose storefront payload did not fully resolve
 * to OMS entities (mapping_status <> 'mapped') AND that an admin can actually
 * bind through this UI.
 *
 * "Can actually bind" is the key filter. The bind flow keys a mapping on the
 * order's external identifier — external_variant_id for products,
 * external_city_id for cities. Orders that predate the resolver carry neither;
 * surfacing them would be a wall of dead, disabled rows. So:
 *   ?type=products  -> orders missing a product, WITH an external_variant_id
 *   ?type=cities    -> orders missing a city,    WITH an external_city_id
 *
 * Pre-resolver orders are intentionally invisible here — they are handled by
 * the normal order-edit flow, not the mapping catalog. As new Buybox/Shopify
 * webhooks arrive carrying real external ids, this surface populates.
 *
 * Only pre-confirmation orders are listed — once an order is confirmed its
 * product/city are locked and a mapping fix no longer back-fills it.
 */

type MappingType = "products" | "cities";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const typeParam = req.nextUrl.searchParams.get("type");
  if (typeParam !== "products" && typeParam !== "cities") {
    return NextResponse.json(
      { error: "type query param must be 'products' or 'cities'" },
      { status: 400 },
    );
  }
  const type: MappingType = typeParam;

  const targetMarketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;

  if (actor.role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("orders")
    .select(
      "id, created_at, mapping_status, external_platform, storefront_id, " +
        "product_name, external_product_id, external_variant_id, product_id, " +
        "customer_city, external_city_id, external_route_id, city_id",
    )
    .neq("mapping_status", "mapped")
    .in("status", ["pending", "unverified"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (targetMarketId) {
    query = query.eq("market_id", targetMarketId);
  }

  if (type === "products") {
    // Missing a product, but carries the external variant id needed to bind.
    query = query.is("product_id", null).not("external_variant_id", "is", null);
  } else {
    // Missing a city, but carries the external city id needed to bind.
    query = query.is("city_id", null).not("external_city_id", "is", null);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
