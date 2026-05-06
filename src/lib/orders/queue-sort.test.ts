import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { sortAgentQueue } from "./queue-sort";

describe("sortAgentQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("callback_scheduled with past callback_time comes first", () => {
    const orders = [
      { id: "a", status: "assigned", callback_scheduled_at: null, created_at: "2026-04-14T08:00:00Z" },
      { id: "b", status: "callback_scheduled", callback_scheduled_at: "2026-04-14T10:00:00Z", created_at: "2026-04-14T09:00:00Z" },
      { id: "c", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T07:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    expect(sorted.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  test("callback_scheduled with future callback_time sorts after attempts", () => {
    const orders = [
      { id: "a", status: "callback_scheduled", callback_scheduled_at: "2026-04-14T15:00:00Z", created_at: "2026-04-14T09:00:00Z" },
      { id: "b", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T08:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    // Future callback sorts as priority 3 (other), attempt_1 is priority 1
    expect(sorted.map((o) => o.id)).toEqual(["b", "a"]);
  });

  test("attempts sorted by oldest created_at first", () => {
    const orders = [
      { id: "a", status: "attempt_2", callback_scheduled_at: null, created_at: "2026-04-14T10:00:00Z" },
      { id: "b", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T08:00:00Z" },
      { id: "c", status: "attempt_3", callback_scheduled_at: null, created_at: "2026-04-14T09:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    expect(sorted.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  test("pending assigned orders come after attempts", () => {
    const orders = [
      { id: "a", status: "pending", callback_scheduled_at: null, created_at: "2026-04-14T07:00:00Z" },
      { id: "b", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T09:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    expect(sorted.map((o) => o.id)).toEqual(["b", "a"]);
  });

  test("confirmed orders come last", () => {
    const orders = [
      { id: "a", status: "confirmed", callback_scheduled_at: null, created_at: "2026-04-14T07:00:00Z" },
      { id: "b", status: "assigned", callback_scheduled_at: null, created_at: "2026-04-14T09:00:00Z" },
      { id: "c", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T08:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    expect(sorted.map((o) => o.id)).toEqual(["c", "b", "a"]);
  });

  test("full mixed queue sorts correctly", () => {
    const orders = [
      { id: "e", status: "confirmed", callback_scheduled_at: null, created_at: "2026-04-14T06:00:00Z" },
      { id: "d", status: "assigned", callback_scheduled_at: null, created_at: "2026-04-14T10:00:00Z" },
      { id: "c", status: "attempt_2", callback_scheduled_at: null, created_at: "2026-04-14T09:00:00Z" },
      { id: "b", status: "callback_scheduled", callback_scheduled_at: "2026-04-14T11:00:00Z", created_at: "2026-04-14T08:00:00Z" },
      { id: "a", status: "assigned", callback_scheduled_at: null, created_at: "2026-04-14T07:00:00Z" },
    ];

    const sorted = sortAgentQueue(orders);
    // callback ready (b, past) → attempt (c) → assigned oldest (a) → assigned newer (d) → confirmed (e)
    expect(sorted.map((o) => o.id)).toEqual(["b", "c", "a", "d", "e"]);
  });

  test("returns empty array for empty input", () => {
    expect(sortAgentQueue([])).toEqual([]);
  });

  test("does not mutate original array", () => {
    const orders = [
      { id: "a", status: "assigned", callback_scheduled_at: null, created_at: "2026-04-14T10:00:00Z" },
      { id: "b", status: "attempt_1", callback_scheduled_at: null, created_at: "2026-04-14T08:00:00Z" },
    ];
    const original = [...orders];
    sortAgentQueue(orders);
    expect(orders).toEqual(original);
  });
});
