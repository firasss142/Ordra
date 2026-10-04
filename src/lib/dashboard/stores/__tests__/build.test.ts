import { describe, expect, it } from "vitest";
import { buildStoreDash, type BuildInput, type StoreRow } from "../build";
import { resolveDashWindow } from "../period";
import type { StoreOrder } from "../facts";

const TODAY = "2026-10-04";
const NOW = new Date("2026-10-04T15:20:00Z"); // 17:20 in Tripoli

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
  last_order_at: "2026-10-04T15:00:00Z",
  ...o,
});

let seq = 0;
const ord = (o: Partial<StoreOrder>): StoreOrder => ({
  id: `o${seq++}`,
  at: "",
  day: TODAY,
  min: 600,
  store: "a",
  bk: "c",
  doneAt: null,
  upAt: null,
  price: 100,
  deliveryCost: 25,
  returnCost: 0,
  unmapped: false,
  products: [],
  ...o,
});

const input = (o: Partial<BuildInput>): BuildInput => ({
  role: "owner",
  currency: "LYD",
  tz: "Africa/Tripoli",
  now: NOW,
  today: TODAY,
  nowMin: 17 * 60 + 20,
  first: "2026-06-07",
  window: resolveDashWindow("today", null, null, TODAY, "2026-06-07"),
  A: [],
  P: [],
  stores: [store("a"), store("b")],
  daily: new Map(),
  ads: {},
  productNames: new Map(),
  money: null,
  firstDayOf: (iso) => iso.slice(0, 10),
  ...o,
});

describe("buildStoreDash", () => {
  it("today compares with yesterday up to the same hour, and has no rate arrows", () => {
    const v = buildStoreDash(
      input({
        A: [ord({}), ord({})],
        P: [ord({ day: "2026-10-03", min: 600 }), ord({ day: "2026-10-03", min: 23 * 60 })],
      }),
    );
    expect(v.A.n).toBe(2);
    expect(v.P.n).toBe(1);
    expect(v.comparable).toBe(false);
    expect(v.why).toBe("today");
    expect(v.flow).toHaveLength(24);
    expect(v.flow[10].tot).toBe(2);
    expect(v.flow[17].now).toBe(true);
    expect(v.flow[18].fut).toBe(true);
  });

  it("a store with no order is folded on the quiet line; an inactive one is not shown", () => {
    const v = buildStoreDash(input({ A: [ord({})], stores: [store("a"), store("b", { last_order_at: "2026-09-01T10:00:00Z" }), store("c", { is_active: false })] }));
    expect(v.stores.map((s) => s.id)).toEqual(["a"]);
    expect(v.quiet).toEqual([{ id: "b", name: "B", platform: "shopify", lastDay: "2026-09-01", notYet: false }]);
    expect(v.connected).toBe(2);
  });

  it("the period before is read at equal age: a parcel delivered after that moment was still on the road", () => {
    const w = resolveDashWindow("30d", null, null, TODAY, "2026-06-07");
    const asOf = NOW.getTime() - 30 * 86_400_000;
    const A = Array.from({ length: 40 }, () => ord({ day: "2026-09-20", bk: "d", doneAt: NOW.getTime() - 86_400_000 }));
    const P = Array.from({ length: 40 }, () => ord({ day: "2026-08-20", bk: "d", doneAt: asOf + 3_600_000, upAt: asOf - 1 }));
    const v = buildStoreDash(input({ window: w, A, P }));
    expect(v.comparable).toBe(true);
    expect(v.A.r100.del).toBe(100);
    expect(v.P.r100.del).toBe(0);
    expect(v.P.r100.pend).toBe(100);
  });

  it("a manager gets no money, not even a store's paid amount", () => {
    const v = buildStoreDash(input({ role: "manager", A: [ord({ bk: "d" })] }));
    expect(v.money).toBeNull();
    expect(v.stores[0].paid).toBeUndefined();
  });

  it("the owner gets each store's paid amount", () => {
    const v = buildStoreDash(input({ A: [ord({ bk: "d", price: 210 }), ord({ bk: "f", price: 90 })] }));
    expect(v.stores[0].paid).toBe(210);
  });
});
