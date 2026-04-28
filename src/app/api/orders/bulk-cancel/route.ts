import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canCancelOrder } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

const TERMINAL = new Set(["delivered", "returned", "rejected", "deleted", "cancelled"]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  if (!canCancelOrder(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_ids, note } = body;
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return NextResponse.json({ error: "order_ids is required and must be non-empty" }, { status: 400 });
  }

  // Verify ownership and cancelability
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, market_id, status")
    .in("id", order_ids as string[]);

  if (fetchError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  if (role !== "super_admin") {
    const wrongMarket = (orders ?? []).find((o: { market_id: string }) => o.market_id !== actorMarketId);
    if (wrongMarket) {
      return NextResponse.json({ error: "All orders must belong to your market" }, { status: 400 });
    }
  }

  const nonCancellable = (orders ?? []).filter((o: { status: string }) => TERMINAL.has(o.status));
  if (nonCancellable.length > 0) {
    return NextResponse.json(
      { error: `${nonCancellable.length} order(s) are in terminal status and cannot be cancelled` },
      { status: 422 }
    );
  }

  // Transactional cancel via RPC
  const { error: rpcError } = await supabase.rpc("bulk_cancel_orders", {
    p_order_ids: order_ids as string[],
    p_actor_id: actor.id,
    p_note: typeof note === "string" ? note.trim() : null,
  });

  if (rpcError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: { cancelled: order_ids.length } });
}
