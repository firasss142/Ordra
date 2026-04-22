import { describe, test, expect } from "vitest";
import { selectAgent } from "./auto-assignment";
import type {
  AssignableOrder,
  AvailableAgent,
  RoundRobinConfig,
  ProductBasedConfig,
  RegionBasedConfig,
} from "./auto-assignment-types";

function makeOrder(overrides: Partial<AssignableOrder> = {}): AssignableOrder {
  return {
    id: "order-1",
    market_id: "market-tn",
    product_id: "prod-1",
    customer_city: "Tunis",
    ...overrides,
  };
}

function makeAgent(id: string, queue_size = 0, last_action_at: string | null = null): AvailableAgent {
  return { id, queue_size, last_action_at };
}

// ============================================================
// round_robin
// ============================================================

describe("round_robin", () => {
  test("returns null when agents array is empty", () => {
    const result = selectAgent(makeOrder(), [], "round_robin", null);
    expect(result).toBeNull();
  });

  test("selects first agent when config is null (fresh start)", () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    const result = selectAgent(makeOrder(), agents, "round_robin", null);
    expect(result).not.toBeNull();
    expect(result!.agent_id).toBe("a");
  });

  test("selects next agent after last_assigned_index", () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    const config: RoundRobinConfig = { last_assigned_index: 0 };
    const result = selectAgent(makeOrder(), agents, "round_robin", config);
    expect(result!.agent_id).toBe("b");
  });

  test("wraps around to first agent after last", () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    const config: RoundRobinConfig = { last_assigned_index: 2 };
    const result = selectAgent(makeOrder(), agents, "round_robin", config);
    expect(result!.agent_id).toBe("a");
  });

  test("single agent always returns that agent", () => {
    const agents = [makeAgent("only-one")];
    const config: RoundRobinConfig = { last_assigned_index: 0 };
    const result = selectAgent(makeOrder(), agents, "round_robin", config);
    expect(result!.agent_id).toBe("only-one");
  });

  test("updates last_assigned_index in returned config", () => {
    const agents = [makeAgent("a"), makeAgent("b")];
    const result = selectAgent(makeOrder(), agents, "round_robin", null);
    expect((result!.updated_config as RoundRobinConfig).last_assigned_index).toBe(0);

    const result2 = selectAgent(makeOrder(), agents, "round_robin", result!.updated_config);
    expect((result2!.updated_config as RoundRobinConfig).last_assigned_index).toBe(1);
  });

  test("sorts agents by id for determinism regardless of input order", () => {
    const agents = [makeAgent("c"), makeAgent("a"), makeAgent("b")];
    const result = selectAgent(makeOrder(), agents, "round_robin", null);
    // Sorted: a, b, c — first is "a"
    expect(result!.agent_id).toBe("a");
  });
});

// ============================================================
// workload
// ============================================================

describe("workload", () => {
  test("returns null when agents array is empty", () => {
    const result = selectAgent(makeOrder(), [], "workload", null);
    expect(result).toBeNull();
  });

  test("selects agent with lowest queue_size", () => {
    const agents = [
      makeAgent("busy", 5),
      makeAgent("idle", 1),
      makeAgent("medium", 3),
    ];
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.agent_id).toBe("idle");
  });

  test("breaks tie by oldest last_action_at", () => {
    const agents = [
      makeAgent("recent", 2, "2026-04-13T12:00:00Z"),
      makeAgent("older", 2, "2026-04-13T10:00:00Z"),
    ];
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.agent_id).toBe("older");
  });

  test("prefers null last_action_at (never acted) over any timestamp", () => {
    const agents = [
      makeAgent("has-activity", 2, "2026-04-13T10:00:00Z"),
      makeAgent("never-acted", 2, null),
    ];
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.agent_id).toBe("never-acted");
  });

  test("breaks all-null-last_action_at tie by agent id", () => {
    const agents = [
      makeAgent("z-agent", 0, null),
      makeAgent("a-agent", 0, null),
    ];
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.agent_id).toBe("a-agent");
  });

  test("returns null updated_config (stateless)", () => {
    const agents = [makeAgent("a", 1)];
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.updated_config).toBeNull();
  });
});

// ============================================================
// product_based
// ============================================================

describe("product_based", () => {
  const config: ProductBasedConfig = {
    product_rules: [
      { product_id: "prod-1", agent_ids: ["agent-a", "agent-b"], last_assigned_index: -1 },
      { product_id: "prod-2", agent_ids: ["agent-c"], last_assigned_index: -1 },
    ],
  };

  test("matches order product_id to rule and selects agent", () => {
    const agents = [makeAgent("agent-a", 2), makeAgent("agent-b", 3), makeAgent("agent-c", 0)];
    const result = selectAgent(makeOrder({ product_id: "prod-1" }), agents, "product_based", config);
    expect(result!.agent_id).toBe("agent-a");
  });

  test("round-robins within a matched product rule", () => {
    const agents = [makeAgent("agent-a", 2), makeAgent("agent-b", 3)];
    const configWithIndex: ProductBasedConfig = {
      product_rules: [
        { product_id: "prod-1", agent_ids: ["agent-a", "agent-b"], last_assigned_index: 0 },
      ],
    };
    const result = selectAgent(makeOrder({ product_id: "prod-1" }), agents, "product_based", configWithIndex);
    expect(result!.agent_id).toBe("agent-b");
  });

  test("falls back to workload when no rule matches", () => {
    const agents = [makeAgent("agent-a", 5), makeAgent("agent-b", 1)];
    const result = selectAgent(makeOrder({ product_id: "prod-unknown" }), agents, "product_based", config);
    // Workload picks least loaded = agent-b
    expect(result!.agent_id).toBe("agent-b");
  });

  test("falls back to workload when order product_id is null", () => {
    const agents = [makeAgent("agent-a", 5), makeAgent("agent-b", 1)];
    const result = selectAgent(makeOrder({ product_id: null }), agents, "product_based", config);
    expect(result!.agent_id).toBe("agent-b");
  });

  test("filters out inactive agents (not in agents list) from rule", () => {
    // Only agent-b is in the available agents list
    const agents = [makeAgent("agent-b", 2)];
    const result = selectAgent(makeOrder({ product_id: "prod-1" }), agents, "product_based", config);
    expect(result!.agent_id).toBe("agent-b");
  });

  test("falls back to workload when all agents in matched rule are inactive", () => {
    // Neither agent-a nor agent-b are available; agent-x is
    const agents = [makeAgent("agent-x", 1)];
    const result = selectAgent(makeOrder({ product_id: "prod-1" }), agents, "product_based", config);
    expect(result!.agent_id).toBe("agent-x");
  });

  test("updates last_assigned_index only for matched rule", () => {
    const agents = [makeAgent("agent-a", 2), makeAgent("agent-b", 3), makeAgent("agent-c", 0)];
    const result = selectAgent(makeOrder({ product_id: "prod-1" }), agents, "product_based", config);
    const updatedConfig = result!.updated_config as ProductBasedConfig;
    expect(updatedConfig.product_rules[0].last_assigned_index).toBe(0);
    // Other rule unchanged
    expect(updatedConfig.product_rules[1].last_assigned_index).toBe(-1);
  });
});

// ============================================================
// region_based
// ============================================================

describe("region_based", () => {
  const config: RegionBasedConfig = {
    region_rules: [
      { cities: ["Tunis", "Ariana", "Ben Arous"], agent_ids: ["agent-north-a", "agent-north-b"], last_assigned_index: -1 },
      { cities: ["Sfax", "Sousse"], agent_ids: ["agent-south"], last_assigned_index: -1 },
    ],
  };

  test("matches order customer_city case-insensitively", () => {
    const agents = [makeAgent("agent-north-a", 1), makeAgent("agent-north-b", 2)];
    const result = selectAgent(makeOrder({ customer_city: "tunis" }), agents, "region_based", config);
    expect(result!.agent_id).toBe("agent-north-a");
  });

  test("round-robins within a matched region rule", () => {
    const agents = [makeAgent("agent-north-a", 1), makeAgent("agent-north-b", 2)];
    const configWithIndex: RegionBasedConfig = {
      region_rules: [
        { cities: ["Tunis"], agent_ids: ["agent-north-a", "agent-north-b"], last_assigned_index: 0 },
      ],
    };
    const result = selectAgent(makeOrder({ customer_city: "Tunis" }), agents, "region_based", configWithIndex);
    expect(result!.agent_id).toBe("agent-north-b");
  });

  test("falls back to workload when no rule matches", () => {
    const agents = [makeAgent("agent-a", 5), makeAgent("agent-b", 1)];
    const result = selectAgent(makeOrder({ customer_city: "Bizerte" }), agents, "region_based", config);
    expect(result!.agent_id).toBe("agent-b");
  });

  test("falls back to workload when order customer_city is null", () => {
    const agents = [makeAgent("agent-a", 5), makeAgent("agent-b", 1)];
    const result = selectAgent(makeOrder({ customer_city: null }), agents, "region_based", config);
    expect(result!.agent_id).toBe("agent-b");
  });

  test("filters out inactive agents from rule", () => {
    const agents = [makeAgent("agent-north-b", 2)];
    const result = selectAgent(makeOrder({ customer_city: "Tunis" }), agents, "region_based", config);
    expect(result!.agent_id).toBe("agent-north-b");
  });

  test("falls back to workload when all agents in matched rule are inactive", () => {
    const agents = [makeAgent("agent-fallback", 0)];
    const result = selectAgent(makeOrder({ customer_city: "Tunis" }), agents, "region_based", config);
    expect(result!.agent_id).toBe("agent-fallback");
  });
});

// ============================================================
// selectAgent dispatch
// ============================================================

describe("selectAgent dispatch", () => {
  test("returns null for manual algorithm", () => {
    const agents = [makeAgent("a")];
    const result = selectAgent(makeOrder(), agents, "manual", null);
    expect(result).toBeNull();
  });

  test("delegates to correct algorithm function", () => {
    const agents = [makeAgent("a", 5), makeAgent("b", 1)];
    // workload should pick least loaded
    const result = selectAgent(makeOrder(), agents, "workload", null);
    expect(result!.agent_id).toBe("b");
  });
});
