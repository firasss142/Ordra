import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { fetchAgentCapacity } from "@/lib/orders/agent-capacity";
import { selectAgent } from "@/lib/orders/auto-assignment";
import type { AssignmentAlgorithm } from "@/types/settings";
import type { AssignmentConfig } from "@/lib/orders/auto-assignment-types";

interface AssignedEntry {
  order_id: string;
  agent_id: string;
}
interface SkippedEntry {
  order_id: string;
  reason: "manual" | "no_agents" | "no_rule" | "not_found" | "already_assigned" | "error";
}

export async function POST(req: NextRequest) {
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

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "order_ids required" }, { status: 400 });
  }

  const actorMarketId = actor.market_id ?? "";
  if (!canAssignOrders(actor.role, actorMarketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load the target orders
  const { data: orderRows, error: ordersErr } = await supabase
    .from("orders")
    .select("id, market_id, product_id, customer_city, status, assigned_to")
    .in("id", orderIds as string[]);

  if (ordersErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const orders = orderRows ?? [];

  // Market safety: all orders must belong to actor's market (unless super_admin)
  if (actor.role !== "super_admin") {
    const wrongMarket = orders.find(
      (o: { market_id: string }) => o.market_id !== actorMarketId
    );
    if (wrongMarket) {
      return NextResponse.json(
        { error: "All orders must belong to your market" },
        { status: 400 }
      );
    }
  }

  // All orders should be in the same market for rule lookup
  const marketIds = new Set(orders.map((o: { market_id: string }) => o.market_id));
  if (marketIds.size !== 1) {
    return NextResponse.json(
      { error: "All orders must belong to the same market" },
      { status: 400 }
    );
  }
  const marketId = [...marketIds][0] as string;

  // Load algorithm from settings + rule
  const [{ data: settingsRow }, { data: ruleRow }] = await Promise.all([
    supabase
      .from("settings")
      .select("value")
      .eq("market_id", marketId)
      .eq("key", "assignment_algorithm")
      .maybeSingle(),
    supabase
      .from("assignment_rules")
      .select("algorithm, config, is_active")
      .eq("market_id", marketId)
      .maybeSingle(),
  ]);

  const algorithmValue = settingsRow?.value as { type?: string; value?: string } | undefined;
  const algorithm = (algorithmValue?.type ??
    algorithmValue?.value ??
    ruleRow?.algorithm) as AssignmentAlgorithm | undefined;

  if (!algorithm || algorithm === "manual" || !ruleRow?.is_active) {
    return NextResponse.json({
      data: {
        assigned: [] as AssignedEntry[],
        skipped: (orders as Array<{ id: string }>).map((o) => ({
          order_id: o.id,
          reason: "manual" as const,
        })),
      },
    });
  }

  const agents = await fetchAgentCapacity(supabase, marketId);
  if (agents.length === 0) {
    return NextResponse.json({
      data: {
        assigned: [] as AssignedEntry[],
        skipped: (orders as Array<{ id: string }>).map((o) => ({
          order_id: o.id,
          reason: "no_agents" as const,
        })),
      },
    });
  }

  const assigned: AssignedEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let runningConfig: AssignmentConfig = (ruleRow.config ?? null) as AssignmentConfig;

  for (const order of orders as Array<{
    id: string;
    market_id: string;
    product_id: string | null;
    customer_city: string | null;
    status: string;
    assigned_to: string | null;
  }>) {
    if (order.status !== "pending" || order.assigned_to !== null) {
      skipped.push({ order_id: order.id, reason: "already_assigned" });
      continue;
    }

    const decision = selectAgent(
      {
        id: order.id,
        market_id: order.market_id,
        product_id: order.product_id,
        customer_city: order.customer_city,
      },
      agents,
      algorithm,
      runningConfig
    );

    if (!decision) {
      skipped.push({ order_id: order.id, reason: "no_agents" });
      continue;
    }

    const { error: rpcErr } = await supabase.rpc("assign_order", {
      p_order_id: order.id,
      p_agent_id: decision.agent_id,
      p_actor_id: actor.id,
      p_actor_type: "manager",
    });

    if (rpcErr) {
      skipped.push({ order_id: order.id, reason: "error" });
      continue;
    }

    assigned.push({ order_id: order.id, agent_id: decision.agent_id });
    runningConfig = decision.updated_config;

    // Also update in-memory queue_size so next iteration considers it
    const agent = agents.find((a) => a.id === decision.agent_id);
    if (agent) agent.queue_size += 1;
  }

  // Persist final rule config once
  if (runningConfig !== ruleRow.config) {
    await supabase
      .from("assignment_rules")
      .update({ config: runningConfig })
      .eq("market_id", marketId);
  }

  return NextResponse.json({ data: { assigned, skipped } });
}
