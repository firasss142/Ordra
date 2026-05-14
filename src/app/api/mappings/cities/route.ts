import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings, canManageMappings } from "@/lib/mapping-permissions";

export const dynamic = "force-dynamic";

/**
 * Storefront-platform city -> OMS city mappings.
 *
 * GET  — list mappings whose resolved OMS city is in the target market.
 * POST — create a mapping for (platform, external_city_id) -> cities.id and
 *        back-fill still-open orders carrying that external city id.
 *
 * external_city_mappings is keyed by (platform, external_city_id) because a
 * platform's city catalog is platform-wide, not per-storefront. The resolved
 * city's market must equal the target market — RLS enforces this; the POST
 * also checks it explicitly for a clear error.
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

  // Cities in the target market — mappings are scoped through them.
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

  if (!platform || !externalCityId || !cityId) {
    return NextResponse.json(
      { error: "platform, external_city_id and city_id are required" },
      { status: 400 },
    );
  }

  // The resolved city must be in the actor's market (market_manager) or the
  // explicitly targeted market (super_admin).
  const { data: city } = await supabase
    .from("cities")
    .select("id, market_id")
    .eq("id", cityId)
    .maybeSingle();
  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }
  if (actor.role === "market_manager" && city.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: mapping, error: insertError } = await supabase
    .from("external_city_mappings")
    .insert({
      platform,
      external_city_id: externalCityId,
      external_city_name: externalCityName,
      city_id: cityId,
      dexpress_state_id: dexpressStateId,
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
        city_id: cityId,
        dexpress_state_id: dexpressStateId,
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
