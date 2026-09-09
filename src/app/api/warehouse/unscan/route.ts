import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

/**
 * Put a scanned parcel back on the bench.
 *
 * The reversal that did not exist. Until now the only way back from `scanned`
 * was manual_delete_orders, which restores the stock and then kills the order —
 * and recover_deleted_order refuses to bring back anything deleted from
 * `scanned`. So a mis-scan cost the order.
 *
 * The window is "before Darb has booked it", which in practice is wide: the
 * measured gap between our scan and their booking is about seventeen hours.
 * After that the parcel is theirs and taking it back is a conversation with
 * them, not a button here.
 */

const STATUS: Record<string, number> = {
  ACTOR_MISMATCH: 403,
  ACTOR_NOT_FOUND: 403,
  FORBIDDEN: 403,
  WRONG_SITE: 403,
  ORDER_NOT_FOUND: 404,
  MARKET_MISMATCH: 409,
  INVALID_STATUS: 409,
  TAKEN_BY_CARRIER: 409,
  NO_PRODUCT: 409,
};

function codeOf(details: unknown): string | null {
  if (typeof details !== "string") return null;
  try {
    const code = (JSON.parse(details) as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_id?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  // A reason is mandatory. An un-scan moves stock and frees a sticker that is
  // physically stuck to a box; six months later the ledger has to say why.
  const note = body.note?.trim();
  if (!note) {
    return NextResponse.json(
      { error_code: "NOTE_REQUIRED", message: "Dites pourquoi ce colis revient sur le banc" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unscan_order", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_note: note,
  });

  if (error) {
    const code = codeOf((error as { details?: unknown }).details);
    return NextResponse.json(
      { error_code: code ?? "UNSCAN_FAILED", message: error.message },
      { status: code ? (STATUS[code] ?? 409) : 422 },
    );
  }

  return NextResponse.json(data);
}
