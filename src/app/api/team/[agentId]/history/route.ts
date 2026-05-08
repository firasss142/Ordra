import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: targetAgent, error: agentError } = await supabase
    .from("users")
    .select("id, market_id")
    .eq("id", agentId)
    .single();

  if (agentError || !targetAgent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (actor.role !== "super_admin" && targetAgent.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30, 1), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from("order_history")
    .select("order_id, status_from, status_to, created_at, orders(customer_name, product_name)")
    .eq("actor_id", agentId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const data = (rows ?? []).map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    return {
      order_id: row.order_id,
      status_from: row.status_from,
      status_to: row.status_to,
      created_at: row.created_at,
      customer_name: (order as { customer_name?: string } | null)?.customer_name ?? null,
      product_name: (order as { product_name?: string } | null)?.product_name ?? null,
    };
  });

  return NextResponse.json({ data });
}
