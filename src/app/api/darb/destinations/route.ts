import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Active Darb Assabil destinations (Libya primary catalogue) as (city, area)
 * pairs, ordered by city then area. This is the source the Libya storefront
 * dropdown + the dispatch picker resolve against, so orders arrive aligned to a
 * pair the carrier accepts. Mirrors /api/dexpress/states (the fallback list).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const { data: destinations, error } = await supabase
    .from("darb_destinations")
    .select("id, city, area")
    .eq("is_active", true)
    .order("city")
    .order("area");

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ destinations: destinations ?? [] });
}
