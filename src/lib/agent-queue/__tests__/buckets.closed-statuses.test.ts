import { describe, expect, test } from "vitest";
import {
  CLOSED_AGENT_STATUSES,
  applyRowPatch,
  type RawOrderRow,
} from "../buckets";

/**
 * promote_darb_status (migration 20260817000001) writes uploaded -> delivered |
 * returned | cancelled directly, and QueuePage fires the Darb sync on every
 * mount, so the promotion lands while the agent is watching.
 *
 * CLOSED_AGENT_STATUSES did not include delivered/returned, so applyRowPatch
 * filtered those rows out of closedOrders with no toast — an order the agent
 * confirmed and shipped simply vanished from Fermées the moment the carrier
 * reported success, and the Livré / Retourné chips read 0 for every agent,
 * always.
 *
 * `cancelled` deliberately stays OUT: it is the one of the three that already
 * notifies the agent (cache-patch.ts routes it to a "cancelled" toast via
 * TERMINAL_REMOVED_STATUSES), and demoting it to a silent Fermées row would
 * trade a real signal for a chip.
 */
function row(over: Partial<RawOrderRow> = {}): RawOrderRow {
  return {
    id: "o1",
    status: "uploaded",
    assigned_to: "agent-1",
    created_at: "2026-08-01T08:00:00Z",
    ...over,
  } as RawOrderRow;
}

function cacheWithClosed(r: RawOrderRow) {
  return { orders: [], allOrders: [], closedOrders: [r] };
}

describe("CLOSED_AGENT_STATUSES covers carrier-terminal outcomes", () => {
  test.each(["delivered", "returned"])(
    "%s is a closed status, not a disappearance",
    (status) => {
      expect(CLOSED_AGENT_STATUSES.has(status)).toBe(true);
    },
  );

  test("cancelled stays out, so it keeps its toast rather than silently landing in Fermées", () => {
    expect(CLOSED_AGENT_STATUSES.has("cancelled")).toBe(false);
  });

  test.each(["delivered", "returned"])(
    "an uploaded order promoted to %s stays in closedOrders",
    (status) => {
      const cache = cacheWithClosed(row({ status: "uploaded" }));
      const next = applyRowPatch(cache, "o1", row({ status }));

      expect(next.closedOrders.map((r) => r.id)).toEqual(["o1"]);
      expect(next.closedOrders[0].status).toBe(status);
    },
  );

  test("a confirmed order shipped and then delivered ends up in closedOrders, not nowhere", () => {
    const cache = { orders: [], allOrders: [row({ status: "confirmed" })], closedOrders: [] };

    const uploaded = applyRowPatch(cache, "o1", row({ status: "uploaded" }));
    expect(uploaded.allOrders).toHaveLength(0);
    expect(uploaded.closedOrders).toHaveLength(1);

    const delivered = applyRowPatch(uploaded, "o1", row({ status: "delivered" }));
    expect(delivered.closedOrders.map((r) => r.status)).toEqual(["delivered"]);
  });
});
