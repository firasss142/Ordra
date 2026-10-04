import { describe, it, expect } from "vitest";
import {
  classify,
  outcomesOf,
  per100,
  round100,
  rank,
  leaks,
  mapPoint,
  mapTeam,
  defaultDay,
  productGrid,
  type AgentFacts,
  type Outcomes,
} from "@/lib/team/performance/model";
import type { OrderFact } from "@/lib/team/performance/facts";

const fact = (x: Partial<OrderFact>): OrderFact => ({
  a: "a1", cur: true, st: "pending", upl: false, rsn: null, sub: null, p: null, noTry: null, late: null, ...x,
});

describe("classify — one bucket per order (plan §4)", () => {
  it("delivered", () => expect(classify(fact({ st: "delivered", upl: true }))).toEqual({ k: "del" }));
  it("uploaded then cancelled or back = retournée", () => {
    for (const st of ["cancelled", "returning", "to_be_returned", "returned", "received"])
      expect(classify(fact({ st, upl: true })).k).toBe("ret");
  });
  it("on the road and in her queue = en cours", () => {
    expect(classify(fact({ st: "in_transit", upl: true }))).toEqual({ k: "pend", road: true });
    expect(classify(fact({ st: "attempt_2" }))).toEqual({ k: "pend" });
    expect(classify(fact({ st: "confirmed" }))).toEqual({ k: "pend" });
  });
  it("never real: the junk sub-reasons, deleted, cancelled before upload", () => {
    for (const sub of ["non_commande", "doublon", "simple_info", "numero_invalide", "numero_hors_service", "mauvais_interlocuteur"])
      expect(classify(fact({ st: "rejected", sub })).k).toBe("junk");
    expect(classify(fact({ st: "deleted" })).k).toBe("junk");
    expect(classify(fact({ st: "cancelled", upl: false })).k).toBe("junk");
  });
  it("every other rejection is rejetée, « Autre » flagged", () => {
    expect(classify(fact({ st: "rejected", sub: "non_serieux" }))).toEqual({ k: "rej" });
    expect(classify(fact({ st: "rejected", sub: "autre" }))).toEqual({ k: "rej", autre: true });
    expect(classify(fact({ st: "rejected", rsn: "autre", sub: null }))).toEqual({ k: "rej", autre: true });
  });
});

describe("outcomes per 100", () => {
  const o = outcomesOf([
    fact({ st: "delivered" }), fact({ st: "delivered" }), fact({ st: "in_transit", upl: true }),
    fact({ st: "returned", upl: true }), fact({ st: "rejected", sub: "autre" }), fact({ st: "deleted" }),
  ]);
  it("counts", () => expect(o).toEqual({ a: 6, del: 2, road: 1, pend: 1, ret: 1, rej: 1, autre: 1, junk: 1 }));
  it("round100 always adds up to 100 (largest remainder)", () => {
    const r = round100(per100(o));
    expect(r.del + r.ret + r.rej + r.junk + r.pend).toBe(100);
    expect(r.del).toBe(33);
  });
  it("an empty cohort is all zeros", () => {
    const e = outcomesOf([]);
    expect(per100(e)).toEqual({ del: 0, pend: 0, ret: 0, rej: 0, junk: 0 });
  });
});

// ── The prototype's own 30-day figures (prototypes/team-performance-v3.html, CO/SUB/FIRST/LATE) ──
// [attribuées, livrées, en route, dans sa file, retournées, jamais réelles, « Autre », autres rejets, supprimées]
type Tuple = [number, number, number, number, number, number, number, number, number];
function outcomesFromTuple([a, d, road, open, ret, junk, autre, rej, del]: Tuple): Outcomes {
  return { a, del: d, road, pend: road + open, ret, rej: autre + rej, autre, junk: junk + del };
}
const CO: Record<string, Tuple> = {
  tasnim: [575, 145, 8, 28, 88, 2, 291, 5, 8], salima: [470, 79, 6, 0, 109, 75, 0, 194, 7],
  roqaya: [337, 49, 7, 0, 41, 151, 14, 73, 2], hend: [138, 15, 0, 1, 24, 41, 3, 53, 1], mouna: [4, 2, 0, 0, 1, 0, 0, 0, 1],
};
const SUB: Record<string, Record<string, number>> = {
  tasnim: { autre: 291, prix_eleve: 3, non_commande: 2, changement_avis: 1, pas_de_reponse: 1 },
  salima: { non_serieux: 116, changement_avis: 47, non_commande: 36, simple_info: 26, produit_non_voulu: 14, prix_eleve: 10, doublon: 5, numero_invalide: 5, pas_de_reponse: 4, numero_hors_service: 2, raccroche: 2, mauvais_interlocuteur: 1, achete_ailleurs: 1 },
  roqaya: { non_commande: 88, simple_info: 37, prix_eleve: 32, pas_de_reponse: 17, autre: 14, non_serieux: 12, doublon: 10, numero_hors_service: 9, changement_avis: 8, mauvais_interlocuteur: 5, numero_invalide: 2, achete_ailleurs: 2, hors_couverture: 2 },
  hend: { pas_de_reponse: 22, numero_hors_service: 19, non_commande: 17, changement_avis: 13, non_serieux: 8, prix_eleve: 5, raccroche: 4, autre: 3, numero_invalide: 2, mauvais_interlocuteur: 2, simple_info: 1, produit_non_voulu: 1 },
  mouna: {},
};
const FIRST: Record<string, [number, number]> = { tasnim: [298, 148], salima: [269, 178], roqaya: [238, 118], hend: [97, 21], mouna: [0, 0] };
const LATE: Record<string, number> = { tasnim: 52, salima: 70, roqaya: 27, hend: 48, mouna: 0 };
const FACTS: Record<string, AgentFacts> = Object.fromEntries(
  Object.keys(CO).map((k) => [k, { o: outcomesFromTuple(CO[k]), sub: SUB[k], rejTotal: FIRST[k][0], noTry: FIRST[k][1], late: LATE[k] }]),
);
const others = (me: string) => Object.keys(FACTS).filter((k) => k !== me).map((k) => FACTS[k]);

describe("leaks — what she does more than the rest of the team, in orders (plan §5)", () => {
  it("reproduces the prototype's 30-day result for every agent", () => {
    expect(leaks(FACTS.tasnim, others("tasnim")).map((l) => l.key)).toEqual(["autre"]);
    expect(leaks(FACTS.salima, others("salima")).slice(0, 3).map((l) => l.key)).toEqual(["non_serieux", "first", "changement_avis"]);
    expect(leaks(FACTS.roqaya, others("roqaya")).slice(0, 3).map((l) => l.key)).toEqual(["non_commande", "simple_info", "prix_eleve"]);
    expect(leaks(FACTS.hend, others("hend")).slice(0, 3).map((l) => l.key)).toEqual(["late", "pas_de_reponse", "numero_hors_service"]);
  });
  it("carries her rate, the others' rate, the excess and the unit", () => {
    const [l] = leaks(FACTS.tasnim, others("tasnim"));
    expect(l).toMatchObject({ type: "autre", her: 291, base: 575, unit: "att" });
    expect(l.hr).toBeCloseTo(291 / 575);
    expect(l.rr).toBeCloseTo(17 / 949);
    expect(l.ex).toBeCloseTo(291 - (17 / 949) * 575);
  });
  it("the returned leak counts parcels that left, the first-call leak counts her rejections", () => {
    const s = leaks(FACTS.salima, others("salima")).find((l) => l.key === "first")!;
    expect(s).toMatchObject({ type: "first", her: 178, base: 269, unit: "rej" });
  });
  it("needs 30 attributed orders", () => expect(leaks(FACTS.mouna, others("mouna"))).toEqual([]));
  it("an excess under max(8, 3 %) is not a leak", () => {
    const me: AgentFacts = { o: { a: 100, del: 20, road: 0, pend: 0, ret: 0, rej: 10, autre: 0, junk: 0 }, sub: { prix_eleve: 10 }, rejTotal: 10, noTry: 0, late: 0 };
    const rest: AgentFacts = { o: { a: 100, del: 20, road: 0, pend: 0, ret: 0, rej: 3, autre: 0, junk: 0 }, sub: { prix_eleve: 3 }, rejTotal: 3, noTry: 0, late: 0 };
    expect(leaks(me, [rest])).toEqual([]); // excess 7 < 8
  });
});

describe("rank — livrées pour 100 attribuées, from 30 orders", () => {
  it("ranks by score, keeps the small ones apart", () => {
    const cur = Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, f.o]));
    const r = rank(cur, { tasnim: { ...FACTS.tasnim.o, a: 300, del: 64 } });
    expect(r.ranked.map((x) => x.id)).toEqual(["tasnim", "salima", "roqaya", "hend"]);
    expect(r.ranked[0]).toMatchObject({ rank: 1 });
    expect(r.ranked[0].score).toBeCloseTo(145 / 575 * 100);
    expect(r.ranked[0].prev).toBeCloseTo(64 / 300 * 100);
    expect(r.ranked[1].prev).toBeNull();
    expect(r.hors).toEqual([{ id: "mouna", n: 4 }]);
  });
});

describe("débit × taux", () => {
  it("places from 30 decisions and an hour on shift, with last period's point when it qualifies", () => {
    expect(mapPoint({ id: "x", up: 10, rej: 10, min: 600 })).toBeNull();
    expect(mapPoint({ id: "x", up: 30, rej: 30, min: 50 })).toBeNull();
    const p = mapPoint({ id: "x", up: 30, rej: 30, min: 120, pUp: 20, pRej: 20, pMin: 60 })!;
    expect(p).toMatchObject({ dec: 60, x: 30, y: 50, px: 40, py: 50 });
    expect(mapPoint({ id: "x", up: 30, rej: 30, min: 120, pUp: 5, pRej: 5, pMin: 60 })!.px).toBeNull();
  });
  it("the team is everyone's decisions over everyone's hours", () => {
    expect(mapTeam([{ id: "a", up: 30, rej: 30, min: 60 }, { id: "b", up: 0, rej: 10, min: 60 }])).toEqual({ x: 35, y: 30 / 70 * 100, dec: 70, min: 120, u: 30 });
  });
});

describe("présence — the default day", () => {
  const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
  const seg = (m: number) => [{ b: 600, e: 600 + m, n: 2 }];
  it("is the latest day when at least half the regular agents did an hour", () => {
    const segs = {
      a: { "2026-09-01": seg(120), "2026-09-02": seg(120), "2026-09-03": seg(30) },
      b: { "2026-09-01": seg(120), "2026-09-02": seg(90), "2026-09-03": seg(5) },
      c: { "2026-09-01": seg(60), "2026-09-02": seg(10), "2026-09-03": seg(61) },
    };
    // 3 regular agents (3+ days) → 2 need an hour: 09-03 has one (c), 09-02 has two
    expect(defaultDay(days, segs)).toBe("2026-09-02");
  });
  it("falls back to the last day anyone worked, then the last day", () => {
    expect(defaultDay(days, { a: { "2026-09-01": seg(0) } })).toBe("2026-09-01");
    expect(defaultDay(days, {})).toBe("2026-09-03");
  });
});

describe("par produit", () => {
  const orders: OrderFact[] = [
    ...Array.from({ length: 30 }, (_, i) => fact({ a: "a1", p: "p1", st: i < 12 ? "delivered" : "rejected" })),
    ...Array.from({ length: 25 }, (_, i) => fact({ a: "a2", p: "p1", st: i < 3 ? "delivered" : "rejected" })),
    ...Array.from({ length: 5 }, () => fact({ a: "a2", p: "p2", st: "delivered" })),
    fact({ a: "a1", p: "p3", st: "delivered" }),
  ];
  it("rows by volume, cells per agent, the small products folded into « autres »", () => {
    const g = productGrid(orders, ["a1", "a2"], 10);
    expect(g.rows.map((r) => r.id)).toEqual(["p1"]);
    expect(g.rows[0].t).toEqual([55, 15]);
    expect(g.rows[0].ag).toEqual({ a1: [30, 12], a2: [25, 3] });
    expect(g.others).toEqual([2, 6]);
  });
});
