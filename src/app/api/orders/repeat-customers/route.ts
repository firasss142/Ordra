import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";
import type { RepeatCustomerRow } from "@/lib/orders/repeat-customers";

export const dynamic = "force-dynamic";

/** A customer counts as back when they ordered this week… */
const RECENT_DAYS = 7;
/** …and their trail covers the last 90 days (« même numéro · 90 derniers jours »). */
const DAYS_BACK = 90;

/**
 * Commandes répétées — the customers who ordered again (get_repeat_customers),
 * each with every order of the last 90 days, oldest first. The page collapses
 * duplicate groups (/api/orders/duplicates) and derives reliability itself
 * (lib/orders/repeat-customers). Agents read it, as they read Doublons.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!["super_admin", "market_manager", "agent"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  if (actor.role !== "super_admin" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_repeat_customers", {
    p_market_id: marketId,
    p_recent_days: RECENT_DAYS,
    p_days_back: DAYS_BACK,
  });
  if (error || !data) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: { customers: data as RepeatCustomerRow[], days_back: DAYS_BACK } });
}

export const GET = withRouteErrors("/api/orders/repeat-customers", "GET", handleGET);
