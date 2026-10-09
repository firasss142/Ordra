import { describe, expect, it } from "vitest";
import { buildStoreDash, type BuildInput, type StoreRow } from "../build";
import { resolveDashWindow } from "../period";
import { shiftDays } from "@/lib/performance/orders/period";
import type { StoreOrder } from "../facts";

const TODAY = "2026-10-07"; // a Wednesday
const NOW = new Date("2026-10-07T07:41:00Z"); // 09:41 in Tripoli
const NOW_MIN = 9 * 60 + 41;

const store = (id: string, o: Partial<StoreRow> = {}): StoreRow => ({
  id,
  name: id.toUpperCase(),
  platform: "shopify",
  sheet_adapter: null,
  is_active: true,
  accent_color: null,
  last_webhook_status: null,
  last_webhook_error: null,
  webhook_failure_count: 0,
  sheet_failures: 0,
  sheet_failing_since: null,
  sheet_error: null,
  first_order_at: "2026-06-10T10:00:00Z",
  last_order_at: "2026-10-07T07:30:00Z",
  ...o,
});

let seq = 0;
const ord = (o: Partial<StoreOrder>): StoreOrder => ({
  id: `o${seq++}`,
  at: "",
  day: TODAY,
  min: 300,
  store: "a",
  bk: "c",
  doneAt: null,
  upAt: null,
  price: 100,
  deliveryCost: 25,
  returnCost: 0,
  unmapped: false,
  tried: false,
  products: [],
  ...o,
});
const many = (n: number, o: Partial<StoreOrder>) => Array.from({ length: n }, () => ord(o));

const input = (o: Partial<BuildInput>): BuildInput => ({
  role: "owner",
  currency: "LYD",
  tz: "Africa/Tripoli",
  now: NOW,
  today: TODAY,
  nowMin: NOW_MIN,
  first: "2026-06-07",
  window: resolveDashWindow("today", null, null, TODAY, "2026-06-07"),
  A: [],
  P: [],
  H: [],
  stores: [store("a"), store("b")],
  daily: new Map(),
  ads: {},
  productNames: new Map(),
  firstDayOf: (iso) => iso.slice(0, 10),
  ...o,
});

describe("buildStoreDash — a day", () => {
  // The 4 Wednesdays before: 10 orders each by 09:41.
  const usual = [7, 14, 21, 28].flatMap((k) => many(10, { day: shiftDays(TODAY, -k), min: 200 }));
  const yesterday = many(6, { day: shiftDays(TODAY, -1), min: 900, price: 50 });

  it("judges today's pace against the same weekday, and shows yesterday's total beside it", () => {
    const v = buildStoreDash(input({ A: many(9, {}), H: [...usual, ...yesterday] }));
    expect(v.kpi).toMatchObject({ n: 9, val: 900, verdict: "normal", yN: 6, yVal: 300, prevN: null });
  });

  it("the sparkline is the 14 days up to today, today hatched", () => {
    const v = buildStoreDash(input({ A: many(9, {}), H: [...usual, ...yesterday] }));
    expect(v.kpi.spark).toHaveLength(14);
    expect(v.kpi.spark[13]).toMatchObject({ from: TODAY, n: 9, part: true });
    expect(v.kpi.spark[12]).toMatchObject({ n: 6, val: 300, part: false });
    expect(v.kpi.spark[6]).toMatchObject({ from: shiftDays(TODAY, -7), n: 10, part: false });
  });

  it("a manager never receives a price", () => {
    const v = buildStoreDash(input({ role: "manager", A: many(3, {}), H: yesterday }));
    expect(v.kpi.val).toBeNull();
    expect(v.kpi.yVal).toBeNull();
    expect(v.kpi.spark.every((b) => b.val === 0)).toBe(true);
    expect(v.stores[0].ca).toBeNull();
  });

  it("the four tiles and the gap always add up to the store's count", () => {
    const A = [
      ...many(2, { bk: "c" }),
      ...many(3, { bk: "c", tried: true }),
      ord({ bk: "u" }),
      ...many(2, { bk: "r" }),
      ord({ bk: "d" }),
      ord({ bk: "x" }),
      ord({ bk: "j" }),
      ord({ bk: "s" }),
    ];
    const v = buildStoreDash(input({ A }));
    const t = v.stores[0].tiles;
    expect(t).toEqual({ wait: 2, tried: 3, up: 3, rej: 3, gap: 1 });
    expect(t.wait + t.tried + t.up + t.rej + t.gap).toBe(v.stores[0].n);
  });

  it("a stopped store with no order today keeps its card (bug 1), with its cause", () => {
    const daily = new Map([["b", new Map(Array.from({ length: 14 }, (_, i) => [shiftDays(TODAY, -7 - i), 40] as [string, number]))]]);
    // ads paid until 7 days ago, at zero since — the day the store stopped
    const ads = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [shiftDays(TODAY, -7 - i), 900]));
    const v = buildStoreDash(input({ A: many(4, {}), daily, ads }));
    const b = v.stores.find((s) => s.id === "b")!;
    expect(b).toMatchObject({ n: 0, alarm: true, flagged: true });
    expect(b.note).toMatchObject({ kind: "stopped", ads: true });
    expect(v.silent).toHaveLength(0);
  });

  it("a quiet store with nothing wrong folds into the silent line; a never-ordered one waits", () => {
    const v = buildStoreDash(
      input({
        A: many(2, {}),
        stores: [store("a"), store("b"), store("c", { first_order_at: null, last_order_at: null, created_at: "2026-10-06T16:40:00Z" })],
      }),
    );
    expect(v.silent.map((s) => s.id)).toEqual(["b"]);
    expect(v.stores.find((s) => s.id === "c")).toMatchObject({ note: { kind: "waiting" }, connectedAt: "2026-10-06T16:40:00Z" });
  });

  it("store pace is judged on its own usual day", () => {
    const v = buildStoreDash(input({ A: many(2, {}), H: usual }));
    expect(v.stores[0].pace).toBe("none");
  });
});

describe("buildStoreDash — a period", () => {
  const w = resolveDashWindow("7d", null, null, TODAY, "2026-06-07");

  it("compares with the period before, and sums its CA", () => {
    const v = buildStoreDash(input({ window: w, A: many(10, { bk: "d", price: 80 }), P: many(8, { day: shiftDays(TODAY, -9), price: 50 }) }));
    expect(v.kpi).toMatchObject({ n: 10, val: 800, paid: 800, prevN: 8, prevVal: 400, verdict: null, yN: null });
    expect(v.kpi.spark).toHaveLength(7);
    expect(v.kpi.spark[6]).toMatchObject({ from: TODAY, n: 10, part: true });
  });

  it("beyond 45 days the bars are Monday–Sunday weeks, a cut week hatched", () => {
    const v = buildStoreDash(input({ window: resolveDashWindow("90d", null, null, TODAY, "2026-01-01"), A: many(3, {}) }));
    const sp = v.kpi.spark;
    expect(new Date(`${sp[1].from}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(sp[0].part).toBe(true);
    expect(sp[sp.length - 1]).toMatchObject({ to: TODAY, part: true, n: 3 });
  });

  it("confirmed counts orders awaiting upload; delivered is over parcels that ended", () => {
    const A = [ord({ bk: "u" }), ord({ bk: "r" }), ...many(3, { bk: "d" }), ord({ bk: "f" }), ord({ bk: "x" }), ord({ bk: "c" })];
    const s = buildStoreDash(input({ window: w, A })).stores[0];
    expect(s.conf).toBe(6);
    expect(s.confRate).toBeCloseTo((6 / 7) * 100);
    expect(s.delRate).toBe(75);
    expect(s.ring).toEqual({ del: 3, route: 2, ret: 1, rej: 1, junk: 0, call: 1 });
  });
});
