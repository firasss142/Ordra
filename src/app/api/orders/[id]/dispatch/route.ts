import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { performDispatch } from "@/lib/carriers/perform-dispatch";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const carrierId = body.carrier_id as string;
  if (!carrierId) {
    return NextResponse.json(
      { error: "Missing carrier_id" },
      { status: 400 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "confirmed" && order.status !== "dispatch_scheduled") {
    return NextResponse.json(
      { error: "Order must be confirmed (or dispatch_scheduled) to upload to carrier" },
      { status: 400 }
    );
  }

  const extra = body.extra as Record<string, unknown> | undefined;

  const result = await performDispatch({
    orderId: id,
    carrierId,
    actorId: actor.id,
    extra,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        errorCode: result.errorCode,
        retryable: result.retryable,
      },
      { status: result.status }
    );
  }

  return NextResponse.json({
    data: {
      order_id: id,
      status: "uploaded",
      tracking_number: result.trackingNumber,
      ...(typeof result.dispatchData === "object" && result.dispatchData !== null
        ? result.dispatchData
        : {}),
    },
  });
}
