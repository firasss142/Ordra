import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canRecoverDeletedOrder } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface RecoverOrderRow {
  id: string;
  status: string;
  market_id: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, market_id")
    .eq("id", id)
    .single<RecoverOrderRow>();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const actorMarketId = actor.market_id ?? "";
  if (!canRecoverDeletedOrder(actor.role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.status !== "deleted") {
    return NextResponse.json(
      { error: `Order is not deleted (status '${order.status}')` },
      { status: 400 },
    );
  }

  let note: string | undefined;
  try {
    const body = await req.json();
    note = body.note as string | undefined;
  } catch {
    // Note is optional.
  }

  const { data, error } = await supabase.rpc("recover_deleted_order", {
    p_order_id: id,
    p_actor_id: actor.id,
    p_note: note?.trim() || "Commande restaurée",
  });

  if (error) {
    // 23514 = check_violation: order not deleted, or was scanned at deletion
    // (stock already restored — recovery would desync). Surface as 409 so the
    // client can show a clear "cannot recover" message.
    if (error.code === "23514") {
      return NextResponse.json(
        { error: error.message, reason: "not_recoverable" },
        { status: 409 },
      );
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      order: { id, status: "pending" },
      result: data,
    },
  });
}
