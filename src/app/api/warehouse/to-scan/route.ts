import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const marketScope =
    actor.role !== "super_admin" && actor.market_id ? actor.market_id : null;

  const { data, error } = await supabase.rpc("get_to_scan_orders", {
    p_market_id: marketScope,
    p_limit: 200,
  });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ orders: data ?? [] }, { headers: cacheHeaders });
}
