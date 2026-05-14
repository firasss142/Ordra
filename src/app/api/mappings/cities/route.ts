import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings, canManageMappings } from "@/lib/mapping-permissions";
import { marketIdToCode } from "@/lib/markets";

export const dynamic = "force-dynamic";

/**
 * Storefront-platform city -> OMS destination mappings — market-aware.
 *
 *   - Tunisia: the destination is an OMS city. The mapping carries `city_id`
 *     and back-fill sets `orders.city_id`.
 *   - Libya: the carrier is Dexpress; the destination is a dexpress_states
 *     row. The mapping carries `dexpress_state_id` and back-fill sets
 *     `orders.dexpress_state_id`. `city_id` stays null. This is what the
 *     Dexpress upload flow in the agent UI actually reads.
 *
 * external_city_mappings is keyed by (platform, external_city_id) because a
 * platform's city catalogue is platform-wide, not per-storefront.
 *
 * GET  — list mappings for the target market.
 * POST — create a mapping + back-fill still-open orders carrying that
 *        external city id.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const targetMarketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;

  if (actor.role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isDexpressMarket = marketIdToCode(targetMarketId) === "ly";

  if (isDexpressMarket) {
    // Libya — mappings carry a dexpress_state_id (city_id is null). There is
    // no per-market scoping column on the mapping itself, but a Dexpress-bound
    // mapping is by definition Libya's; list all of them.
    // dexpress_states has a single `name` column (Arabic) — no name_ar.
    const { data, error } = await supabase
      .from("external_city_mappings")
      .select(
        "id, platform, external_city_id, external_city_name, city_id, dexpress_state_id, external_route_id, created_at, " +
          "dexpress_states(name)",
      )
      .not("dexpress_state_id", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  }

  // Tunisia (or super_admin with no market) — mappings are scoped through the
  // cities in the target market.
  let cityQuery = supabase.from("cities").select("id, market_id");
  if (targetMarketId) {
    cityQuery = cityQuery.eq("market_id", targetMarketId);
  }
  const { data: cities, error: cityError } = await cityQuery;
  if (cityError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const cityIds = (cities ?? []).map((c) => c.id);
  if (cityIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { data, error } = await supabase
    .from("external_city_mappings")
    .select(
      "id, platform, external_city_id, external_city_name, city_id, dexpress_state_id, external_route_id, created_at, " +
        "cities(name, name_ar)",
    )
    .in("city_id", cityIds)
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

  const platform = typeof body.platform === "string" ? body.platform.trim() : "";
  const externalCityId =
    typeof body.external_city_id === "string" ? body.external_city_id.trim() : "";
  const cityId = typeof body.city_id === "string" ? body.city_id : "";
  const externalCityName =
    typeof body.external_city_name === "string" && body.external_city_name.trim() !== ""
      ? body.external_city_name.trim()
      : null;
  const externalRouteId =
    typeof body.external_route_id === "string" && body.external_route_id.trim() !== ""
      ? body.external_route_id.trim()
      : null;
  const dexpressStateId =
    typeof body.dexpress_state_id === "number" ? body.dexpress_state_id : null;

  if (!platform || !externalCityId) {
    return NextResponse.json(
      { error: "platform and external_city_id are required" },
      { status: 400 },
    );
  }

  // Determine the target market: market_manager uses their own; super_admin
  // must pass market_id in the body (the bind modal sends it).
  const targetMarketId =
    actor.role === "super_admin"
      ? typeof body.market_id === "string"
        ? body.market_id
        : null
      : actor.market_id;
  if (!targetMarketId) {
    return NextResponse.json(
      { error: "market_id is required" },
      { status: 400 },
    );
  }
  const isDexpressMarket = marketIdToCode(targetMarketId) === "ly";

  // --- per-market validation + the destination columns to persist ---------
  let mappingCityId: string | null = null;
  let mappingDexpressStateId: number | null = null;

  if (isDexpressMarket) {
    // Libya — the destination is a Dexpress state.
    if (dexpressStateId === null) {
      return NextResponse.json(
        { error: "dexpress_state_id is required for this market" },
        { status: 400 },
      );
    }
    const { data: state } = await supabase
      .from("dexpress_states")
      .select("id")
      .eq("id", dexpressStateId)
      .maybeSingle();
    if (!state) {
      return NextResponse.json({ error: "Dexpress state not found" }, { status: 404 });
    }
    mappingDexpressStateId = dexpressStateId;
    mappingCityId = null;
  } else {
    // Tunisia — the destination is an OMS city.
    if (!cityId) {
      return NextResponse.json(
        { error: "city_id is required for this market" },
        { status: 400 },
      );
    }
    const { data: city } = await supabase
      .from("cities")
      .select("id, market_id")
      .eq("id", cityId)
      .maybeSingle();
    if (!city) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }
    if (city.market_id !== targetMarketId) {
      return NextResponse.json(
        { error: "City is not in the target market" },
        { status: 400 },
      );
    }
    mappingCityId = cityId;
    mappingDexpressStateId = null;
  }

  const { data: mapping, error: insertError } = await supabase
    .from("external_city_mappings")
    .insert({
      platform,
      external_city_id: externalCityId,
      external_city_name: externalCityName,
      city_id: mappingCityId,
      dexpress_state_id: mappingDexpressStateId,
      external_route_id: externalRouteId,
    })
    .select("id")
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A mapping for this platform city already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Back-fill still-open orders carrying this external city id. Per order:
  // the city side is now resolved, so an order whose product is also resolved
  // becomes 'mapped'; one whose product is still null stays 'needs_review'.
  // Sets the market-appropriate destination column (and clears the other, so
  // the mutual-exclusion invariant on orders holds).
  const { data: openOrders } = await supabase
    .from("orders")
    .select("id, product_id")
    .eq("external_platform", platform)
    .eq("external_city_id", externalCityId)
    .in("status", ["pending", "unverified"]);

  let backfilledCount = 0;
  for (const o of openOrders ?? []) {
    const nextStatus = o.product_id ? "mapped" : "needs_review";
    await supabase
      .from("orders")
      .update({
        city_id: mappingCityId,
        dexpress_state_id: mappingDexpressStateId,
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
