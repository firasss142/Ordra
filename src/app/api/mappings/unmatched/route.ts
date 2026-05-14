import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings } from "@/lib/mapping-permissions";

export const dynamic = "force-dynamic";

/**
 * Review surface: open orders that need an explicit storefront -> OMS mapping
 * AND that an admin can actually bind through this UI.
 *
 * "Needs a mapping" is NOT the same as "has no product/city". An order whose
 * product resolved only by name (products.name ILIKE) DOES have a product_id,
 * but it resolved via the fragile fallback path — no explicit mapping row
 * exists, so the next order with the same variant id will name-match again
 * (or fail). Those orders must surface here so an admin can pin an explicit
 * mapping. The precise, correct signal is therefore:
 *
 *   the order carries an external id  AND  no mapping row exists for it yet
 *
 * That single rule covers BOTH cases the resolver produces without a mapping:
 *   - unmatched      (no product_id / city_id at all)
 *   - name-matched   (product_id / city_id set, but mapping_status='needs_review')
 * Once an admin binds it, a mapping row exists and the order drops off.
 *
 * "Can actually bind" — the bind flow keys a mapping on the external id
 * (external_variant_id for products, external_city_id for cities). Orders that
 * predate the resolver carry neither and are intentionally invisible here;
 * they are handled by the normal order-edit flow.
 *
 * Only pre-confirmation orders are listed — once an order is confirmed its
 * product/city are locked and a mapping fix no longer back-fills it.
 */

type MappingType = "products" | "cities";

/** Shape of a candidate order row selected below. */
interface CandidateOrder {
  id: string;
  created_at: string;
  mapping_status: string;
  external_platform: string;
  storefront_id: string;
  product_name: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  product_id: string | null;
  customer_city: string | null;
  external_city_id: string | null;
  external_route_id: string | null;
  city_id: string | null;
}

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

  // 1. Candidate orders: not fully mapped, pre-confirmation, carrying the
  //    external id this tab binds on.
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
    .limit(500);

  if (targetMarketId) {
    query = query.eq("market_id", targetMarketId);
  }

  if (type === "products") {
    query = query.not("external_variant_id", "is", null);
  } else {
    query = query.not("external_city_id", "is", null);
  }

  const { data: orders, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const candidates = (orders ?? []) as unknown as CandidateOrder[];
  if (candidates.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // 2. Fetch the mapping keys that already exist, scoped to just the ids the
  //    candidates reference, and drop any candidate that already has one.
  if (type === "products") {
    // A product mapping is keyed on (storefront_id, external_variant_id).
    const storefrontIds = [...new Set(candidates.map((o) => o.storefront_id))];
    const variantIds = [
      ...new Set(
        candidates
          .map((o) => o.external_variant_id)
          .filter((v): v is string => v != null),
      ),
    ];
    const { data: mappingRows, error: mapErr } = await supabase
      .from("storefront_product_mappings")
      .select("storefront_id, external_variant_id")
      .in("storefront_id", storefrontIds)
      .in("external_variant_id", variantIds);
    if (mapErr) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const mapped = new Set(
      ((mappingRows ?? []) as { storefront_id: string; external_variant_id: string }[]).map(
        (m) => `${m.storefront_id}::${m.external_variant_id}`,
      ),
    );
    const data = candidates.filter(
      (o) => !mapped.has(`${o.storefront_id}::${o.external_variant_id}`),
    );
    return NextResponse.json({ data });
  }

  // A city mapping is keyed on (platform, external_city_id).
  const platforms = [...new Set(candidates.map((o) => o.external_platform))];
  const cityIds = [
    ...new Set(
      candidates
        .map((o) => o.external_city_id)
        .filter((v): v is string => v != null),
    ),
  ];
  const { data: cityMappingRows, error: cityMapErr } = await supabase
    .from("external_city_mappings")
    .select("platform, external_city_id")
    .in("platform", platforms)
    .in("external_city_id", cityIds);
  if (cityMapErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const mappedCities = new Set(
    ((cityMappingRows ?? []) as { platform: string; external_city_id: string }[]).map(
      (m) => `${m.platform}::${m.external_city_id}`,
    ),
  );
  const data = candidates.filter(
    (o) => !mappedCities.has(`${o.external_platform}::${o.external_city_id}`),
  );
  return NextResponse.json({ data });
}
