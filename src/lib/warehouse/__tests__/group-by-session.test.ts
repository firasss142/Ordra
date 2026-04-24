import { describe, it, expect } from "vitest";
import { groupRowsIntoSessions, rowDay } from "../group-by-session";
import type { WarehouseHistoryRow } from "../history-fetch";

function makeRow(overrides: Partial<WarehouseHistoryRow> & { at: string; id: string }): WarehouseHistoryRow {
  return {
    kind: "scan",
    order_id: null,
    order_number: null,
    product_id: null,
    product_name: null,
    qty_change: -1,
    balance_after: 10,
    detail: "—",
    is_damaged: false,
    is_reprint: false,
    note: null,
    actor: null,
    anomalies: [],
    ...overrides,
  };
}

const ACTOR_A = { id: "aaa", full_name: "Anis M.", role: "warehouse_agent" as const, avatar_url: null };
const ACTOR_B = { id: "bbb", full_name: "Bilal K.", role: "warehouse_agent" as const, avatar_url: null };

// Build ISO timestamps offset by minutes from a base time
function ts(base: string, plusMinutes: number): string {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + plusMinutes);
  return d.toISOString();
}

const BASE = "2026-04-24T09:00:00.000Z";

describe("groupRowsIntoSessions", () => {
  it("returns empty array for empty input", () => {
    expect(groupRowsIntoSessions([])).toEqual([]);
  });

  it("puts a single row into one session", () => {
    const rows = [makeRow({ id: "r1", at: BASE, actor: ACTOR_A })];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rows).toHaveLength(1);
    expect(sessions[0].actorId).toBe("aaa");
  });

  it("groups same-actor rows within 30-minute gap into one session", () => {
    // Newest-first (rows arrive newest first)
    const rows = [
      makeRow({ id: "r3", at: ts(BASE, 20), actor: ACTOR_A }),
      makeRow({ id: "r2", at: ts(BASE, 10), actor: ACTOR_A }),
      makeRow({ id: "r1", at: BASE, actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rows).toHaveLength(3);
    expect(sessions[0].scanCount).toBe(3);
  });

  it("splits same-actor rows when gap exceeds 30 minutes", () => {
    const rows = [
      makeRow({ id: "r2", at: ts(BASE, 35), actor: ACTOR_A }), // 35 min after r1 — new session
      makeRow({ id: "r1", at: BASE, actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].rows[0].id).toBe("r2");
    expect(sessions[1].rows[0].id).toBe("r1");
  });

  it("exactly 30-minute gap: boundary belongs to same session", () => {
    const rows = [
      makeRow({ id: "r2", at: ts(BASE, 30), actor: ACTOR_A }),
      makeRow({ id: "r1", at: BASE, actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows, 30);
    expect(sessions).toHaveLength(1);
  });

  it("splits rows from different actors even if close in time", () => {
    const rows = [
      makeRow({ id: "r2", at: ts(BASE, 5), actor: ACTOR_B }),
      makeRow({ id: "r1", at: BASE, actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].actorId).toBe("bbb");
    expect(sessions[1].actorId).toBe("aaa");
  });

  it("groups null-actor (system) rows separately from named actors", () => {
    const rows = [
      makeRow({ id: "r3", at: ts(BASE, 2), actor: null }), // system
      makeRow({ id: "r2", at: ts(BASE, 1), actor: ACTOR_A }),
      makeRow({ id: "r1", at: BASE, actor: null }), // system
    ];
    const sessions = groupRowsIntoSessions(rows);
    // system / ACTOR_A / system → 3 sessions (different actorIds)
    expect(sessions).toHaveLength(3);
    expect(sessions[0].actorId).toBeNull();
    expect(sessions[1].actorId).toBe("aaa");
    expect(sessions[2].actorId).toBeNull();
  });

  it("counts kinds correctly", () => {
    const rows = [
      makeRow({ id: "r4", at: ts(BASE, 15), kind: "print", actor: ACTOR_A }),
      makeRow({ id: "r3", at: ts(BASE, 10), kind: "return", actor: ACTOR_A }),
      makeRow({ id: "r2", at: ts(BASE, 5), kind: "writeoff", actor: ACTOR_A }),
      makeRow({ id: "r1", at: BASE, kind: "adjust", actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].printCount).toBe(1);
    expect(sessions[0].returnCount).toBe(2); // return + writeoff
    expect(sessions[0].adjustCount).toBe(1);
    expect(sessions[0].scanCount).toBe(0);
  });

  it("startAt is newest row, endAt is oldest row", () => {
    const rows = [
      makeRow({ id: "r2", at: ts(BASE, 20), actor: ACTOR_A }),
      makeRow({ id: "r1", at: BASE, actor: ACTOR_A }),
    ];
    const sessions = groupRowsIntoSessions(rows);
    expect(sessions[0].startAt).toBe(ts(BASE, 20));
    expect(sessions[0].endAt).toBe(BASE);
  });
});

describe("rowDay", () => {
  it("extracts YYYY-MM-DD from ISO string", () => {
    expect(rowDay("2026-04-24T09:32:00.000Z")).toBe("2026-04-24");
  });
});
