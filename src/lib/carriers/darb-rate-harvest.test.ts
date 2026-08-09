import { describe, test, expect, vi } from "vitest";
import {
  buildHarvestPlan,
  cellKey,
  orderCellsByStaleness,
  toRateUpsertRow,
  summarizeHarvest,
  runHarvest,
  type HarvestCell,
} from "./darb-rate-harvest";
import type { DarbQuoteResult } from "./darb-rate-quote";
import { DARB_ASSABIL_CITIES } from "./darb-assabil-areas";

const TRIPOLI = { carrierId: "c-tripoli", serviceId: "svc-1" };
const BENGHAZI = { carrierId: "c-benghazi", serviceId: "svc-1" };

const DESTS = [
  { city: "طرابلس", area: "الرياضية" },
  { city: "بنغازي", area: "قمينس" },
];

const NOW = "2026-08-08T12:00:00.000Z";
const RUN = "run-1";

const okResult: DarbQuoteResult = {
  ok: true,
  shippingAmount: 15,
  currency: "lyd",
  breakdown: { branchToBranch: 10, pickFromDoor: 0, dropToDoor: 5 },
};
const errResult: DarbQuoteResult = {
  ok: false,
  httpStatus: 500,
  errorMessage: "Unable to fetch branch 'LBY-x,y'!",
};

describe("buildHarvestPlan", () => {
  test("emits one cell per carrier x destination", () => {
    const cells = buildHarvestPlan({ carriers: [TRIPOLI, BENGHAZI], destinations: DESTS });
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({
      carrierId: "c-tripoli",
      serviceId: "svc-1",
      city: "طرابلس",
      area: "الرياضية",
    });
  });

  // The real catalogue: 25 cities, 278 (city, area) combos, two accounts.
  // Probe 2026-08-08 established the price is invariant to service, quantity,
  // paymentBy and order value, so there are no further dimensions to multiply by.
  test("covers the full catalogue in 556 cells for two accounts", () => {
    const destinations = Object.entries(DARB_ASSABIL_CITIES).flatMap(([city, areas]) =>
      areas.map((area) => ({ city, area })),
    );
    expect(destinations).toHaveLength(278);
    expect(buildHarvestPlan({ carriers: [TRIPOLI, BENGHAZI], destinations })).toHaveLength(556);
  });

  // A run capped by `limit` resumes next cycle; that only works if the order
  // is stable across runs.
  test("is deterministically ordered", () => {
    const a = buildHarvestPlan({ carriers: [TRIPOLI, BENGHAZI], destinations: DESTS });
    const b = buildHarvestPlan({ carriers: [TRIPOLI, BENGHAZI], destinations: DESTS });
    expect(a).toEqual(b);
  });

  test("returns nothing when there are no carriers or no destinations", () => {
    expect(buildHarvestPlan({ carriers: [], destinations: DESTS })).toEqual([]);
    expect(buildHarvestPlan({ carriers: [TRIPOLI], destinations: [] })).toEqual([]);
  });
});

describe("orderCellsByStaleness", () => {
  const cells = buildHarvestPlan({
    carriers: [TRIPOLI],
    destinations: [
      { city: "طرابلس", area: "a" },
      { city: "طرابلس", area: "b" },
      { city: "طرابلس", area: "c" },
    ],
  });
  // Build keys through cellKey rather than hand-writing the separator — the
  // real caller keys DB rows the same way, and the separator is an internal detail.
  const key = (area: string) => cellKey({ carrierId: "c-tripoli", city: "طرابلس", area });

  test("puts never-harvested cells first", () => {
    const ordered = orderCellsByStaleness(
      cells,
      new Map([
        [key("a"), "2026-08-01T00:00:00.000Z"],
        [key("c"), "2026-08-02T00:00:00.000Z"],
      ]),
    );
    expect(ordered[0].area).toBe("b");
  });

  test("orders the rest oldest-attempt first", () => {
    const ordered = orderCellsByStaleness(
      cells,
      new Map([
        [key("a"), "2026-08-03T00:00:00.000Z"],
        [key("b"), "2026-08-01T00:00:00.000Z"],
        [key("c"), "2026-08-02T00:00:00.000Z"],
      ]),
    );
    expect(ordered.map((c) => c.area)).toEqual(["b", "c", "a"]);
  });

  // A capped run must resume where it left off, which needs a total order.
  test("is stable for equal timestamps", () => {
    const same = "2026-08-01T00:00:00.000Z";
    const ordered = orderCellsByStaleness(
      cells,
      new Map([
        [key("a"), same],
        [key("b"), same],
        [key("c"), same],
      ]),
    );
    expect(ordered.map((c) => c.area)).toEqual(["a", "b", "c"]);
  });

  test("keeps plan order when nothing has been harvested", () => {
    expect(orderCellsByStaleness(cells, new Map())).toEqual(cells);
  });

  test("does not drop or duplicate cells", () => {
    const ordered = orderCellsByStaleness(cells, new Map([[key("b"), "2026-08-01T00:00:00.000Z"]]));
    expect(ordered).toHaveLength(cells.length);
    expect(new Set(ordered.map((c) => c.area))).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("toRateUpsertRow", () => {
  const cell: HarvestCell = {
    carrierId: "c-tripoli",
    serviceId: "svc-1",
    city: "طرابلس",
    area: "الرياضية",
  };

  test("a successful quote writes the price, breakdown and provenance", () => {
    expect(toRateUpsertRow(cell, okResult, NOW, RUN)).toEqual({
      carrier_id: "c-tripoli",
      city: "طرابلس",
      area: "الرياضية",
      shipping_amount: 15,
      currency: "lyd",
      breakdown: { branchToBranch: 10, pickFromDoor: 0, dropToDoor: 5 },
      quoted_with_service_id: "svc-1",
      quoted_with_amount: 100,
      status: "ok",
      http_status: null,
      error_message: null,
      quoted_at: NOW,
      harvest_run_id: RUN,
    });
  });

  test("a failed quote records the error and leaves the price null", () => {
    const row = toRateUpsertRow(cell, errResult, NOW, RUN);
    expect(row.status).toBe("error");
    expect(row.shipping_amount).toBeNull();
    expect(row.breakdown).toBeNull();
    expect(row.http_status).toBe(500);
    expect(row.error_message).toBe("Unable to fetch branch 'LBY-x,y'!");
  });

  // The single most dangerous confusion in this feature.
  test("never writes 0 as the price for a failed quote", () => {
    expect(toRateUpsertRow(cell, errResult, NOW, RUN).shipping_amount).not.toBe(0);
  });

  test("preserves a genuine zero price from a successful quote", () => {
    const row = toRateUpsertRow(cell, { ...okResult, shippingAmount: 0 }, NOW, RUN);
    expect(row.status).toBe("ok");
    expect(row.shipping_amount).toBe(0);
  });
});

describe("summarizeHarvest", () => {
  test("counts successes and failures", () => {
    const cell: HarvestCell = { carrierId: "c", serviceId: "s", city: "x", area: "y" };
    const rows = [
      toRateUpsertRow(cell, okResult, NOW, RUN),
      toRateUpsertRow(cell, okResult, NOW, RUN),
      toRateUpsertRow(cell, errResult, NOW, RUN),
    ];
    expect(summarizeHarvest(rows)).toEqual({ requested: 3, succeeded: 2, failed: 1 });
  });

  test("handles an empty run", () => {
    expect(summarizeHarvest([])).toEqual({ requested: 0, succeeded: 0, failed: 0 });
  });
});

describe("runHarvest", () => {
  function deps(overrides: Partial<Parameters<typeof runHarvest>[0]> = {}) {
    const cells = buildHarvestPlan({ carriers: [TRIPOLI, BENGHAZI], destinations: DESTS });
    return {
      cells,
      quote: vi.fn().mockResolvedValue(okResult),
      upsert: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(NOW),
      runId: RUN,
      ...overrides,
    };
  }

  test("quotes every cell exactly once and upserts the results", async () => {
    const d = deps();
    const summary = await runHarvest(d);
    expect(d.quote).toHaveBeenCalledTimes(4);
    expect(summary).toMatchObject({ requested: 4, succeeded: 4, failed: 0, status: "completed" });
    const upserted = (d.upsert as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[0]);
    expect(upserted).toHaveLength(4);
  });

  test("one failing cell does not abort the run", async () => {
    const quote = vi
      .fn()
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce(errResult)
      .mockResolvedValue(okResult);
    const summary = await runHarvest(deps({ quote }));
    expect(quote).toHaveBeenCalledTimes(4);
    expect(summary).toMatchObject({ requested: 4, succeeded: 3, failed: 1, status: "partial" });
  });

  test("a thrown quote becomes an error row rather than killing the run", async () => {
    const quote = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue(okResult);
    const summary = await runHarvest(deps({ quote }));
    expect(summary.requested).toBe(4);
    expect(summary.failed).toBe(1);
  });

  // The 401-after-key-rotation case: a systematically broken account must stop
  // burning calls, and must be visible rather than silently producing no rates.
  test("opens the circuit after N consecutive failures and reports partial", async () => {
    const cells = buildHarvestPlan({
      carriers: [TRIPOLI],
      destinations: Array.from({ length: 20 }, (_, i) => ({ city: "c", area: `a${i}` })),
    });
    const quote = vi.fn().mockResolvedValue(errResult);
    const summary = await runHarvest(deps({ cells, quote, maxConsecutiveFailures: 5 }));
    expect(quote.mock.calls.length).toBeLessThan(20);
    expect(summary.status).toBe("partial");
    expect(summary.circuitOpened).toBe(true);
  });

  test("a success resets the consecutive-failure counter", async () => {
    const cells = buildHarvestPlan({
      carriers: [TRIPOLI],
      destinations: Array.from({ length: 9 }, (_, i) => ({ city: "c", area: `a${i}` })),
    });
    // fail, fail, ok, fail, fail, ok, … never three in a row
    const quote = vi.fn().mockImplementation(() => {
      const n = quote.mock.calls.length - 1;
      return Promise.resolve(n % 3 === 2 ? okResult : errResult);
    });
    const summary = await runHarvest(deps({ cells, quote, maxConsecutiveFailures: 3 }));
    expect(quote).toHaveBeenCalledTimes(9);
    expect(summary.circuitOpened).toBe(false);
  });

  test("honours the cell limit", async () => {
    const d = deps({ limit: 2 });
    const summary = await runHarvest(d);
    expect(d.quote).toHaveBeenCalledTimes(2);
    expect(summary.requested).toBe(2);
  });

  test("spaces calls using the injected sleep", async () => {
    const d = deps({ delayMs: 250 });
    await runHarvest(d);
    expect(d.sleep).toHaveBeenCalledWith(250);
  });

  test("batches upserts rather than writing one row at a time", async () => {
    const cells = buildHarvestPlan({
      carriers: [TRIPOLI],
      destinations: Array.from({ length: 10 }, (_, i) => ({ city: "c", area: `a${i}` })),
    });
    const d = deps({ cells, batchSize: 4 });
    await runHarvest(d);
    // 10 rows at 4 per batch = 3 writes
    expect((d.upsert as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  test("is idempotent — a replay produces the same rows", async () => {
    const a = deps();
    const b = deps();
    await runHarvest(a);
    await runHarvest(b);
    const rowsA = (a.upsert as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[0]);
    const rowsB = (b.upsert as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[0]);
    expect(rowsA).toEqual(rowsB);
  });

  test("returns a completed summary for an empty plan without calling out", async () => {
    const d = deps({ cells: [] });
    const summary = await runHarvest(d);
    expect(d.quote).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ requested: 0, status: "completed" });
  });
});
