import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  clearFilterField,
  decodeCursor,
  encodeCursor,
  filtersToSearchParams,
  hasActiveFilters,
  parseFiltersFromSearchParams,
  resetFilters,
} from "../list-filters";

describe("parseFiltersFromSearchParams", () => {
  it("returns defaults for empty params", () => {
    const f = parseFiltersFromSearchParams(new URLSearchParams());
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it("parses preset + statuses + agent + dates + numeric range", () => {
    const p = new URLSearchParams({
      preset: "callbacks",
      status: "attempt_1,attempt_2,confirmed",
      agent_id: "unassigned",
      date_from: "2026-04-01",
      date_to: "2026-04-22",
      total_min: "10",
      total_max: "500",
      rejection_reason: "prix",
      include_deleted: "1",
    });
    const f = parseFiltersFromSearchParams(p);
    expect(f.preset).toBe("callbacks");
    expect(f.statuses).toEqual(["attempt_1", "attempt_2", "confirmed"]);
    expect(f.agentId).toBe("unassigned");
    expect(f.dateFrom).toBe("2026-04-01");
    expect(f.dateTo).toBe("2026-04-22");
    expect(f.totalMin).toBe(10);
    expect(f.totalMax).toBe(500);
    expect(f.rejectionReason).toBe("prix");
    expect(f.includeDeleted).toBe(true);
  });

  it("drops invalid preset, invalid status, malformed date", () => {
    const p = new URLSearchParams({
      preset: "bogus",
      status: "attempt_1,not_a_status,confirmed",
      date_from: "04/01/2026",
    });
    const f = parseFiltersFromSearchParams(p);
    expect(f.preset).toBe("all");
    expect(f.statuses).toEqual(["attempt_1", "confirmed"]);
    expect(f.dateFrom).toBeNull();
  });
});

describe("filtersToSearchParams round-trip", () => {
  it("survives encode → decode for a busy filter (marketId is not URL-serialized)", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      preset: "unassigned" as const,
      q: "216 55",
      statuses: ["attempt_1" as const, "attempt_2" as const],
      agentId: "unassigned" as const,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-22",
      city: "Tunis",
      totalMin: 10,
      totalMax: 500,
      rejectionReason: "refus_client" as const,
    };
    const params = filtersToSearchParams(filters);
    const parsed = parseFiltersFromSearchParams(params);
    expect(parsed).toEqual(filters);
  });

  it("does not include market_id in the URL even if marketId is set", () => {
    const params = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      marketId: "11111111-2222-3333-4444-555555555555",
    });
    expect(params.has("market_id")).toBe(false);
    expect(params.toString()).toBe("");
  });

  it("omits default keys to keep URL clean", () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS);
    expect(params.toString()).toBe("");
  });

  it("round-trips include_deleted=1 and omits it when false", () => {
    const params = filtersToSearchParams({ ...DEFAULT_FILTERS, includeDeleted: true });
    expect(params.get("include_deleted")).toBe("1");
    expect(parseFiltersFromSearchParams(params).includeDeleted).toBe(true);
    expect(filtersToSearchParams({ ...DEFAULT_FILTERS, includeDeleted: false }).has("include_deleted")).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("false for defaults", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });
  it("true when preset changes", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, preset: "callbacks" })).toBe(true);
  });
  it("true when any filter is set", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, city: "Tunis" })).toBe(true);
  });
  it("true when deleted orders are included", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, includeDeleted: true })).toBe(true);
  });
});

describe("clearFilterField", () => {
  it("clears date range with a single call", () => {
    const f = { ...DEFAULT_FILTERS, dateFrom: "2026-04-01", dateTo: "2026-04-22" };
    expect(clearFilterField(f, "date")).toMatchObject({ dateFrom: null, dateTo: null });
  });
  it("clears statuses", () => {
    const f = { ...DEFAULT_FILTERS, statuses: ["confirmed" as const] };
    expect(clearFilterField(f, "statuses").statuses).toEqual([]);
  });
});

describe("resetFilters", () => {
  it("preserves marketId but clears everything else", () => {
    const f = {
      ...DEFAULT_FILTERS,
      marketId: "m-1",
      preset: "callbacks" as const,
      q: "x",
      statuses: ["confirmed" as const],
    };
    const reset = resetFilters(f);
    expect(reset.marketId).toBe("m-1");
    expect(reset.preset).toBe("all");
    expect(reset.q).toBe("");
    expect(reset.statuses).toEqual([]);
    expect(reset.includeDeleted).toBe(false);
  });
});

describe("cursor", () => {
  it("round-trips a cursor", () => {
    const c = { createdAt: "2026-04-22T10:00:00.000Z", id: "abc-123" };
    const encoded = encodeCursor(c);
    expect(decodeCursor(encoded)).toEqual(c);
  });
  it("rejects malformed input", () => {
    expect(decodeCursor("not-base64!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("no-pipe", "utf8").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("bad-ts|abc", "utf8").toString("base64url"))).toBeNull();
  });
});
