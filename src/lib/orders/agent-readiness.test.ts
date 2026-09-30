import { describe, test, expect } from "vitest";
import { isReadyForOrders, READINESS_STALE_AFTER_MS } from "./agent-readiness";
import type { AvailableAgent } from "./auto-assignment-types";

const NOW = new Date("2026-09-19T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function makeAgent(over: Partial<AvailableAgent> & { id: string }): AvailableAgent {
  return {
    queue_size: 0,
    last_action_at: null,
    assigned_today: 0,
    is_available: true,
    is_active: true,
    deleted_at: null,
    last_seen_at: ago(60_000),
    ...over,
  };
}

describe("readiness is a declaration AND a live session — never one alone", () => {
  test("an agent who declared ready with a fresh heartbeat is ready", () => {
    expect(isReadyForOrders(makeAgent({ id: "a" }), NOW)).toBe(true);
  });

  test("a closed laptop with the toggle left on is NOT ready", () => {
    // The whole point of pairing the two: otherwise a forgotten toggle
    // swallows orders all night.
    const agent = makeAgent({ id: "a", last_seen_at: ago(READINESS_STALE_AFTER_MS + 1000) });
    expect(isReadyForOrders(agent, NOW)).toBe(false);
  });

  test("an agent at their desk who has not declared ready is NOT ready", () => {
    expect(isReadyForOrders(makeAgent({ id: "a", is_available: false }), NOW)).toBe(false);
  });

  test("never seen at all is not ready", () => {
    expect(isReadyForOrders(makeAgent({ id: "a", last_seen_at: null }), NOW)).toBe(false);
  });
});

describe("the account flags outrank the declaration", () => {
  test("a deactivated account is not ready even if its flag says available", () => {
    expect(isReadyForOrders(makeAgent({ id: "a", is_active: false }), NOW)).toBe(false);
  });

  test("a soft-deleted agent is not ready", () => {
    // assign_order checks only is_active, so a soft-deleted agent can still be
    // assigned orders today. Readiness does not inherit that omission.
    const agent = makeAgent({ id: "a", deleted_at: "2026-09-01T00:00:00Z" });
    expect(isReadyForOrders(agent, NOW)).toBe(false);
  });
});

describe("the staleness window", () => {
  test("is the 30-minute idle threshold, not the 5-minute online one", () => {
    // The heartbeat is visibility-gated (usePresenceHeartbeat returns early
    // when the tab is hidden). At 5 minutes an agent who backgrounds the tab
    // silently stops receiving work — which is what a confirmation agent does
    // all day. 30 min trades a short tail after someone leaves for never
    // starving someone who is working.
    expect(READINESS_STALE_AFTER_MS).toBe(30 * 60 * 1000);
  });

  test("just inside the window is still ready", () => {
    const agent = makeAgent({ id: "a", last_seen_at: ago(READINESS_STALE_AFTER_MS - 1000) });
    expect(isReadyForOrders(agent, NOW)).toBe(true);
  });
});
