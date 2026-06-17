import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Active Darb Assabil service packages (توصيل رجالي / نسائي / فوري), ordered for
 * display. Each row's `service_id` is the Darb service ObjectId the dispatch
 * modal sends as `extra.service_id` (the adapter forwards it as `service`).
 * `surcharge` is display-only context — the fee is applied by Darb carrier-side.
 * Mirrors /api/darb/destinations.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const { data: services, error } = await supabase
    .from("darb_services")
    .select("service_id, title, attribute, surcharge, currency, is_default")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ services: services ?? [] });
}
