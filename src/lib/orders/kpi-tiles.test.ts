import { describe, test, expect } from "vitest";
import { filtersForTile, tileForFilters } from "./kpi-tiles";
import { DEFAULT_FILTERS } from "./list-filters";
import type { KpiTile } from "@/components/orders/OrdersKpiStrip";

const TILES: KpiTile[] = ["unassigned", "today", "waiting", "toRecall", "uploaded", "rejected"];

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
    expect(cleared).toEqual({ preset: "all", statuses: [], agentId: null });
    expect(tileForFilters({ ...DEFAULT_FILTERS, ...cleared })).toBeNull();
  });

  test("no two tiles map to the same filter set", () => {
    const seen = TILES.map((t) => JSON.stringify(filtersForTile(t)));
    expect(new Set(seen).size).toBe(TILES.length);
  });

  test("hand-edited filters match no tile rather than mislabelling one", () => {
    const custom = { ...DEFAULT_FILTERS, statuses: ["delivered"], agentId: null, preset: "all" as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(tileForFilters(custom as any)).toBeNull();
  });

  test("statuses are copied, so a caller cannot mutate the tile definitions", () => {
    const a = filtersForTile("toRecall");
    a.statuses.push("delivered" as never);
    expect(filtersForTile("toRecall").statuses).not.toContain("delivered");
  });

  test("unassigned selects by owner, not by status", () => {
    // The old 'unassigned' preset meant pending AND unassigned, which is a
    // narrower set than the tile counts — that mismatch is the bug.
    const f = filtersForTile("unassigned");
    expect(f.agentId).toBe("unassigned");
    expect(f.statuses).toEqual([]);
  });
});
