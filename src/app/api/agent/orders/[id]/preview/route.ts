import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOrderPreview } from "@/lib/agent-search/preview";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/agent/orders/[id]/preview — the read-only snapshot an agent sees of
 * an order found by the market search that is not theirs. Never the order
 * panel: no presence row is written, so a manager is never blocked by it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;

  if (actor.role !== "agent" || !actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const data = await loadOrderPreview(createAdminClient(), {
      orderId: id,
      marketId: actor.market_id,
      meId: actor.id,
    });
    if (!data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ data }, { headers: NO_STORE });
  } catch (err) {
    console.error("[agent/orders/preview]", err);
    return NextResponse.json({ error: "Preview failed" }, { status: 500, headers: NO_STORE });
  }
}
