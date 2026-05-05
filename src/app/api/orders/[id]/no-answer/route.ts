import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeNextRetrySlot } from "@/lib/orders/next-retry-slot";
import { getActor } from "@/lib/auth/actor";
import {
  actorTypeFor,
  loadTakeOverContext,
  logManagerTakeOver,
  type ManagerActor,
} from "@/lib/orders/manager-takeover";

async function readRetryTimes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  marketId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "attempt_retry_times")
    .maybeSingle();
  const value = (data?.value as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
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

  if (role !== "agent" && role !== "market_manager" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isManager = role !== "agent";
  let orderMarketId: string;

  if (isManager) {
    const ctx = await loadTakeOverContext(
      supabase,
      id,
      actor as ManagerActor,
    );
    if ("error" in ctx) {
      const status =
        ctx.error === "not_found" ? 404 : ctx.error === "forbidden" ? 403 : 400;
      const message =
        ctx.error === "terminal"
          ? "Order is in a terminal status"
          : ctx.error === "forbidden"
          ? "Forbidden"
          : "Order not found";
      return NextResponse.json({ error: message }, { status });
    }

    const { data: orderRow } = await supabase
      .from("orders")
      .select("status")
      .eq("id", id)
      .single();

    if (!orderRow) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await logManagerTakeOver(supabase, {
      orderId: id,
      orderStatus: orderRow.status,
      actor: actor as ManagerActor,
      originalAgentId: ctx.originalAgentId,
      originalAgentName: ctx.originalAgentName,
    });

    orderMarketId = ctx.orderMarketId;
  } else {
    // Agent path: pin to assigned_to
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, assigned_to, market_id")
      .eq("id", id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.assigned_to !== actor.id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    orderMarketId = order.market_id;
  }

  const retryTimes = await readRetryTimes(supabase, orderMarketId);
  let callbackAt: string;
  try {
    callbackAt = computeNextRetrySlot(new Date(), retryTimes).toISOString();
  } catch {
    callbackAt = computeNextRetrySlot(new Date(), []).toISOString();
  }

  const { data, error: rpcError } = await supabase.rpc("no_response_with_auto_reject", {
    p_order_id: id,
    p_next_attempt: "attempt_1",
    p_callback_at: callbackAt,
    p_actor_id: actor.id,
    p_actor_type: actorTypeFor(role),
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    data: {
      ...row,
      callback_at: callbackAt,
    },
  });
}
