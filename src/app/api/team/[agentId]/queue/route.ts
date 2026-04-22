import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortAgentQueue } from "@/lib/orders/queue-sort";
import { TERMINAL_STATUSES } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify target agent exists and is in the same market
  const { data: targetAgent, error: agentError } = await supabase
    .from("users")
    .select("id, market_id, role")
    .eq("id", agentId)
    .single();

  if (agentError || !targetAgent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (role !== "super_admin" && targetAgent.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Derive currency from market_id (no currency column on orders table)
  const MARKET_CURRENCY: Record<string, string> = {
    "00000000-0000-0000-0000-000000000001": "TND",
    "00000000-0000-0000-0000-000000000002": "LYD",
  };
  const currency = MARKET_CURRENCY[targetAgent.market_id ?? ""] ?? "TND";

  // Query orders assigned to this agent in non-terminal statuses
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, status, customer_name, customer_phone, customer_city, product_name, variant_label, total_price, quantity, callback_scheduled_at, created_at")
    .eq("assigned_to", agentId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);

  if (ordersError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ordersWithCurrency = (orders ?? []).map((o) => ({ ...o, currency }));
  return NextResponse.json({ data: sortAgentQueue(ordersWithCurrency) });
}
