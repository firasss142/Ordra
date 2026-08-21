import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

/**
 * Record a physical count.
 *
 * The body carries the COUNTED QUANTITY, never a delta: the agent reports what
 * is on the shelf and the RPC derives the correction. A mistyped sign can
 * therefore not invent stock, and the note is mandatory so the ledger keeps
 * its causes. Damaged writeoffs are not reachable from here — those stay on
 * adjust_product_stock, super_admin only.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { product_id?: string; counted_qty?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const productId = body.product_id?.trim();
  const counted = body.counted_qty;
  const note = body.note?.trim();

  if (!productId) {
    return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
  }
  if (typeof counted !== "number" || !Number.isInteger(counted) || counted < 0) {
    return NextResponse.json(
      { error: "counted_qty must be a whole number of zero or more" },
      { status: 400 },
    );
  }
  if (!note) {
    return NextResponse.json({ error: "A note is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_stock_count", {
    p_product_id: productId,
    p_counted_qty: counted,
    p_actor_id: actor.id,
    p_note: note,
  });

  if (error) {
    const m = error.message.toLowerCase();
    const status =
      m.includes("cannot count") || m.includes("another market") ? 403
      : m.includes("not found") ? 404
      : 422;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
