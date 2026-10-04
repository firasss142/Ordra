import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  clearFilterField,
  filtersToSearchParams,
  hasActiveFilters,
  listQuerySchema,
  parseFiltersFromSearchParams,
  resetFilters,
  csvList,
  type OrderListFilters,
} from "@/lib/orders/list-filters";

const parse = (qs: string) => parseFiltersFromSearchParams(new URLSearchParams(qs));

describe("parseFiltersFromSearchParams", () => {
  it("returns defaults for empty params", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
  });

  it("reads every multi-value filter as a list", () => {
    const f = parse(
      "status=pending,attempt_1&agent_id=a1,unassigned&storefront_id=s1,s2&city=Tripoli,none&product_id=p1&carrier_id=c1,none&date_from=2026-10-01&date_to=2026-10-04",
    );
    expect(f.statuses).toEqual(["pending", "attempt_1"]);
    expect(f.agentIds).toEqual(["a1", "unassigned"]);
    expect(f.storefrontIds).toEqual(["s1", "s2"]);
    expect(f.cities).toEqual(["Tripoli", "none"]);
    expect(f.productIds).toEqual(["p1"]);
    expect(f.carrierIds).toEqual(["c1", "none"]);
    expect(f.dateFrom).toBe("2026-10-01");
    expect(f.dateTo).toBe("2026-10-04");
  });

  it("knows the four work shortcuts", () => {
    for (const p of ["today", "unassigned", "recall", "uploaded_today"]) {
      expect(parse(`preset=${p}`).preset).toBe(p);
    }
  });

  it("reads the old « callbacks » deep link as À rappeler", () => {
    expect(parse("preset=callbacks").preset).toBe("recall");
  });

  it("drops an unknown preset, an invalid status and a malformed date", () => {
    const f = parse("preset=in_delivery&status=pending,nope&date_from=04/10/2026");
    expect(f.preset).toBe("all");
    expect(f.statuses).toEqual(["pending"]);
    expect(f.dateFrom).toBeNull();
  });

  it("keeps the archive tab, and defaults it to « Prêtes à ranger »", () => {
    expect(parse("scope=archive").archiveTab).toBe("eligible");
    expect(parse("scope=archive&state=deleted").archiveTab).toBe("deleted");
    expect(parse("scope=archive&state=bogus").archiveTab).toBe("eligible");
  });
});

describe("filtersToSearchParams", () => {
  it("round-trips a busy filter (market is never in the URL)", () => {
    const busy: OrderListFilters = {
      ...DEFAULT_FILTERS,
      marketId: "m-1",
      preset: "recall",
      q: "0912",
      statuses: ["attempt_1", "callback_scheduled"],
      agentIds: ["a1", "unassigned"],
      storefrontIds: ["s1"],
      cities: ["Benghazi", "none"],
      productIds: ["p1", "p2"],
      carrierIds: ["none"],
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      pageSize: 50,
    };
    const p = filtersToSearchParams(busy);
    expect(p.has("market_id")).toBe(false);
    expect(parse(p.toString())).toEqual({ ...busy, marketId: null });
  });

  it("omits defaults to keep the URL clean", () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("writes the archive tab only in archive scope", () => {
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, scope: "archive", archiveTab: "deleted" }).get("state")).toBe("deleted");
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, archiveTab: "deleted" }).has("state")).toBe(false);
  });
});

describe("hasActiveFilters / clear / reset", () => {
  it("false for defaults, true for any filter or shortcut", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, preset: "today" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, storefrontIds: ["s"] })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, pageSize: 100 })).toBe(false);
  });

  it("clears one field at a time", () => {
    const f = { ...DEFAULT_FILTERS, dateFrom: "2026-10-01", dateTo: "2026-10-02", cities: ["x"], preset: "today" as const };
    expect(clearFilterField(f, "date")).toMatchObject({ dateFrom: null, dateTo: null, cities: ["x"] });
    expect(clearFilterField(f, "cities").cities).toEqual([]);
    expect(clearFilterField(f, "preset").preset).toBe("all");
  });

  it("reset keeps market, page size, scope and archive tab", () => {
    const f: OrderListFilters = {
      ...DEFAULT_FILTERS,
      marketId: "m",
      pageSize: 50,
      scope: "archive",
      archiveTab: "archived",
      q: "x",
      agentIds: ["a"],
    };
    expect(resetFilters(f)).toEqual({ ...DEFAULT_FILTERS, marketId: "m", pageSize: 50, scope: "archive", archiveTab: "archived" });
  });
});

describe("listQuerySchema + csvList", () => {
  it("accepts the new presets and the archive tab", () => {
    expect(listQuerySchema.parse({ preset: "uploaded_today" }).preset).toBe("uploaded_today");
    expect(listQuerySchema.parse({ preset: "callbacks" }).preset).toBe("recall");
    expect(listQuerySchema.parse({ scope: "archive", state: "deleted" }).state).toBe("deleted");
  });

  it("splits, trims and de-duplicates a CSV parameter", () => {
    expect(csvList(" a, b ,a,,")).toEqual(["a", "b"]);
    expect(csvList(undefined)).toEqual([]);
  });
});
