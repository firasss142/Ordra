import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseDeliveryWorklist } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import { parseActionBody } from "@/lib/delivery/actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/orders/[id]/actions — log a call, a WhatsApp send or a
 * note on a parcel. Appends to delivery_actions through
 * record_delivery_action, which re-checks ownership, market and scope and
 * refuses any actor other than the session's own user. Never writes `orders`.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseDeliveryWorklist(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_order_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseActionBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const a = parsed.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_delivery_action", {
    p_order_id: params.id,
    p_action_type: a.action_type,
    p_channel: a.channel,
    p_outcome: a.outcome,
    p_note: a.note,
    p_next_action_at: a.next_action_at,
    p_template_key: a.template_key,
    p_actor_id: actor.id,
    p_actor_type: actor.role === "agent" ? "agent" : "manager",
  });

  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (error.code === "P0002") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (error.code === "22023" && error.message === "order_out_of_delivery_scope") {
      return NextResponse.json({ error: "out_of_scope" }, { status: 409 });
    }
    console.error("[api/delivery/actions] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
