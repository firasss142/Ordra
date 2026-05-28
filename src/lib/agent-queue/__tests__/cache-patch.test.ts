import { describe, test, expect } from "vitest";
import { applyRealtimeEvent, type AgentQueueCache } from "../cache-patch";

const AGENT_ID = "agent-1";

function makeCache(partial: Partial<AgentQueueCache> = {}): AgentQueueCache {
  return {
    orders: [],
    allOrders: [],
    closedOrders: [],
    buckets: {
      nouveau: 0,
      tentative_1: 0,
      tentative_2: 0,
      tentative_3: 0,
      tentative_total: 0,
      rappel_prevu: 0,
      livraison_planifiee: 0,
      confirme: 0,
      rejete: 0,
      fermees: 0,
    },
    ...partial,
  };
}

function row(overrides: Record<string, unknown> & { id: string; status: string }) {
  return {
    assigned_to: AGENT_ID,
    callback_scheduled_at: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: null,
    created_at: "2026-04-14T08:00:00Z",
    ...overrides,
  };
}

describe("applyRealtimeEvent", () => {
  test("INSERT pending order: adds to allOrders, bumps nouveau bucket", () => {
    const cache = makeCache();
    const next = applyRealtimeEvent(cache, {
      type: "INSERT",
      agentId: AGENT_ID,
      new: row({ id: "o1", status: "pending" }),
    });
    expect(next.allOrders.map((r) => r.id)).toEqual(["o1"]);
    expect(next.buckets.nouveau).toBe(1);
  });

  test("INSERT order not assigned to me: returns same cache reference", () => {
    const cache = makeCache();
    const next = applyRealtimeEvent(cache, {
      type: "INSERT",
      agentId: AGENT_ID,
      new: row({ id: "o1", status: "pending", assigned_to: "someone-else" }),
    });
    expect(next).toBe(cache);
  });

  test("UPDATE pending→confirmed: promotes within allOrders, updates buckets", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      buckets: {
        nouveau: 1,
        tentative_1: 0,
        tentative_2: 0,
        tentative_3: 0,
        tentative_total: 0,
        rappel_prevu: 0,
        livraison_planifiee: 0,
        confirme: 0,
        rejete: 0,
        fermees: 0,
      },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
      new: row({ id: "o1", status: "confirmed" }),
    });
    expect(next.allOrders[0].status).toBe("confirmed");
    expect(next.buckets.nouveau).toBe(0);
    expect(next.buckets.confirme).toBe(1);
  });

  test("UPDATE pending→uploaded: moves to closedOrders", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
      new: row({ id: "o1", status: "uploaded" }),
    });
    expect(next.allOrders.find((r) => r.id === "o1")).toBeUndefined();
    expect(next.closedOrders.find((r) => r.id === "o1")?.status).toBe("uploaded");
    expect(next.buckets.nouveau).toBe(0);
    expect(next.buckets.fermees).toBe(1);
  });

  test("UPDATE pending→rejected: moves to closedOrders, increments rejete", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
      new: row({ id: "o1", status: "rejected" }),
    });
    expect(next.allOrders).toHaveLength(0);
    expect(next.closedOrders[0].status).toBe("rejected");
    expect(next.buckets.rejete).toBe(1);
    expect(next.buckets.fermees).toBe(1);
  });

  test("UPDATE reassigned away: removes from all arrays, returns reassignmentEvent kind", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
      new: row({ id: "o1", status: "pending", assigned_to: "someone-else" }),
    });
    expect(next.allOrders).toHaveLength(0);
    expect(next.buckets.nouveau).toBe(0);
    expect(next.reassignmentEvent).toEqual({ orderId: "o1", kind: "reassigned" });
  });

  test("UPDATE status→cancelled: removes from arrays, returns cancelled event", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
      new: row({ id: "o1", status: "cancelled" }),
    });
    expect(next.allOrders).toHaveLength(0);
    expect(next.closedOrders).toHaveLength(0);
    expect(next.buckets.nouveau).toBe(0);
    expect(next.reassignmentEvent).toEqual({ orderId: "o1", kind: "cancelled" });
  });

  test("DELETE removes row from all arrays", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending" })],
      closedOrders: [row({ id: "o2", status: "uploaded" })],
      buckets: { ...makeCache().buckets, nouveau: 1, fermees: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "DELETE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending" }),
    });
    expect(next.allOrders).toHaveLength(0);
    expect(next.buckets.nouveau).toBe(0);
  });

  test("UPDATE with identical content: returns same cache reference (idempotent)", () => {
    const existing = row({ id: "o1", status: "pending" });
    const cache = makeCache({
      allOrders: [existing],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: existing,
      new: { ...existing },
    });
    expect(next).toBe(cache);
  });

  test("UPDATE field-only change (no status change): replaces row in-place", () => {
    const cache = makeCache({
      allOrders: [row({ id: "o1", status: "pending", customer_name: "Old" })],
      buckets: { ...makeCache().buckets, nouveau: 1 },
    });
    const next = applyRealtimeEvent(cache, {
      type: "UPDATE",
      agentId: AGENT_ID,
      old: row({ id: "o1", status: "pending", customer_name: "Old" }),
      new: row({ id: "o1", status: "pending", customer_name: "New" }),
    });
    expect(next.allOrders[0].customer_name).toBe("New");
    expect(next.buckets.nouveau).toBe(1);
  });

  test("buckets count attempt statuses correctly", () => {
    const cache = makeCache();
    const next = applyRealtimeEvent(cache, {
      type: "INSERT",
      agentId: AGENT_ID,
      new: row({ id: "o1", status: "attempt_2" }),
    });
    expect(next.buckets.tentative_2).toBe(1);
    expect(next.buckets.tentative_total).toBe(1);
  });

  test("callback_scheduled with past time counts in rappel_prevu", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const cache = makeCache();
    const next = applyRealtimeEvent(cache, {
      type: "INSERT",
      agentId: AGENT_ID,
      new: row({ id: "o1", status: "callback_scheduled", callback_scheduled_at: past }),
    });
    expect(next.buckets.rappel_prevu).toBe(1);
  });

  test("callback_scheduled with future time does NOT count in rappel_prevu", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const cache = makeCache();
    const next = applyRealtimeEvent(cache, {
      type: "INSERT",
      agentId: AGENT_ID,
      new: row({ id: "o1", status: "callback_scheduled", callback_scheduled_at: future }),
    });
    expect(next.buckets.rappel_prevu).toBe(0);
  });
});
