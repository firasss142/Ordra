import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { OrderStatus } from "@/types/order-status";

const NEXT_ATTEMPT: Record<string, OrderStatus> = {
  assigned: "attempt_1",
  attempt_1: "attempt_2",
  attempt_2: "attempt_3",
  callback_scheduled: "attempt_1", // fallback; client should send explicit next_attempt
};

function getNextAttempt(
  currentStatus: string,
  explicitNext?: string
): OrderStatus | null {
  if (explicitNext && ["attempt_1", "attempt_2", "attempt_3"].includes(explicitNext)) {
    return explicitNext as OrderStatus;
  }
  return NEXT_ATTEMPT[currentStatus] ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is OK
  }

  const nextAttempt = getNextAttempt(
    order.status,
    body.next_attempt as string | undefined
  );

  if (!nextAttempt) {
    return NextResponse.json(
      { error: "Cannot record no-response for current status: " + order.status },
      { status: 400 }
    );
  }

  const callbackAt = body.callback_at as string | undefined;

  const { data, error } = await supabase.rpc("no_response_with_auto_reject", {
    p_order_id: id,
    p_next_attempt: nextAttempt,
    p_callback_at: callbackAt ?? null,
    p_actor_id: actor.id,
  });

  if (error) {
    if (error.message?.includes("invalid transition")) {
      return NextResponse.json({ error: "Invalid transition" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({ data: row });
}
