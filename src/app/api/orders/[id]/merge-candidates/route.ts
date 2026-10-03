import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getMergeWindowHours } from "@/lib/orders/merge-window";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Orders that could be combined with `[id]` into one parcel: same customer,
 * different product, both still untouched by the agent.
 *
 * Returns `enabled: false` when the market's merge window is 0, which is how a
 * market opts out — the panel then hides the affordance entirely rather than
 * showing an empty list that looks like a bug.
 */
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const supabase = await createClient();

  // RLS decides visibility; a 404 here means "not yours" as much as "gone".
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (readError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const windowHours = await getMergeWindowHours(supabase, order.market_id);
  if (windowHours <= 0) {
    return NextResponse.json({
      data: { enabled: false, window_hours: 0, candidates: [] },
    });
  }

  const { data, error } = await supabase.rpc("get_merge_candidates", {
    p_order_id: id,
    p_window_hours: windowHours,
  });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export const GET = withRouteErrors("/api/orders/[id]/merge-candidates", "GET", handleGET);
