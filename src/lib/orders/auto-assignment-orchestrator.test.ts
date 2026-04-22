import { describe, test, expect, vi } from "vitest";
import { tryAutoAssign } from "./auto-assignment-orchestrator";
import type { AssignableOrder } from "./auto-assignment-types";

function makeOrder(overrides: Partial<AssignableOrder> = {}): AssignableOrder {
  return {
    id: "order-1",
    market_id: "market-tn",
    product_id: "prod-1",
    customer_city: "Tunis",
    ...overrides,
  };
}

function createMockClient(options: {
  algorithmSetting?: Record<string, unknown> | null;
  activeAgentsOnlySetting?: boolean;
  assignmentRule?: { algorithm: string; config: unknown; is_active: boolean } | null;
  agentIds?: string[];
  orderAssignments?: Array<{ assigned_to: string | null }>;
  lastActions?: Array<{ actor_id: string | null; created_at: string }>;
  todayActions?: Array<{ actor_id: string }>;
  assignResult?: { data: unknown; error: unknown };
}) {
  const {
    algorithmSetting = { type: "manual" },
    activeAgentsOnlySetting = false,
    assignmentRule = { algorithm: "manual", config: null, is_active: true },
    agentIds = [],
    orderAssignments = [],
    lastActions = [],
    todayActions = [],
    assignResult = {
      data: { order_id: "order-1", status: "assigned", assigned_to: "a", updated_at: "t", history_id: "h" },
      error: null,
    },
  } = options;

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "settings") {
        // Distinguish by the key argument passed to the second .eq() call
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((_col: string, key: string) => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    key === "assignment_algorithm"
                      ? algorithmSetting
                        ? { value: algorithmSetting }
                        : null
                      : activeAgentsOnlySetting
                        ? { value: { value: true } }
                        : null,
                  error: null,
                }),
              })),
            }),
          }),
        };
      }

      if (table === "assignment_rules") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: assignmentRule,
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === "users") {
        // fetchActiveAgents queries users for just { id }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: agentIds.map((id) => ({ id })),
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "orders") {
        // queue size query
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: orderAssignments,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "order_history") {
        // Could be last_action_at query or today's actions query
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation((_col: string, values: string[]) => {
              // Check if this is the today's actions query (has status_to filter)
              return {
                in: vi.fn().mockReturnValue({
                  gte: vi.fn().mockResolvedValue({
                    data: todayActions,
                    error: null,
                  }),
                }),
                order: vi.fn().mockResolvedValue({
                  data: lastActions,
                  error: null,
                }),
              };
            }),
          }),
        };
      }

      // Fallback
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      };
    }),
    rpc: vi.fn().mockResolvedValue(assignResult),
  };

  return client as unknown as Parameters<typeof tryAutoAssign>[0];
}

describe("tryAutoAssign", () => {
  test("does nothing when algorithm is manual", async () => {
    const client = createMockClient({ algorithmSetting: { type: "manual" } });
    await tryAutoAssign(client, makeOrder());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("does nothing when settings row is missing", async () => {
    const client = createMockClient({ algorithmSetting: null });
    await tryAutoAssign(client, makeOrder());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("does nothing when assignment_rules is inactive", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "round_robin" },
      assignmentRule: { algorithm: "round_robin", config: null, is_active: false },
    });
    await tryAutoAssign(client, makeOrder());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("does nothing when assignment_rules row is missing", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "round_robin" },
      assignmentRule: null,
    });
    await tryAutoAssign(client, makeOrder());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("calls assign_order RPC with selected agent for round_robin", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "round_robin" },
      assignmentRule: { algorithm: "round_robin", config: { last_assigned_index: -1 }, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      orderAssignments: [
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
      ],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-a",
      p_actor_id: null,
      p_actor_type: "system",
      p_note: "Auto-assigned via Tour de rôle",
    });
  });

  test("calls assign_order RPC with least-loaded agent for workload", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      orderAssignments: [
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-b" },
      ],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith("assign_order", {
      p_order_id: "order-1",
      p_agent_id: "agent-b",
      p_actor_id: null,
      p_actor_type: "system",
      p_note: "Auto-assigned via Charge de travail",
    });
  });

  test("reads algorithm from { value: X } settings format (PATCH handler format)", async () => {
    const client = createMockClient({
      algorithmSetting: { value: "round_robin" },
      assignmentRule: { algorithm: "round_robin", config: { last_assigned_index: -1 }, is_active: true },
      agentIds: ["agent-a"],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith("assign_order", expect.objectContaining({
      p_agent_id: "agent-a",
    }));
  });

  test("does not throw when assign_order RPC fails", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "round_robin" },
      assignmentRule: { algorithm: "round_robin", config: null, is_active: true },
      agentIds: ["agent-a"],
      assignResult: { data: null, error: { message: "Agent deactivated" } },
    });

    await expect(tryAutoAssign(client, makeOrder())).resolves.toBeUndefined();
  });

  test("does not throw when settings query fails", async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockRejectedValue(new Error("DB down")),
            }),
          }),
        }),
      }),
      rpc: vi.fn(),
    } as unknown as Parameters<typeof tryAutoAssign>[0];

    await expect(tryAutoAssign(client, makeOrder())).resolves.toBeUndefined();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("does nothing when no active agents exist", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "round_robin" },
      assignmentRule: { algorithm: "round_robin", config: null, is_active: true },
      agentIds: [],
    });

    await tryAutoAssign(client, makeOrder());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("filters to today-active agents when active_agents_only is enabled", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      activeAgentsOnlySetting: true,
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b", "agent-c"],
      orderAssignments: [
        { assigned_to: "agent-a" },
        { assigned_to: "agent-b" },
      ],
      todayActions: [{ actor_id: "agent-b" }],
    });

    await tryAutoAssign(client, makeOrder());

    // Only agent-b is active today, so it should be selected
    expect(client.rpc).toHaveBeenCalledWith("assign_order", expect.objectContaining({
      p_agent_id: "agent-b",
    }));
  });

  test("falls back to all agents when active_agents_only is enabled but none acted today", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      activeAgentsOnlySetting: true,
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      orderAssignments: [],
      todayActions: [], // No one acted today
    });

    await tryAutoAssign(client, makeOrder());

    // Should still assign (fall back to all agents)
    expect(client.rpc).toHaveBeenCalledWith("assign_order", expect.objectContaining({
      p_order_id: "order-1",
    }));
  });
});
