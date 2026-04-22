import type { AssignmentAlgorithm } from "@/types/settings";
import type {
  AssignableOrder,
  AvailableAgent,
  AssignmentConfig,
  AssignmentDecision,
  RoundRobinConfig,
  ProductBasedConfig,
  RegionBasedConfig,
} from "./auto-assignment-types";

export function selectAgent(
  order: AssignableOrder,
  agents: AvailableAgent[],
  algorithm: AssignmentAlgorithm,
  config: AssignmentConfig
): AssignmentDecision | null {
  if (agents.length === 0 || algorithm === "manual") return null;

  switch (algorithm) {
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
