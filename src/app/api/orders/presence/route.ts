import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Every live presence row the caller may see, for the manager's orders list.
 *
 * A separate, tiny SWR key rather than a join into /api/orders/list — and not
 * only for cost. useOrdersList sets revalidateFirstPage:false and
 * refreshInterval:0 while realtime is connected, and acquiring a lock changes
 * no order row, so no order_changed broadcast fires. A lock joined into the
 * list would go stale and stay stale.
 *
 * The response is at most "panels currently open" — tens of rows — and one
 * fetch serves every page, every filter and the drawer.
 *
 * RLS does the scoping: super_admin sees all, market_manager sees their market.
 * server_now is returned so the client can correct for clock skew instead of
 * trusting a laptop clock to decide whether a lock has expired.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_presence")
    .select("order_id, user_id, role, mode, opened_at, expires_at")
    .gt("expires_at", new Date().toISOString());

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(
    { data: data ?? [], server_now: new Date().toISOString() },
    // Never cached: a two-second edge cache would make the indicator lie for
    // longer than a heartbeat.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
