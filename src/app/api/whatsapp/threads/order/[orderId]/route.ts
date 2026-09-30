import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadThread } from "@/lib/whatsapp/thread";

/**
 * GET /api/whatsapp/threads/order/[orderId] — the Messages tab of the order
 * panel. Visibility is the user client's (RLS on `orders`); an agent must
 * also own the order. The thread is the whole conversation of the customer's
 * number in this market, not only this order's messages.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { orderId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "agent" && actor.role !== "market_manager" && actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await createClient();
  const { data: order, error } = await user
    .from("orders")
    .select("id, market_id, assigned_to, customer_id, customer_phone, customer_phone_2")
    .eq("id", params.orderId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (actor.role === "agent" && order.assigned_to !== actor.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await loadThread(createAdminClient(), {
    marketId: order.market_id as string,
    phones: [order.customer_phone as string | null, order.customer_phone_2 as string | null],
    customerId: (order.customer_id as string | null) ?? null,
  });
  return NextResponse.json({ data });
}
