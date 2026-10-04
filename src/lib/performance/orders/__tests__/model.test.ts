import { describe, it, expect } from "vitest";
import {
  summarize,
  round100,
  comparability,
  famRows,
  whereLeak,
  realDel,
} from "@/lib/performance/orders/model";
import type { Bk, PerfOrder } from "@/lib/performance/orders/facts";
import { resolveWindow } from "@/lib/performance/orders/period";

let seq = 0;
export function mk(bk: Bk, extra: Partial<PerfOrder> = {}): PerfOrder {
  seq += 1;
  return {
    id: `o${seq}`, ref: null, at: "2026-09-10T10:00:00Z", day: "2026-09-10", status: "x", bk,
    agent: "a1", reason: null, sub: null, cause: null, price: 100, city: null,
    lines: [{ p: "p1", v: [], share: 1 }], ...extra,
  };
}
const many = (k: number, bk: Bk, extra: Partial<PerfOrder> = {}) => Array.from({ length: k }, () => mk(bk, extra));

describe("summarize — one set of rates, shared with Produits and the Salle de contrôle", () => {
  const list = [...many(40, "d"), ...many(10, "f"), ...many(5, "b"), ...many(5, "r"), ...many(10, "x"), ...many(8, "j"), ...many(2, "s"), ...many(15, "c"), ...many(5, "u")];
  const s = summarize(list);
  it("counts buckets and groups", () => {
    expect(s.n).toBe(100);
    expect(s).toMatchObject({ del: 40, ret: 15, rej: 10, junk: 10, pend: 25, up: 60, rejAll: 18 });
  });
  it("confirmation = uploaded ÷ (uploaded + rejected), deleted orders out", () => {
    expect(s.conf).toBeCloseTo((60 / 78) * 100);
  });
  it("delivery = delivered ÷ (delivered + failed)", () => {
    expect(s.deliv).toBeCloseTo(80);
  });
  it("final = 1 − (calling + to upload + on the road) ÷ received", () => {
    expect(s.final).toBeCloseTo(75);
  });
  it("is empty-safe", () => {
    const e = summarize([]);
    expect(e).toMatchObject({ n: 0, conf: null, deliv: null, final: 0 });
    expect(e.p.del).toBe(0);
  });
});

describe("round100 — the waffle always has 100 cells", () => {
  it("gives the leftover cells to the largest remainders", () => {
    const r = round100({ del: 33.4, ret: 33.3, rej: 33.3, junk: 0, pend: 0 });
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.del).toBe(34);
  });
});

describe("comparability — arrows only when both periods are final enough and big enough", () => {
  const w = resolveWindow("30d", null, null, "2026-10-04", "2026-06-07");
  const done = summarize([...many(50, "d"), ...many(10, "f")]);
  it("compares two final, large periods", () => {
    expect(comparability(done, done, w, "2026-06-07")).toEqual({ ok: true });
  });
  it("says why it cannot", () => {
    expect(comparability(done, done, w, "2026-09-01")).toEqual({ ok: false, why: "before_first" });
    const open = summarize([...many(20, "d"), ...many(20, "r")]);
    expect(comparability(open, done, w, "2026-06-07")).toEqual({ ok: false, why: "not_final", final: 50 });
    const small = summarize(many(10, "d"));
    expect(comparability(small, done, w, "2026-06-07")).toEqual({ ok: false, why: "too_few" });
  });
});

describe("famRows — the biggest leaks, by cause", () => {
  const list = [
    ...many(50, "d"),
    ...many(6, "x", { reason: "autre" }),
    ...many(4, "x", { reason: "refus_client", sub: "prix_eleve" }),
    ...many(3, "x", { reason: "refus_client", sub: null }),
    ...many(2, "x", { reason: "injoignable", sub: "pas_de_reponse" }),
    ...many(5, "j", { reason: "commande_invalide", sub: "doublon" }),
    ...many(2, "s", { status: "deleted" }),
    ...many(7, "f", { cause: "3-days-no-response" }),
    ...many(1, "b"),
  ];
  const rows = famRows(list);
  it("classifies every lost order once, biggest first", () => {
    expect(rows.map((r) => [r.key, r.n])).toEqual([
      // ties keep the prototype's family order
      ["junk", 7], ["refus", 7], ["retour", 7], ["autre", 6], ["injoign", 2], ["avant", 1],
    ]);
  });
  it("splits a family by its sub-reasons", () => {
    expect(rows.find((r) => r.key === "refus")!.subs).toEqual([["prix_eleve", 4], ["refus_client", 3]]);
    expect(rows.find((r) => r.key === "junk")!.subs).toEqual([["doublon", 5], ["deleted", 2]]);
    expect(rows.find((r) => r.key === "retour")!.subs).toEqual([["noresp", 7]]);
    expect(rows.find((r) => r.key === "autre")!.subs).toEqual([]);
  });
  it("gives each leak per 100 received", () => {
    expect(rows[0].per).toBeCloseTo((7 / list.length) * 100);
  });
});

describe("whereLeak — the product or agent most over-represented in a leak", () => {
  const a2bad = [
    ...many(40, "d", { agent: "a1" }),
    ...many(2, "x", { agent: "a1", reason: "autre" }),
    ...many(20, "d", { agent: "a2" }),
    ...many(20, "x", { agent: "a2", reason: "autre" }),
  ];
  it("names the agent with the largest excess", () => {
    expect(whereLeak(a2bad, "autre")).toEqual({ kind: "agent", id: "a2", r: 50, avg: Math.round((22 / 82) * 100) });
  });
  it("never blames an agent for orders that were never real", () => {
    const junky = a2bad.map((o) => (o.bk === "x" ? { ...o, bk: "j" as const, sub: "doublon" } : o));
    expect(whereLeak(junky, "junk")).toBeNull();
  });
  it("says « réparti partout » when nobody stands out", () => {
    const even = [...many(40, "d", { agent: "a1" }), ...many(4, "x", { agent: "a1", reason: "autre" }), ...many(40, "d", { agent: "a2" }), ...many(4, "x", { agent: "a2", reason: "autre" })];
    expect(whereLeak(even, "autre")).toEqual({ kind: "spread" });
  });
});

describe("realDel — the fair agent measure", () => {
  it("is delivered per 100 REAL orders", () => {
    const s = summarize([...many(30, "d"), ...many(30, "x"), ...many(40, "j")]);
    expect(realDel(s)).toBeCloseTo(50);
  });
});
