import { describe, test, expect, vi } from "vitest";
import { tryAutoAssign } from "./auto-assignment-orchestrator";
import type { AssignableOrder } from "./auto-assignment-types";

interface AgentRow {
  id: string;
  is_active: boolean;
  deleted_at: string | null;
  is_available: boolean;
  last_seen_at: string | null;
}

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
  assignmentRule?: { algorithm: string; config: unknown; is_active: boolean } | null;
  agentIds?: string[];
  /** Per-agent overrides for the readiness columns; default is "ready". */
  agentOverrides?: Record<string, Partial<AgentRow>>;
  shares?: Array<{ agent_id: string; share_pct: number }>;
  assignedToday?: Array<{ assigned_to: string | null }>;
  orderAssignments?: Array<{ assigned_to: string | null }>;
  lastActions?: Array<{ actor_id: string | null; created_at: string }>;
  assignResult?: { data: unknown; error: unknown };
}) {
  const {
    algorithmSetting = { type: "manual" },
    assignmentRule = { algorithm: "manual", config: null, is_active: true },
    agentIds = [],
    agentOverrides = {},
    shares = [],
    assignedToday = [],
    orderAssignments = [],
    lastActions = [],
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
                    key === "assignment_algorithm" && algorithmSetting
                      ? { value: algorithmSetting }
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
        // select -> eq(role) -> eq(is_active) -> is(deleted_at) -> eq(market) -> order
        const chain: Record<string, unknown> = {};
        ["select", "eq", "is"].forEach((m) => {
          chain[m] = vi.fn().mockReturnValue(chain);
        });
        chain.order = vi.fn().mockResolvedValue({
          data: agentIds.map((id) => ({
            id,
            is_active: true,
            deleted_at: null,
            // Ready by default: these suites are about selection. Tests that
            // care about eligibility override it explicitly.
            is_available: true,
            last_seen_at: new Date().toISOString(),
            ...(agentOverrides[id] ?? {}),
          })),
          error: null,
        });
        return chain;
      }

      if (table === "agent_distribution_shares") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: shares, error: null }),
          }),
        };
      }

      if (table === "orders") {
        // Two queries: queue size ends in .not(status), the day tally in .gte.
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: orderAssignments, error: null }),
              gte: vi.fn().mockResolvedValue({ data: assignedToday, error: null }),
            }),
          }),
        };
      }

      if (table === "order_history") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: lastActions, error: null }),
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

  // `active_agents_only` is gone. Its UI label promised "agents en ligne —
  // jamais hors ligne" while the code checked "acted today", then silently
  // fell back to every active agent when nobody qualified. Readiness below is
  // the honest version of the same intent, and it gates every algorithm.

  test("skips an agent who has not declared themselves ready", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      // agent-a has the shorter queue and would win on workload alone.
      orderAssignments: [{ assigned_to: "agent-b" }],
      agentOverrides: { "agent-a": { is_available: false } },
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith(
      "assign_order",
      expect.objectContaining({ p_agent_id: "agent-b" }),
    );
  });

  test("skips an agent whose heartbeat has gone stale", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      orderAssignments: [{ assigned_to: "agent-b" }],
      agentOverrides: {
        "agent-a": { last_seen_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      },
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith(
      "assign_order",
      expect.objectContaining({ p_agent_id: "agent-b" }),
    );
  });

  test("assigns nothing when nobody is ready — the order waits in the pool", async () => {
    // The behaviour change worth knowing about: before readiness, an order
    // always landed on somebody.
    const client = createMockClient({
      algorithmSetting: { type: "workload" },
      assignmentRule: { algorithm: "workload", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      agentOverrides: {
        "agent-a": { is_available: false },
        "agent-b": { is_available: false },
      },
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("percentage sends the order to whoever is furthest behind their share", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "percentage" },
      assignmentRule: { algorithm: "percentage", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      shares: [
        { agent_id: "agent-a", share_pct: 30 },
        { agent_id: "agent-b", share_pct: 70 },
      ],
      // Today so far: a has 5, b has 5. b's target is far higher.
      assignedToday: [
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-a" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
        { assigned_to: "agent-b" },
      ],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalledWith(
      "assign_order",
      expect.objectContaining({
        p_agent_id: "agent-b",
        p_note: "Auto-assigned via Répartition par pourcentages",
      }),
    );
  });

  test("percentage assigns nothing when no shares are configured", async () => {
    // Better than spreading by workload behind the manager's back: the UI
    // would claim a split was being honoured when it was not.
    const client = createMockClient({
      algorithmSetting: { type: "percentage" },
      assignmentRule: { algorithm: "percentage", config: null, is_active: true },
      agentIds: ["agent-a", "agent-b"],
      shares: [],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).not.toHaveBeenCalled();
  });

  test("percentage never writes back a config, so another algorithm's cursor survives", async () => {
    const client = createMockClient({
      algorithmSetting: { type: "percentage" },
      assignmentRule: {
        algorithm: "percentage",
        config: { last_assigned_index: 4 },
        is_active: true,
      },
      agentIds: ["agent-a"],
      shares: [{ agent_id: "agent-a", share_pct: 100 }],
    });

    await tryAutoAssign(client, makeOrder());

    expect(client.rpc).toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("assignment_rules_update_marker");
    const updateCalls = (client.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "assignment_rules",
    );
    // Read once for the rule; never a second time to persist a cursor.
    expect(updateCalls).toHaveLength(1);
  });
});
