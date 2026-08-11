import { describe, expect, test } from "vitest";
import { expandAgentQueue } from "../fetch-queue";
import type { RawOrderRow } from "../cache-patch";

function row(id: string, over: Partial<RawOrderRow> = {}): RawOrderRow {
  return {
    id,
    status: "pending",
    assigned_to: "agent-1",
    created_at: "2026-08-01T08:00:00Z",
    ...over,
  } as RawOrderRow;
}

const buckets = {
  nouveau: 2, tentative_1: 0, tentative_2: 0, tentative_3: 0,
  tentative_total: 0, rappel_prevu: 0, livraison_planifiee: 0,
  confirme: 0, rejete: 0, fermees: 1,
};

describe("expandAgentQueue", () => {
  test("rehydrates the visible list from ids", () => {
    const a = row("a");
    const b = row("b");
    const cache = expandAgentQueue({
      visibleIds: ["b", "a"],
      allOrders: [a, b],
      closedOrders: [],
      buckets,
    });

    expect(cache.orders.map((r) => r.id)).toEqual(["b", "a"]);
  });

  // cache-patch and sameQueueOrders both lean on reference checks, so the
  // rehydrated rows must be the same objects, not structural copies.
  test("shares row identity with allOrders rather than copying", () => {
    const a = row("a");
    const cache = expandAgentQueue({
      visibleIds: ["a"], allOrders: [a], closedOrders: [], buckets,
    });

    expect(cache.orders[0]).toBe(a);
    expect(cache.allOrders[0]).toBe(a);
  });

  test("preserves the server's ordering, which is the queue sort", () => {
    const rows = ["c", "a", "b"].map((id) => row(id));
    const cache = expandAgentQueue({
      visibleIds: ["c", "a", "b"], allOrders: rows, closedOrders: [], buckets,
    });

    expect(cache.orders.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  test("keeps a row held back by the time filter out of orders but in allOrders", () => {
    const due = row("due");
    const future = row("future", { status: "callback_scheduled" });
    const cache = expandAgentQueue({
      visibleIds: ["due"], allOrders: [due, future], closedOrders: [], buckets,
    });

    expect(cache.orders.map((r) => r.id)).toEqual(["due"]);
    expect(cache.allOrders.map((r) => r.id)).toEqual(["due", "future"]);
  });

  test("drops an id with no matching row rather than emitting a hole", () => {
    const cache = expandAgentQueue({
      visibleIds: ["a", "ghost"], allOrders: [row("a")], closedOrders: [], buckets,
    });

    expect(cache.orders.map((r) => r.id)).toEqual(["a"]);
    expect(cache.orders).not.toContain(undefined);
  });

  test("survives an empty or partial body", () => {
    const cache = expandAgentQueue({});
    expect(cache.orders).toEqual([]);
    expect(cache.allOrders).toEqual([]);
    expect(cache.closedOrders).toEqual([]);
    expect(cache.buckets.nouveau).toBe(0);
  });

  test("passes closedOrders and buckets straight through", () => {
    const closed = [row("z", { status: "uploaded" })];
    const cache = expandAgentQueue({
      visibleIds: [], allOrders: [], closedOrders: closed, buckets,
    });

    expect(cache.closedOrders).toEqual(closed);
    expect(cache.buckets).toEqual(buckets);
  });
});
