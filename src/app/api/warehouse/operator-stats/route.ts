import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "private, max-age=10, stale-while-revalidate=60",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_operator_prep_stats", {
    p_actor_id: actor.id,
  });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // rate_per_hour is null, not 0, when nothing has been scanned: "no pace
  // recorded" and "standing still" are different claims about an operator.
  return NextResponse.json(data ?? {
    labels_printed_today: 0,
    orders_scanned_today: 0,
    avg_cycle_seconds: 0,
    scans_last_hour: 0,
    rate_per_hour: null,
  }, { headers: cacheHeaders });
}
