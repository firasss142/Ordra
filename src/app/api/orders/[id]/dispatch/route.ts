import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { performDispatch } from "@/lib/carriers/perform-dispatch";
import { enrichRowsWithDuplicates } from "@/lib/duplicate-orders/detect";

export const dynamic = "force-dynamic";

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
    .select(
      "id, status, assigned_to, market_id, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at",
    )
    .eq("id", id)
    .single();

  if (orderError || !order) {
    console.error("[POST /api/orders/[id]/dispatch] order lookup failed", {
      id,
      actor_role: actor.role,
      actor_id: actor.id,
      code: orderError?.code,
      message: orderError?.message,
    });
    return NextResponse.json(
      {
        error: "Order not found",
        debug: {
          reason: "lookup_failed",
          actor_role: actor.role,
          db_code: orderError?.code ?? null,
          db_message: orderError?.message ?? null,
        },
      },
      { status: 404 },
    );
  }

  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    console.error("[POST /api/orders/[id]/dispatch] agent does not own order", {
      id,
      actor_id: actor.id,
      assigned_to: order.assigned_to,
    });
    return NextResponse.json(
      {
        error: "Order not found",
        debug: {
          reason: "not_assigned_to_agent",
          actor_role: actor.role,
        },
      },
      { status: 404 },
    );
  }

  if (order.status !== "confirmed" && order.status !== "dispatch_scheduled") {
    return NextResponse.json(
      { error: "Order must be confirmed (or dispatch_scheduled) to upload to carrier" },
      { status: 400 }
    );
  }

  // Duplicate-order guard (server-authoritative): if a sibling order (same
  // customer + product + qty within 24h) is ALREADY shipped to the carrier,
  // uploading this one risks shipping the same order twice. We warn rather than
  // block — the agent re-POSTs with confirm_duplicate to proceed. The client's
  // enrichment flag can be stale, so this re-checks at the moment of upload.
  if (body.confirm_duplicate !== true) {
    const [dup] = await enrichRowsWithDuplicates(
      supabase,
      (order.market_id as string) ?? null,
      [order as { id: string } & Record<string, unknown>],
    );
    if (dup.has_uploaded_sibling) {
      const shipped = dup.duplicate_siblings.find((s) => s.already_shipped)!;
      return NextResponse.json(
        {
          error: "duplicate_confirmation_required",
          needsConfirmation: true,
          duplicate: {
            id: shipped.id,
            external_id: shipped.external_id,
            status: shipped.status,
          },
        },
        { status: 409 },
      );
    }
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
