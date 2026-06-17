import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings } from "@/lib/mapping-permissions";

export const dynamic = "force-dynamic";

/**
 * Review surface: open orders that need an admin to resolve a storefront -> OMS
 * mapping through this UI.
 *
 * Products and cities surface on different signals:
 *
 *   - Products: "needs a mapping" is NOT the same as "has no product". An order
 *     whose product resolved only by name (products.name ILIKE) DOES have a
 *     product_id, but no explicit mapping row exists, so the next order with
 *     the same variant id will name-match again (or fail). The signal is:
 *       the order carries an external_variant_id AND no mapping row exists yet.
 *
 *   - Cities: city resolution is name-only and deterministic at intake — the
 *     storefront city is a constrained dropdown value that either exact-matches
 *     our destination table (darb_destinations / cities / dexpress_states) or it
 *     doesn't. An unmatched city has no city_id, no darb_destination_id, and no
 *     dexpress_state_id. The signal is:
 *       the order has a customer_city AND none of the destination columns is set.
 *     The admin binds it directly to an existing destination (per-order); there
 *     is no city alias table.
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
  external_route_id: string | null;
  city_id: string | null;
  dexpress_state_id: number | null;
  darb_destination_id: number | null;
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

  // 1. Candidate orders: not fully mapped, pre-confirmation. Each tab adds its
  //    own filter — products on the external variant id, cities on whether the
  //    destination resolved.
  let query = supabase
    .from("orders")
    .select(
      "id, created_at, mapping_status, external_platform, storefront_id, " +
        "product_name, external_product_id, external_variant_id, product_id, " +
        "customer_city, external_route_id, city_id, dexpress_state_id, darb_destination_id",
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
    // City is name-only: an unmatched city resolved to NONE of the destination
    // columns (Darb primary, Dexpress fallback, or Tunisia cities). Only orders
    // with a customer_city can be bound.
    query = query
      .not("customer_city", "is", null)
      .is("city_id", null)
      .is("dexpress_state_id", null)
      .is("darb_destination_id", null);
  }

  const { data: orders, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const candidates = (orders ?? []) as unknown as CandidateOrder[];
  if (candidates.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // 2. Products: drop candidates that already have an explicit mapping row.
  //    Cities need no second pass — the query above is already the exact
  //    "city did not resolve" signal.
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

  // Cities: the query already selected exactly the orders whose city did not
  // resolve, so the candidate list is the answer.
  return NextResponse.json({ data: candidates });
}
