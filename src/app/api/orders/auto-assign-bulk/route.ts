import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { fetchAgentCapacity } from "@/lib/orders/agent-capacity";
import { planAssignments } from "@/lib/orders/auto-assignment";
import { isReadyForOrders } from "@/lib/orders/agent-readiness";
import {
  buildPercentageContext,
  fetchAgentShares,
} from "@/lib/orders/auto-assignment-orchestrator";
import type { AssignmentAlgorithm } from "@/types/settings";
import type { AssignmentConfig } from "@/lib/orders/auto-assignment-types";

export const dynamic = "force-dynamic";

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

  const allAgents = await fetchAgentCapacity(supabase, marketId);

  // Readiness gates every algorithm, the bulk button included: a manager
  // pressing "auto-assigner" should not scatter work across people who have
  // not said they are working. Manual single assignment is the escape hatch
  // for handing an order to a specific person regardless.
  const now = new Date();
  const agents = allAgents.filter((a) => isReadyForOrders(a, now));

  const assigned: AssignedEntry[] = [];
  const skipped: SkippedEntry[] = [];

  type OrderRow = {
    id: string;
    market_id: string;
    product_id: string | null;
    customer_city: string | null;
    status: string;
    assigned_to: string | null;
  };

  // An order someone already took is not a candidate; report it and keep it
  // out of the plan so it cannot consume another agent's share.
  //
  // This partition runs BEFORE the no-agents check on purpose. The other way
  // round, an order that was already assigned came back as `no_agents`, which
  // is not why it was skipped — and "why did this order not get assigned" is
  // exactly the question this endpoint has to answer honestly.
  const placeable: OrderRow[] = [];
  for (const order of orders as OrderRow[]) {
    if (order.status !== "pending" || order.assigned_to !== null) {
      skipped.push({ order_id: order.id, reason: "already_assigned" });
      continue;
    }
    placeable.push(order);
  }

  if (agents.length === 0) {
    for (const order of placeable) {
      skipped.push({ order_id: order.id, reason: "no_agents" });
    }
    return NextResponse.json({ data: { assigned, skipped } });
  }

  const context =
    algorithm === "percentage"
      ? buildPercentageContext(allAgents, await fetchAgentShares(supabase, marketId))
      : undefined;

  // planAssignments carries BOTH counters forward between orders. The loop
  // this replaced advanced queue_size only, so a deficit-based algorithm read
  // the same assigned_today every iteration and put the whole batch on one
  // agent.
  const plan = planAssignments(
    placeable.map((o) => ({
      id: o.id,
      market_id: o.market_id,
      product_id: o.product_id,
      customer_city: o.customer_city,
    })),
    agents,
    algorithm,
    (ruleRow.config ?? null) as AssignmentConfig,
    context,
    now
  );

  for (const orderId of plan.leftover) {
    skipped.push({ order_id: orderId, reason: "no_agents" });
  }

  for (const entry of plan.assignments) {
    const { error: rpcErr } = await supabase.rpc("assign_order", {
      p_order_id: entry.order_id,
      p_agent_id: entry.agent_id,
      p_actor_id: actor.id,
      p_actor_type: "manager",
    });

    if (rpcErr) {
      skipped.push({ order_id: entry.order_id, reason: "error" });
      continue;
    }

    assigned.push({ order_id: entry.order_id, agent_id: entry.agent_id });
  }

  // Persist the cursor once, and only when the algorithm actually keeps one.
  // This used to write `decision.updated_config` unconditionally, so a single
  // `workload` run — which is stateless and returns null — overwrote
  // assignment_rules.config with null and destroyed the stored round-robin,
  // product or region cursor.
  if (plan.updated_config !== null && plan.updated_config !== ruleRow.config) {
    await supabase
      .from("assignment_rules")
      .update({ config: plan.updated_config })
      .eq("market_id", marketId);
  }

  return NextResponse.json({ data: { assigned, skipped } });
}
