import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { OrderStatus } from "@/types/order-status";

export const dynamic = "force-dynamic";

const PHASE_2_STATUSES: OrderStatus[] = ["dispatched", "deposit", "in_transit", "to_be_returned"];
const MAX_NOTE_LENGTH = 500;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { note?: unknown };
  try {
    body = (await req.json()) as { note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawNote = typeof body.note === "string" ? body.note.trim() : "";
  if (!rawNote) {
    return NextResponse.json({ error: "Note is required" }, { status: 400 });
  }
  const note = rawNote.slice(0, MAX_NOTE_LENGTH);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, market_id, status")
    .eq("id", params.id)
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  type OrderRow = { id: string; market_id: string; status: OrderStatus };
  const typed = order as OrderRow;

  if (actor.role === "market_manager" && typed.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!PHASE_2_STATUSES.includes(typed.status)) {
    return NextResponse.json(
      { error: "Order is not in a fulfillment stage" },
      { status: 409 },
    );
  }

  const { error: historyErr } = await supabase.from("order_history").insert({
    order_id: typed.id,
    status_from: typed.status,
    status_to: typed.status,
    actor_id: actor.id,
    actor_type: "manager",
    note: `[escalation] ${note}`,
  });

  if (historyErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { error: updateErr } = await supabase
    .from("orders")
    .update({ needs_carrier_followup: true })
    .eq("id", typed.id);

  if (updateErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
