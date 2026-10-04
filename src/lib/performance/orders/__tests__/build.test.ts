import { describe, it, expect } from "vitest";
import { buildView, buildDrill, type BuildInput } from "@/lib/performance/orders/build";
import { resolveWindow } from "@/lib/performance/orders/period";
import { EMPTY_STATE, type PerfState } from "@/lib/performance/orders/query";
import type { Bk, PerfOrder } from "@/lib/performance/orders/facts";

const TODAY = "2026-10-04";
const FIRST = "2026-06-07";
const W = resolveWindow("30d", null, null, TODAY, FIRST);

let seq = 0;
function o(bk: Bk, x: Partial<PerfOrder> = {}): PerfOrder {
  seq += 1;
  return {
    id: `o${seq}`, ref: null, at: "2026-09-20T10:00:00Z", day: "2026-09-20", status: "x", bk,
    agent: "amina", reason: null, sub: null, cause: null, price: 100, city: null,
    lines: [{ p: "tad", v: [], share: 1 }], ...x,
  };
}
const n = (k: number, bk: Bk, x: Partial<PerfOrder> = {}) => Array.from({ length: k }, () => o(bk, x));

const A: PerfOrder[] = [
  // Amina sells Tadabbur: 30 delivered, 10 back, 20 rejected « Autre »
  ...n(30, "d"), ...n(10, "f"), ...n(20, "x", { reason: "autre" }),
  // Sara sells the book: 35 delivered, 5 back
  ...n(35, "d", { agent: "sara", lines: [{ p: "daa", v: [], share: 1 }] }),
  ...n(5, "f", { agent: "sara", lines: [{ p: "daa", v: [], share: 1 }] }),
  // one mixed order, delivered, 200 split 3:1
  o("d", { agent: "sara", price: 200, lines: [{ p: "tad", v: [], share: 0.75 }, { p: "daa", v: [], share: 0.25 }] }),
  // Nour: too few to rank
  ...n(5, "d", { agent: "nour" }),
];
const P: PerfOrder[] = [...n(60, "d", { day: "2026-08-20", at: "2026-08-20T10:00:00Z" }), ...n(20, "f", { day: "2026-08-20" })];

function input(state: Partial<PerfState> = {}, owner = true): BuildInput {
  return {
    state: { ...EMPTY_STATE, ...state },
    today: TODAY, first: FIRST, currency: "LYD", window: W,
    A, P, Bd: null, ads: { "2026-09-20": 500 }, withMoney: owner,
    catalogue: [
      { id: "tad", name: "Coran · Tadabbur", image: null, sizes: [] },
      { id: "daa", name: "Le mal et le remède", image: null, sizes: [] },
      { id: "unused", name: "Jamais commandé", image: null, sizes: [] },
    ],
    agents: [
      { id: "amina", name: "Amina", color: "indigo", avatar: null },
      { id: "sara", name: "Sara", color: "pink", avatar: null },
      { id: "nour", name: "Nour", color: "gold", avatar: null },
    ],
    subLabels: {},
  };
}

describe("buildView — the page for the owner", () => {
  const v = buildView(input());
  it("counts every order once, a mixed one included", () => {
    expect(v.A.n).toBe(106);
    expect(v.A.d).toBe(71);
  });
  it("gives the owner the money, Σ total_price", () => {
    expect(v.A.money).toMatchObject({ mDel: 70 * 100 + 200, mLost: 1500, mRoad: 0 });
    expect(v.days.cols.find((c) => c.day === "2026-09-20")).toMatchObject({ adOn: true, ad: 500 });
  });
  it("lists only the products and agents that matter", () => {
    expect(v.products.map((p) => p.id).sort()).toEqual(["daa", "tad"]);
  });
  it("ranks agents on delivered per 100 REAL orders and leaves the small ones unranked", () => {
    const rows = v.byAgent.rows;
    expect(rows.map((r) => [r.id, r.rank])).toEqual([["sara", 1], ["amina", 2], ["nour", null]]);
    expect(rows.find((r) => r.id === "amina")!.rd).toBeCloseTo(50);
  });
  it("names who the « Autre » leak comes from", () => {
    const autre = v.leaks.find((l) => l.key === "autre")!;
    expect(autre.where).toMatchObject({ kind: "agent", id: "amina" });
  });
});

describe("buildView — a market manager sees no money anywhere", () => {
  const v = buildView(input({}, false));
  it("omits money from A, the period before, and the days", () => {
    expect(v.A.money).toBeUndefined();
    expect(v.P.money).toBeUndefined();
    expect(v.days.cols.find((c) => c.day === "2026-09-20")!.ad).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/mDel|mLost/);
  });
});

describe("filters flow through every block", () => {
  it("a product filter keeps the mixed order and counts only its share of the price", () => {
    const v = buildView(input({ sel: { daa: null } }));
    expect(v.A.n).toBe(41);
    expect(v.A.money!.mDel).toBe(35 * 100 + 50);
    // « Par produit » still shows every product, the selection marked
    expect(v.byProduct.rows.map((r) => [r.id, r.a])).toEqual([["tad", false], ["daa", true]]);
  });
  it("an agent filter narrows « Par produit » to her products", () => {
    const v = buildView(input({ ag: ["sara"] }));
    expect(v.A.n).toBe(41);
    expect(v.byProduct.rows.find((r) => r.id === "daa")!.s.n).toBe(41);
    expect(v.byProduct.rows.find((r) => r.id === "tad")).toBeUndefined(); // 1 order < 10
    // « Par agent » keeps the whole team, the selection marked
    expect(v.byAgent.rows.find((r) => r.id === "sara")!.a).toBe(true);
    expect(v.byAgent.rows).toHaveLength(3);
  });
  it("B = other agents on the same products, with a thin bar per product", () => {
    const v = buildView(input({ ag: ["amina"], cmp: { kind: "a", ag: ["sara"] } }));
    expect(v.B!.s.n).toBe(41);
    // Amina's product keeps its row; B (Sara) sold it only once: too few for a thin bar
    expect(v.byProduct.rows.map((r) => r.id)).toEqual(["tad"]);
    expect(v.byProduct.rows[0].thinB).toBeNull();
    const vd = buildView(input({ cmp: { kind: "a", ag: ["sara"] } }));
    expect(vd.byProduct.rows.find((r) => r.id === "daa")!.thinB!.n).toBe(41);
    expect(v.byAgent.rows.find((r) => r.id === "sara")!.b).toBe(true);
  });
  it("arrows compare to the period before when both are final and large", () => {
    expect(buildView(input()).comparable).toEqual({ ok: true });
  });
});

describe("buildDrill — down to the orders", () => {
  it("lists a leak's orders with their breakdowns, and the value for the owner only", () => {
    const d = buildDrill(input(), "fam:autre", null, 40)!;
    expect(d.n).toBe(20);
    expect(d.breakdowns.a).toEqual([["amina", 20]]);
    expect(d.value).toBe(2000);
    expect(buildDrill(input({}, false), "fam:autre", null, 40)!.value).toBeUndefined();
  });
  it("narrows to one breakdown entry and pages the list", () => {
    const d = buildDrill(input(), "out:del", { t: "a", v: "sara" }, 5)!;
    expect(d.n).toBe(71);
    expect(d.total).toBe(36);
    expect(d.orders).toHaveLength(5);
  });
  it("refuses an unknown key", () => {
    expect(buildDrill(input(), "nope:1", null, 40)).toBeNull();
  });
});
