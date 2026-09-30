import { describe, it, expect, vi } from "vitest";
import { fetchAgentCapacity } from "./agent-capacity";

interface AgentRow {
  id: string;
  is_active?: boolean;
  deleted_at?: string | null;
  last_seen_at?: string | null;
  is_available?: boolean;
}

function makeClient(options: {
  agents: AgentRow[];
  orderAssignments?: Array<{ assigned_to: string | null }>;
  assignedToday?: Array<{ assigned_to: string | null }>;
  lastActions?: Array<{ actor_id: string | null; created_at: string }>;
}) {
  const {
    agents,
    orderAssignments = [],
    assignedToday = [],
    lastActions = [],
  } = options;

  const rows = agents.map((a) => ({
    is_active: true,
    deleted_at: null,
    last_seen_at: null,
    is_available: false,
    ...a,
  }));

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        // select -> eq(role) -> eq(is_active) -> is(deleted_at) -> eq(market) -> order
        const chain: Record<string, unknown> = {};
        ["select", "eq", "is"].forEach((m) => {
          chain[m] = vi.fn().mockReturnValue(chain);
        });
        chain.order = vi.fn().mockResolvedValue({ data: rows, error: null });
        return chain;
      }

      if (table === "orders") {
        // Two distinct queries share this table: the queue-size scan ends in
        // `.not(status…)`, the day tally ends in `.gte(assigned_at…)`.
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

      return { select: vi.fn() };
    }),
  } as never;
}

describe("fetchAgentCapacity", () => {
  it("returns empty array when no active agents exist in the market", async () => {
    const client = makeClient({ agents: [] });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result).toEqual([]);
  });

  it("returns agents with queue_size and last_action_at computed", async () => {
    const client = makeClient({
      agents: [{ id: "a1" }, { id: "a2" }],
      orderAssignments: [
        { assigned_to: "a1" },
        { assigned_to: "a1" },
        { assigned_to: "a2" },
      ],
      lastActions: [
        { actor_id: "a1", created_at: "2026-04-24T10:00:00Z" },
        { actor_id: "a1", created_at: "2026-04-24T09:00:00Z" },
        { actor_id: "a2", created_at: "2026-04-24T11:00:00Z" },
      ],
    });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result).toMatchObject([
      { id: "a1", queue_size: 2, last_action_at: "2026-04-24T10:00:00Z" },
      { id: "a2", queue_size: 1, last_action_at: "2026-04-24T11:00:00Z" },
    ]);
  });

  it("returns 0 queue_size and null last_action for agents with no data", async () => {
    const client = makeClient({ agents: [{ id: "a1" }] });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result).toMatchObject([{ id: "a1", queue_size: 0, last_action_at: null }]);
  });
});

describe("the readiness fields the automatic callers filter on", () => {
  it("carries availability and presence through instead of filtering them out", async () => {
    // It must NOT filter: /api/agents/capacity feeds the manager's manual
    // assign rail, where an un-ready agent still has to be selectable.
    const client = makeClient({
      agents: [
        { id: "ready", is_available: true, last_seen_at: "2026-09-19T11:59:00Z" },
        { id: "paused", is_available: false, last_seen_at: "2026-09-19T11:59:00Z" },
      ],
    });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "ready", is_available: true });
    expect(result[1]).toMatchObject({ id: "paused", is_available: false });
  });

  it("reads a missing is_available as not-ready rather than crashing", async () => {
    // Before the migration lands the column does not exist. Inert, not wrong.
    const client = makeClient({ agents: [{ id: "a1", is_available: undefined }] });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result[0].is_available).toBe(false);
  });
});

describe("today's tally feeds the percentage quota", () => {
  it("counts orders assigned today per agent", async () => {
    const client = makeClient({
      agents: [{ id: "a1" }, { id: "a2" }],
      assignedToday: [
        { assigned_to: "a1" },
        { assigned_to: "a1" },
        { assigned_to: "a1" },
        { assigned_to: "a2" },
        { assigned_to: null },
      ],
    });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result[0].assigned_today).toBe(3);
    expect(result[1].assigned_today).toBe(1);
  });

  it("is zero for an agent who has received nothing today", async () => {
    const client = makeClient({ agents: [{ id: "a1" }] });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result[0].assigned_today).toBe(0);
  });
});
