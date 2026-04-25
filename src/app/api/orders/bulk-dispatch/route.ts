import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { performDispatch } from "@/lib/carriers/perform-dispatch";

const MAX_BATCH = 200;

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_ids?: unknown; carrier_id?: unknown; extra?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Missing order_ids" }, { status: 400 });
  }
  if (orderIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Cannot dispatch more than ${MAX_BATCH} orders in one batch` },
      { status: 400 },
    );
  }

  const carrierId = body.carrier_id;
  if (typeof carrierId !== "string" || !carrierId) {
    return NextResponse.json({ error: "Missing carrier_id" }, { status: 400 });
  }

  const extra =
    body.extra && typeof body.extra === "object"
      ? (body.extra as Record<string, unknown>)
      : undefined;

  const succeeded: Array<{ order_id: string; tracking_number: string | null }> = [];
  const failed: Array<{ order_id: string; error: string; errorCode?: string }> = [];

  for (const rawId of orderIds) {
    if (typeof rawId !== "string" || !rawId) {
      failed.push({ order_id: String(rawId), error: "Invalid order_id" });
      continue;
    }
    const result = await performDispatch({
      orderId: rawId,
      carrierId,
      actorId: actor.id,
      extra,
    });
    if (result.ok) {
      succeeded.push({ order_id: rawId, tracking_number: result.trackingNumber });
    } else {
      failed.push({
        order_id: rawId,
        error: result.error,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      });
    }
  }

  return NextResponse.json({ succeeded, failed });
}
