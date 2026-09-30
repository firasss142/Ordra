import type { AssignmentAlgorithm } from "@/types/settings";
import type {
  AssignableOrder,
  AvailableAgent,
  AssignmentConfig,
  AssignmentContext,
  AssignmentDecision,
  RoundRobinConfig,
  ProductBasedConfig,
  RegionBasedConfig,
} from "./auto-assignment-types";
import { isReadyForOrders } from "./agent-readiness";

export function selectAgent(
  order: AssignableOrder,
  agents: AvailableAgent[],
  algorithm: AssignmentAlgorithm,
  config: AssignmentConfig,
  context?: AssignmentContext,
  now: Date = new Date()
): AssignmentDecision | null {
  if (agents.length === 0 || algorithm === "manual") return null;

  switch (algorithm) {
    case "percentage":
      return selectByPercentage(agents, context, now);
    case "round_robin":
      return selectRoundRobin(agents, config as RoundRobinConfig | null);
    case "workload":
      return selectByWorkload(agents);
    case "product_based":
      return selectByProduct(order, agents, config as ProductBasedConfig | null);
    case "region_based":
      return selectByRegion(order, agents, config as RegionBasedConfig | null);
    default:
      return null;
  }
}

function selectRoundRobin(
  agents: AvailableAgent[],
  config: RoundRobinConfig | null
): AssignmentDecision | null {
  const sorted = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const lastIndex = config?.last_assigned_index ?? -1;
  const nextIndex = (lastIndex + 1) % sorted.length;

  return {
    agent_id: sorted[nextIndex].id,
    updated_config: { last_assigned_index: nextIndex },
  };
}

function selectByWorkload(agents: AvailableAgent[]): AssignmentDecision | null {
  const sorted = [...agents].sort((a, b) => {
    // Primary: lowest queue_size
    if (a.queue_size !== b.queue_size) return a.queue_size - b.queue_size;
    // Secondary: oldest last_action_at (null = most idle, preferred)
    if (a.last_action_at === null && b.last_action_at !== null) return -1;
    if (a.last_action_at !== null && b.last_action_at === null) return 1;
    if (a.last_action_at !== null && b.last_action_at !== null) {
      const cmp = a.last_action_at.localeCompare(b.last_action_at);
      if (cmp !== 0) return cmp;
    }
    // Final tiebreaker: id
    return a.id.localeCompare(b.id);
  });

  return { agent_id: sorted[0].id, updated_config: null };
}

function selectByProduct(
  order: AssignableOrder,
  agents: AvailableAgent[],
  config: ProductBasedConfig | null
): AssignmentDecision | null {
  if (!order.product_id || !config?.product_rules) {
    return selectByWorkload(agents);
  }

  const agentIdSet = new Set(agents.map((a) => a.id));
  const ruleIndex = config.product_rules.findIndex(
    (r) => r.product_id === order.product_id
  );

  if (ruleIndex === -1) return selectByWorkload(agents);

  const rule = config.product_rules[ruleIndex];
  const activeRuleAgents = rule.agent_ids.filter((id) => agentIdSet.has(id));

  if (activeRuleAgents.length === 0) return selectByWorkload(agents);

  const lastIndex = rule.last_assigned_index ?? -1;
  const nextIndex = (lastIndex + 1) % activeRuleAgents.length;

  const updatedRules = [...config.product_rules];
  updatedRules[ruleIndex] = { ...rule, last_assigned_index: nextIndex };

  return {
    agent_id: activeRuleAgents[nextIndex],
    updated_config: { product_rules: updatedRules },
  };
}

function selectByRegion(
  order: AssignableOrder,
  agents: AvailableAgent[],
  config: RegionBasedConfig | null
): AssignmentDecision | null {
  if (!order.customer_city || !config?.region_rules) {
    return selectByWorkload(agents);
  }

  const agentIdSet = new Set(agents.map((a) => a.id));
  const cityLower = order.customer_city.toLowerCase();
  const ruleIndex = config.region_rules.findIndex((r) =>
    r.cities.some((c) => c.toLowerCase() === cityLower)
  );

  if (ruleIndex === -1) return selectByWorkload(agents);

  const rule = config.region_rules[ruleIndex];
  const activeRuleAgents = rule.agent_ids.filter((id) => agentIdSet.has(id));

  if (activeRuleAgents.length === 0) return selectByWorkload(agents);

  const lastIndex = rule.last_assigned_index ?? -1;
  const nextIndex = (lastIndex + 1) % activeRuleAgents.length;

  const updatedRules = [...config.region_rules];
  updatedRules[ruleIndex] = { ...rule, last_assigned_index: nextIndex };

  return {
    agent_id: activeRuleAgents[nextIndex],
    updated_config: { region_rules: updatedRules },
  };
}

/**
 * Strict daily quota: hand the next order to the ready agent furthest behind
 * their absolute target.
 *
 *   D        = orders assigned today across the whole market, ready or not
 *   target_i = share_i / 100 x (D + 1)
 *   winner   = argmax over ready agents of (target_i - assigned_today_i)
 *
 * Shares are ABSOLUTE, never renormalised over whoever happens to be ready.
 * That is the difference between this and pro-rata redistribution: when an
 * agent is away their orders are absorbed by the people working (pushing them
 * past their own targets), and the absent agent's deficit is repaid on return.
 * It is also why the shares must total 100 - with absolute targets a column
 * summing to 80 under-covers the day.
 *
 * The function is STATELESS: `updated_config` is null because `assigned_today`
 * is read from `orders` rather than carried in a cursor. Two concurrent
 * webhooks can therefore overshoot by at most one order, which the next call
 * corrects, where round_robin's stored `last_assigned_index` drifts forever.
 * Do not "optimise" this into a counter.
 *
 * Unlike product_based and region_based it never falls back to
 * selectByWorkload. Spreading by workload while the UI claims a percentage
 * split would be a lie that looks like it is working.
 */
function selectByPercentage(
  agents: AvailableAgent[],
  context: AssignmentContext | undefined,
  now: Date
): AssignmentDecision | null {
  const shares = context?.shares;
  if (!shares) return null;

  const total = context?.totalAssignedToday ?? 0;

  const candidates = agents.filter(
    (a) => (shares[a.id] ?? 0) > 0 && isReadyForOrders(a, now)
  );
  if (candidates.length === 0) return null;

  const deficitOf = (a: AvailableAgent): number =>
    ((shares[a.id] ?? 0) / 100) * (total + 1) - a.assigned_today;

  // Floats: 0.1 + 0.2 style error would otherwise make the tie-break
  // unreachable and the winner depend on array order.
  const EPSILON = 1e-9;

  let best = candidates[0];
  let bestDeficit = deficitOf(best);

  for (let i = 1; i < candidates.length; i++) {
    const contender = candidates[i];
    const deficit = deficitOf(contender);

    if (deficit > bestDeficit + EPSILON) {
      best = contender;
      bestDeficit = deficit;
      continue;
    }
    if (deficit < bestDeficit - EPSILON) continue;

    // Tied on deficit - the fresh-day case, where everyone sits at zero.
    // Largest share first so the big agent leads; then the shorter queue;
    // then the id, so two replicas deciding at once agree.
    const contenderShare = shares[contender.id] ?? 0;
    const bestShare = shares[best.id] ?? 0;
    if (contenderShare !== bestShare) {
      if (contenderShare > bestShare) {
        best = contender;
        bestDeficit = deficit;
      }
      continue;
    }
    if (contender.queue_size !== best.queue_size) {
      if (contender.queue_size < best.queue_size) {
        best = contender;
        bestDeficit = deficit;
      }
      continue;
    }
    if (contender.id.localeCompare(best.id) < 0) {
      best = contender;
      bestDeficit = deficit;
    }
  }

  return { agent_id: best.id, updated_config: null };
}

/** One order placed with one agent. */
export interface PlannedAssignment {
  order_id: string;
  agent_id: string;
}

export interface AssignmentPlan {
  assignments: PlannedAssignment[];
  /** The cursor to store back. Never null unless it genuinely started null. */
  updated_config: AssignmentConfig;
  /** Order ids nobody could take. Surfaced, never silently dropped. */
  leftover: string[];
}

/**
 * Place a whole batch — the pool drain, and the manager's bulk button.
 *
 * Pure, and it does not touch the caller's `agents`: the preview a manager
 * confirms and the write that follows run this same function over the same
 * input, so they cannot disagree. Same contract as
 * `lib/prospects/distribution.ts`.
 *
 * Two mistakes it exists to prevent, both live in the old bulk route:
 *
 *  1. Feeding the next iteration by bumping `queue_size` alone. A deficit
 *     selector reads `assigned_today`, which never moved, so the whole batch
 *     landed on one agent. Here every counter the engine can read moves.
 *  2. Writing `decision.updated_config` back unconditionally. A stateless
 *     selector returns null, so a single `workload` run overwrote
 *     `assignment_rules.config` with null and destroyed the stored
 *     round-robin / product / region cursor. Here null means "nothing to
 *     store", and the incoming config is preserved.
 */
export function planAssignments(
  orders: AssignableOrder[],
  agents: AvailableAgent[],
  algorithm: AssignmentAlgorithm,
  config: AssignmentConfig,
  context?: AssignmentContext,
  now: Date = new Date()
): AssignmentPlan {
  // Copies: planning must leave the caller's roster untouched.
  const roster = agents.map((a) => ({ ...a }));
  const assignments: PlannedAssignment[] = [];
  const leftover: string[] = [];

  let runningConfig = config;
  let runningTotal = context?.totalAssignedToday ?? 0;

  for (const order of orders) {
    const runningContext: AssignmentContext | undefined = context
      ? { ...context, totalAssignedToday: runningTotal }
      : undefined;

    const decision = selectAgent(order, roster, algorithm, runningConfig, runningContext, now);

    if (!decision) {
      leftover.push(order.id);
      continue;
    }

    assignments.push({ order_id: order.id, agent_id: decision.agent_id });

    const winner = roster.find((a) => a.id === decision.agent_id);
    if (winner) {
      winner.queue_size += 1;
      winner.assigned_today += 1;
    }
    runningTotal += 1;

    // Only a cursor-carrying algorithm has anything to store. See (2) above.
    if (decision.updated_config !== null) {
      runningConfig = decision.updated_config;
    }
  }

  return { assignments, updated_config: runningConfig, leftover };
}
