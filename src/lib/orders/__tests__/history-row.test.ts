import { describe, expect, test } from "vitest";
import { toHistoryEntry } from "../history-row";
import { presentStatus } from "../status-presentation";

/**
 * /api/orders/[id] renames the order_history columns on the way out:
 * status_from -> from_status, status_to -> to_status. The realtime subscriber
 * used to prepend the RAW database row instead, so a freshly-written history
 * entry reached HistoryTimeline with `to_status` undefined —
 * `presentStatus(undefined)` then threw
 * "Cannot read properties of undefined (reading 'startsWith')".
 *
 * It fired on upload and reopen because those are the actions that write an
 * order_history row while the panel is open, and it was non-fatal only because
 * the write itself had already succeeded server-side.
 */
const rawDbRow = {
  id: "h-1",
  order_id: "o-1",
  status_from: "confirmed",
  status_to: "uploaded",
  note: "Telecharge chez transporteur, suivi: SH-1",
  actor_id: "agent-1",
  actor_type: "agent",
  created_at: "2026-08-11T10:00:00Z",
  market_id: "m-1",
};

describe("toHistoryEntry", () => {
  test("renames status_from / status_to to the shape the API returns", () => {
    const entry = toHistoryEntry(rawDbRow);
    expect(entry.from_status).toBe("confirmed");
    expect(entry.to_status).toBe("uploaded");
  });

  test("carries the fields the timeline renders", () => {
    expect(toHistoryEntry(rawDbRow)).toMatchObject({
      id: "h-1",
      note: "Telecharge chez transporteur, suivi: SH-1",
      actor_id: "agent-1",
      actor_type: "agent",
      created_at: "2026-08-11T10:00:00Z",
    });
  });

  test("drops columns the timeline has no use for", () => {
    const entry = toHistoryEntry(rawDbRow) as Record<string, unknown>;
    expect(entry).not.toHaveProperty("status_to");
    expect(entry).not.toHaveProperty("status_from");
    expect(entry).not.toHaveProperty("market_id");
    expect(entry).not.toHaveProperty("order_id");
  });

  // The actual crash: presentStatus does status.startsWith("attempt_").
  test("produces a to_status presentStatus can consume", () => {
    const entry = toHistoryEntry(rawDbRow);
    expect(() => presentStatus(entry.to_status)).not.toThrow();
    expect(presentStatus(entry.to_status).icon).toBeTruthy();
  });

  test("an intake row with no origin status keeps from_status null", () => {
    const entry = toHistoryEntry({ ...rawDbRow, status_from: null });
    expect(entry.from_status).toBeNull();
    expect(entry.to_status).toBe("uploaded");
  });
});

describe("presentStatus is the thing that broke", () => {
  test("throws on undefined today — which is why the mapper must run first", () => {
    expect(() =>
      presentStatus(undefined as unknown as string),
    ).toThrow(/startsWith/);
  });
});
