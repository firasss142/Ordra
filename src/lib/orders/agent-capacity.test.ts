import { describe, it, expect, vi } from "vitest";
import { fetchAgentCapacity } from "./agent-capacity";

function makeClient(options: {
  agents: Array<{ id: string }>;
  orderAssignments?: Array<{ assigned_to: string | null }>;
  lastActions?: Array<{ actor_id: string | null; created_at: string }>;
}) {
  const { agents, orderAssignments = [], lastActions = [] } = options;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: agents, error: null }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "orders") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: orderAssignments, error: null }),
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
    expect(result).toEqual([
      { id: "a1", queue_size: 2, last_action_at: "2026-04-24T10:00:00Z" },
      { id: "a2", queue_size: 1, last_action_at: "2026-04-24T11:00:00Z" },
    ]);
  });

  it("returns 0 queue_size and null last_action for agents with no data", async () => {
    const client = makeClient({
      agents: [{ id: "a1" }],
      orderAssignments: [],
      lastActions: [],
    });
    const result = await fetchAgentCapacity(client, "market-tn");
    expect(result).toEqual([{ id: "a1", queue_size: 0, last_action_at: null }]);
  });
});
