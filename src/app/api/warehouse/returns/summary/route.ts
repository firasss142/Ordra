import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

const cacheHeaders = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const baseQuery = (reason: string) => {
    let q = supabase
      .from("inventory_log")
      .select("*", { count: "exact", head: true })
      .eq("reason", reason);

    if (actor.role !== "super_admin" && actor.market_id) {
      q = q.eq("market_id", actor.market_id);
    }

    return q
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", todayEnd.toISOString());
  };

  const [scannedResult, damagedResult] = await Promise.all([
    baseQuery("returned"),
    baseQuery("damaged_return"),
  ]);

  if (scannedResult.error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (damagedResult.error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json(
    {
      scanned_today: scannedResult.count ?? 0,
      damaged_today: damagedResult.count ?? 0,
    },
    { headers: cacheHeaders },
  );
}
