import { describe, it, expect } from "vitest";
import { assembleDayLoop, type DayLoopRows } from "../day-loop-assemble";

/**
 * From database rows to the « Aujourd'hui » payload.
 *
 * The fetch layer only counts; every decision about what a row MEANS is made
 * here, against the definitions already used elsewhere in the warehouse:
 * `get_warehouse_queue_stats` for the bench, `to_be_returned` as the only
 * receivable status, `stock_count` ledger rows as the only proof of a count.
 */

const TRIPOLI = { id: "T", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" };
const BENGHAZI = { id: "B", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي" };

function rows(over: Partial<DayLoopRows> = {}): DayLoopRows {
  return {
    warehouses: [TRIPOLI, BENGHAZI],
    queueBySite: {
      T: { to_prepare: 1, oldest_prepare_hours: 3, returns_inbox: 1, set_aside: 351 },
      B: { to_prepare: 31, oldest_prepare_hours: 70, returns_inbox: 2, set_aside: 42 },
    },
    marketQueue: { to_prepare: 32, oldest_prepare_hours: 70, returns_inbox: 3, set_aside: 393 },
    returning: [{ warehouse_id: "B" }, { warehouse_id: "B" }, { warehouse_id: "B" }],
    receptions: [
      { warehouse_id: "T", reference: "REC-LY-2026-0001", status: "draft", expected_at: "2026-10-01", line_count: 0 },
    ],
    productIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    countRows: [],
    agents: [
      { id: "a", full_name: "adel", warehouse_id: "B" },
      { id: "t", full_name: "tarek", warehouse_id: "T" },
    ],
    leaderboard: [{ actor_id: "a", scanned: 14, last_scan_at: "2026-10-02T10:41:00Z" }],
    marketScannedToday: 14,
    goal: null,
    ...over,
  };
}

const TODAY = "2026-10-02";

describe("assembleDayLoop — the agent's building", () => {
  it("shows only the agent's own building, never the market", () => {
    const out = assembleDayLoop(rows(), { focus: "B", today: TODAY, locale: "ar", withManagerViews: false });
    expect(out.counts.toPrepare).toBe(31);
    expect(out.counts.returnsAtCarrier).toBe(2);
    expect(out.counts.returnsOnTheWay).toBe(3);
    expect(out.siteName).toBe("بنغازي");
  });

  it("counts today's scans of THIS building's agents, not the market's", () => {
    const out = assembleDayLoop(
      rows({ leaderboard: [
        { actor_id: "a", scanned: 14, last_scan_at: null },
        { actor_id: "t", scanned: 5, last_scan_at: null },
      ], marketScannedToday: 19 }),
      { focus: "T", today: TODAY, locale: "fr", withManagerViews: false },
    );
    expect(out.scannedToday).toBe(5);
  });

  it("does not expose the team or the decisions to an agent", () => {
    const out = assembleDayLoop(rows(), { focus: "B", today: TODAY, locale: "ar", withManagerViews: false });
    expect(out.team).toEqual([]);
    expect(out.decisions).toEqual([]);
  });
});

describe("assembleDayLoop — receptions", () => {
  it("counts a draft past its expected date as late, and one with no line as empty", () => {
    const out = assembleDayLoop(rows(), { focus: "T", today: TODAY, locale: "fr", withManagerViews: false });
    expect(out.counts.receptionsExpected).toBe(1);
    expect(out.counts.receptionsLate).toBe(1);
    expect(out.counts.receptionsEmpty).toBe(1);
  });

  it("does not call a reception due today late", () => {
    const out = assembleDayLoop(
      rows({ receptions: [{ warehouse_id: "T", status: "submitted", expected_at: TODAY, line_count: 3 }] }),
      { focus: "T", today: TODAY, locale: "fr", withManagerViews: false },
    );
    expect(out.counts.receptionsLate).toBe(0);
    expect(out.counts.receptionsEmpty).toBe(0);
  });

  it("names the reception when exactly one is expected, with how late it is and whether it has lines", () => {
    // The desk card says « REC-LY-2026-0001 · en retard d'1 j · aucune ligne »
    // rather than « 1 en retard · 1 sans ligne » about a single document.
    const market = assembleDayLoop(rows(), { focus: null, today: TODAY, locale: "fr", withManagerViews: true });
    expect(market.soleReception).toEqual({ reference: "REC-LY-2026-0001", lateDays: 1, empty: true });

    const benghazi = assembleDayLoop(rows(), { focus: "B", today: TODAY, locale: "fr", withManagerViews: false });
    expect(benghazi.soleReception).toBeNull();
  });

  it("names no reception when several are expected — the aggregate speaks for them", () => {
    const out = assembleDayLoop(
      rows({ receptions: [
        { warehouse_id: "T", reference: "REC-1", status: "draft", expected_at: null, line_count: 2 },
        { warehouse_id: "T", reference: "REC-2", status: "submitted", expected_at: "2026-09-28", line_count: 0 },
      ] }),
      { focus: null, today: TODAY, locale: "fr", withManagerViews: true },
    );
    expect(out.soleReception).toBeNull();
  });

  it("does not call a reception due in the future late", () => {
    const out = assembleDayLoop(
      rows({ receptions: [{ warehouse_id: "T", reference: "REC-3", status: "draft", expected_at: "2026-10-09", line_count: 4 }] }),
      { focus: null, today: TODAY, locale: "fr", withManagerViews: true },
    );
    expect(out.soleReception).toEqual({ reference: "REC-3", lateDays: 0, empty: false });
  });

  it("never calls a reception with no expected date late", () => {
    const out = assembleDayLoop(
      rows({ receptions: [{ warehouse_id: "T", status: "draft", expected_at: null, line_count: 1 }] }),
      { focus: "T", today: TODAY, locale: "fr", withManagerViews: false },
    );
    expect(out.counts.receptionsLate).toBe(0);
  });
});

describe("assembleDayLoop — counts", () => {
  it("calls a product counted at a building only when a stock_count row exists FOR that building", () => {
    const out = assembleDayLoop(
      rows({ countRows: [{ product_id: "p1", warehouse_id: "B" }, { product_id: "p2", warehouse_id: "B" }] }),
      { focus: "B", today: TODAY, locale: "fr", withManagerViews: false },
    );
    expect(out.counts.neverCounted).toBe(5);

    const tripoli = assembleDayLoop(
      rows({ countRows: [{ product_id: "p1", warehouse_id: "B" }] }),
      { focus: "T", today: TODAY, locale: "fr", withManagerViews: false },
    );
    expect(tripoli.counts.neverCounted).toBe(7);
  });

  it("calls a product counted for the market when ANY building counted it", () => {
    const out = assembleDayLoop(
      rows({ countRows: [{ product_id: "p1", warehouse_id: "B" }, { product_id: "p2", warehouse_id: "T" }] }),
      { focus: null, today: TODAY, locale: "fr", withManagerViews: true },
    );
    expect(out.counts.products).toBe(7);
    expect(out.counts.neverCounted).toBe(5);
  });

  it("says how many buildings have ever been counted, so the desk can say « none »", () => {
    const none = assembleDayLoop(rows(), { focus: null, today: TODAY, locale: "fr", withManagerViews: true });
    expect(none.countedSites).toBe(0);

    const one = assembleDayLoop(
      rows({ countRows: [
        { product_id: "p1", warehouse_id: "B" },
        { product_id: "p2", warehouse_id: "B" },
        // A market-level count before buildings existed counts no building.
        { product_id: "p3", warehouse_id: null },
      ] }),
      { focus: null, today: TODAY, locale: "fr", withManagerViews: true },
    );
    expect(one.countedSites).toBe(1);
  });

  it("marks the count job `never` when nothing has ever been counted — the state of prod on 2026-10-02", () => {
    const out = assembleDayLoop(rows(), { focus: "B", today: TODAY, locale: "fr", withManagerViews: false });
    expect(out.loop.jobs.find((j) => j.key === "count")?.state).toBe("never");
  });
});

describe("assembleDayLoop — the manager's market view", () => {
  it("sums the buildings and keeps each one for the split under every figure", () => {
    const out = assembleDayLoop(rows(), { focus: null, today: TODAY, locale: "fr", withManagerViews: true });
    expect(out.counts.toPrepare).toBe(32);
    expect(out.counts.setAside).toBe(393);
    expect(out.sites.map((s) => [s.id, s.name, s.counts.toPrepare])).toEqual([
      ["T", "Tripoli", 1],
      ["B", "Benghazi", 31],
    ]);
  });

  it("uses the market's own day figure when no building is chosen", () => {
    const out = assembleDayLoop(rows({ marketScannedToday: 19 }), { focus: null, today: TODAY, locale: "fr", withManagerViews: true });
    expect(out.scannedToday).toBe(19);
  });

  it("lists the team with the silent building last, and the decisions with where to act", () => {
    const out = assembleDayLoop(rows(), { focus: null, today: TODAY, locale: "fr", withManagerViews: true });
    expect(out.team.map((r) => [r.name, r.scannedToday])).toEqual([["adel", 14], ["tarek", 0]]);
    expect(out.decisions.map((d) => d.key)).toEqual(["setAside", "returns", "receptionsLate", "neverCounted"]);
  });

  it("works for a market with no building rows (all markets at once, or a single-site market)", () => {
    const out = assembleDayLoop(
      rows({ warehouses: [], queueBySite: {} }),
      { focus: null, today: TODAY, locale: "fr", withManagerViews: true },
    );
    expect(out.sites).toEqual([]);
    expect(out.counts.toPrepare).toBe(32);
  });
});
