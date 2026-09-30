import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

/**
 * Distribute the unassigned pool across everyone who is currently ready.
 *
 * Fired right after an agent declares themselves ready — that is what makes
 * the toggle feel like "give me work". It is deliberately NOT part of
 * `set_agent_availability`: the toggle has to return in milliseconds, and
 * bundling a 500-order redistribution would make its latency a function of
 * pool size and every simultaneous toggle a lock contender.
 *
 * It drains to ALL ready agents, not only the one who just arrived. Under a
 * strict daily quota the person who just came back usually has the largest
 * deficit and takes most of it, but if a colleague is also behind, the split
 * honours that — which is the whole point of having configured one.
 *
 * `?preview=1` plans without writing. Preview and write run the same
 * `planAssignments` over the same input, so what an agent is shown is what
 * happens.
 */

/** A drain is a burst; keep one request bounded and let the next one continue. */
const MAX_DRAIN = 500;

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // A manager's own market always wins over whatever the caller claims.
  const url = new URL(req.url);
  const marketId =
    actor.role === "super_admin" ? url.searchParams.get("market_id") : actor.market_id;

  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const preview = url.searchParams.get("preview") === "1";
  const supabase = await createClient();

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

  // Two storage shapes in the wild: `{ value }` from the settings PATCH,
  // `{ type }` from PUT /api/assignment-rules.
  const algorithmValue = settingsRow?.value as { type?: string; value?: string } | undefined;
  const algorithm = (algorithmValue?.type ?? algorithmValue?.value) as
    | AssignmentAlgorithm
    | undefined;

  // Each refusal names itself. "Why did nothing get assigned" has to be
  // answerable from the response — between the algorithm setting, the rule's
  // is_active flag on a different page, and readiness, there are three ways to
  // get silence.
  if (!algorithm || algorithm === "manual") {
    return NextResponse.json({ data: emptyResult("manual") });
  }
  if (!ruleRow || !ruleRow.is_active) {
    return NextResponse.json({ data: emptyResult("algorithm_inactive") });
  }

  const allAgents = await fetchAgentCapacity(supabase, marketId);
  const now = new Date();
  const agents = allAgents.filter((a) => isReadyForOrders(a, now));

  if (agents.length === 0) {
    return NextResponse.json({ data: emptyResult("no_ready_agents") });
  }

  const { data: poolRows, error: poolErr } = await supabase
    .from("orders")
    .select("id, market_id, product_id, customer_city")
    .eq("market_id", marketId)
    .eq("status", "pending")
    .is("assigned_to", null)
    .order("created_at", { ascending: true })
    .limit(MAX_DRAIN);

  if (poolErr) {
    console.error("[POST /api/agent/availability/drain] pool read failed", {
      code: poolErr.code,
      message: poolErr.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const pool = (poolRows ?? []) as Array<{
    id: string;
    market_id: string;
    product_id: string | null;
    customer_city: string | null;
  }>;

  if (pool.length === 0) {
    // An empty pool is a no-op, not an error.
    return NextResponse.json({ data: emptyResult("empty_pool") });
  }

  const context =
    algorithm === "percentage"
      ? buildPercentageContext(allAgents, await fetchAgentShares(supabase, marketId))
      : undefined;

  const plan = planAssignments(
    pool,
    agents,
    algorithm,
    (ruleRow.config ?? null) as AssignmentConfig,
    context,
    now,
  );

  if (preview) {
    return NextResponse.json({
      data: {
        reason: null,
        planned: plan.assignments.length,
        leftover: plan.leftover.length,
        by_agent: tallyByAgent(plan.assignments),
        assigned: 0,
        skipped: 0,
      },
    });
  }

  if (plan.assignments.length === 0) {
    return NextResponse.json({ data: emptyResult("no_shares") });
  }

  const { data: applied, error: applyErr } = await supabase.rpc("apply_pool_assignments", {
    p_market_id: marketId,
    p_assignments: plan.assignments,
    p_actor_id: actor.id,
    p_actor_type: actor.role === "agent" ? "agent" : "manager",
  });

  if (applyErr) {
    console.error("[POST /api/agent/availability/drain] apply failed", {
      code: applyErr.code,
      message: applyErr.message,
      details: applyErr.details,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // The database's answer overrides the plan: orders taken between planning
  // and writing are skipped there, not here.
  const result = (applied ?? {}) as { assigned?: number; skipped?: number };

  // A cursor-carrying algorithm still has to store its cursor after a batch.
  // Null means stateless — writing it back would erase another algorithm's.
  if (plan.updated_config !== null && plan.updated_config !== ruleRow.config) {
    await supabase
      .from("assignment_rules")
      .update({ config: plan.updated_config })
      .eq("market_id", marketId);
  }

  return NextResponse.json({
    data: {
      reason: null,
      planned: plan.assignments.length,
      leftover: plan.leftover.length,
      by_agent: tallyByAgent(plan.assignments),
      assigned: result.assigned ?? 0,
      skipped: result.skipped ?? 0,
    },
  });
}

type DrainReason =
  | "manual"
  | "algorithm_inactive"
  | "no_ready_agents"
  | "empty_pool"
  | "no_shares";

function emptyResult(reason: DrainReason) {
  return {
    reason,
    planned: 0,
    leftover: 0,
    by_agent: {} as Record<string, number>,
    assigned: 0,
    skipped: 0,
  };
}

function tallyByAgent(
  assignments: Array<{ agent_id: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) out[a.agent_id] = (out[a.agent_id] ?? 0) + 1;
  return out;
}
