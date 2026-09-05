import { describe, test, expect } from "vitest";
import { filtersForTile, resolveKpiWindow, tileForFilters, todayIso } from "./kpi-tiles";
import { LY_MARKET_ID } from "@/lib/markets";
import { todayInMarket } from "@/lib/dates/market-day";
import { DEFAULT_FILTERS } from "./list-filters";
import type { KpiTile } from "@/components/orders/OrdersKpiStrip";

const TILES: KpiTile[] = [
  "unassigned",
  "periodTotal",
  "uploaded",
  "rejected",
  "delivered",
  "toRecall",
];

describe("kpi tile ↔ filter mapping", () => {
  test("every tile round-trips back to itself", () => {
    // If a tile's filters resolved to a different tile, the strip would
    // highlight the wrong thing after a click.
    for (const tile of TILES) {
      expect(tileForFilters({ ...DEFAULT_FILTERS, ...filtersForTile(tile) })).toBe(tile);
    }
  });

  test("clearing returns to the unfiltered list", () => {
    const cleared = filtersForTile(null);
    expect(cleared).toEqual({
      preset: "all",
      statuses: [],
      agentId: null,
      dateFrom: null,
      dateTo: null,
    });
    expect(tileForFilters({ ...DEFAULT_FILTERS, ...cleared })).toBeNull();
  });

  test("no two tiles map to the same filter set", () => {
    const seen = TILES.map((t) => JSON.stringify(filtersForTile(t)));
    expect(new Set(seen).size).toBe(TILES.length);
  });

  test("hand-edited filters match no tile rather than mislabelling one", () => {
    const custom = { ...DEFAULT_FILTERS, statuses: ["cancelled"], agentId: null, preset: "all" as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tileForFilters(custom as any)).toBeNull();
  });

  test("delivered selects the delivered status", () => {
    const f = filtersForTile("delivered");
    expect(f.statuses).toEqual(["delivered"]);
    expect(f.agentId).toBeNull();
    expect(f.preset).toBe("all");
  });

  test("the removed 'waiting' tile no longer resolves", () => {
    // `pending` alone used to be a tile. It was replaced by `delivered`; a
    // leftover ?status=pending URL must highlight nothing rather than a tile
    // that is no longer on screen.
    const pendingOnly = { ...DEFAULT_FILTERS, statuses: ["pending"], agentId: null, preset: "all" as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tileForFilters(pendingOnly as any)).toBeNull();
  });

  test("statuses are copied, so a caller cannot mutate the tile definitions", () => {
    const a = filtersForTile("toRecall");
    a.statuses.push("delivered" as never);
    expect(filtersForTile("toRecall").statuses).not.toContain("delivered");
  });

  test("an outcome tile carries its window into the table", () => {
    // Otherwise "Rejetées · aujourd'hui" (16) opens every rejection ever (1 926).
    const f = filtersForTile("rejected", { from: "2026-08-01", to: "2026-08-12" });
    expect(f.dateFrom).toBe("2026-08-01");
    expect(f.dateTo).toBe("2026-08-12");
  });

  test("an outcome tile with no window given falls back to today", () => {
    const f = filtersForTile("delivered");
    expect(f.dateFrom).toBe(todayIso());
    expect(f.dateTo).toBeNull();
  });

  test("a queue tile carries no window — a backlog has no date", () => {
    for (const tile of ["unassigned", "toRecall"] as const) {
      const f = filtersForTile(tile, { from: "2026-08-01", to: "2026-08-12" });
      expect(f.dateFrom).toBeNull();
      expect(f.dateTo).toBeNull();
    }
  });

  test("the window defaults to today and otherwise mirrors the filters", () => {
    expect(resolveKpiWindow({ dateFrom: null, dateTo: null })).toEqual({
      from: todayIso(),
      to: null,
    });
    // "Today" for a Libyan manager is Tripoli's calendar day. At 23:30Z the
    // browser of someone abroad and the market disagree on what day it is; the
    // market wins, because that is the day the KPI strip is labelled with.
    expect(resolveKpiWindow({ dateFrom: null, dateTo: null }, LY_MARKET_ID)).toEqual({
      from: todayInMarket(LY_MARKET_ID),
      to: null,
    });
    expect(resolveKpiWindow({ dateFrom: "2026-08-01", dateTo: "2026-08-12" })).toEqual({
      from: "2026-08-01",
      to: "2026-08-12",
    });
  });

  test("an outcome status with no window highlights nothing", () => {
    // The tile counts today; an unbounded table shows every rejection. They
    // disagree, so the strip must not claim that tile is where you are.
    const unbounded = {
      ...DEFAULT_FILTERS,
      statuses: ["rejected"],
      preset: "all" as const,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tileForFilters(unbounded as any)).toBeNull();
  });

  test("a queue tile stops being active once a window is applied", () => {
    const windowed = {
      ...DEFAULT_FILTERS,
      ...filtersForTile("toRecall"),
      dateFrom: "2026-08-01",
    };
    expect(tileForFilters(windowed)).toBeNull();
  });

  describe("the period-total tile", () => {
    test("carries the active window rather than counting today forever", () => {
      // It used to be a fixed "Aujourd'hui" tile: pick "30 derniers jours" and
      // every other tile moved while this one kept reporting the current day,
      // so the row described two periods at once.
      const f = filtersForTile("periodTotal", { from: "2026-08-01", to: "2026-08-12" });
      expect(f.dateFrom).toBe("2026-08-01");
      expect(f.dateTo).toBe("2026-08-12");
    });

    test("is the window itself — no status and no owner narrowing it", () => {
      const f = filtersForTile("periodTotal", { from: "2026-08-01", to: null });
      expect(f.statuses).toEqual([]);
      expect(f.agentId).toBeNull();
      // `preset: "today"` would AND a second, contradictory date predicate onto
      // the window the tile is reporting.
      expect(f.preset).toBe("all");
    });

    test("with no window given it falls back to today", () => {
      const f = filtersForTile("periodTotal");
      expect(f.dateFrom).toBe(todayIso());
      expect(f.dateTo).toBeNull();
    });

    test("a bare date range is this tile, so the strip says where you are", () => {
      // Picking "7 derniers jours" in the Date facet puts the table in exactly
      // the state this tile stands for; highlighting nothing would be a lie.
      expect(
        tileForFilters({ ...DEFAULT_FILTERS, dateFrom: "2026-08-01", dateTo: null }),
      ).toBe("periodTotal");
    });

    test("an unfiltered list is not this tile", () => {
      expect(tileForFilters(DEFAULT_FILTERS)).toBeNull();
    });
  });

  test("unassigned selects by owner, not by status", () => {
    // The old 'unassigned' preset meant pending AND unassigned, which is a
    // narrower set than the tile counts — that mismatch is the bug.
    const f = filtersForTile("unassigned");
    expect(f.agentId).toBe("unassigned");
    expect(f.statuses).toEqual([]);
  });
});
