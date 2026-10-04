import { describe, it, expect } from "vitest";
import { resolvePeriod, parsePeriodKind } from "@/lib/team/performance/period";
import { buildView } from "@/lib/team/performance/build";
import { normalizeFacts } from "@/lib/team/performance/facts";

describe("resolvePeriod", () => {
  const today = "2026-10-03";
  it("30 jours by default, against the 30 before; settled", () => {
    expect(resolvePeriod("30d", today)).toEqual({ kind: "30d", from: "2026-09-04", to: today, pfrom: "2026-08-05", pto: "2026-09-03", young: false, today });
  });
  it("7 jours is young (Darb has not settled)", () => {
    expect(resolvePeriod("7d", today)).toMatchObject({ from: "2026-09-27", pfrom: "2026-09-20", pto: "2026-09-26", young: true });
  });
  it("ce mois against the whole month before", () => {
    expect(resolvePeriod("month", today)).toMatchObject({ from: "2026-10-01", to: today, pfrom: "2026-09-01", pto: "2026-09-30", young: true });
    expect(resolvePeriod("month", "2026-10-20").young).toBe(false);
  });
  it("personnalisé: clamped to today and to 92 days, same length before", () => {
    expect(resolvePeriod("custom", today, "2026-09-01", "2026-09-10")).toMatchObject({ from: "2026-09-01", to: "2026-09-10", pfrom: "2026-08-22", pto: "2026-08-31", young: false });
    expect(resolvePeriod("custom", today, "2026-09-25", "2026-12-01")).toMatchObject({ from: "2026-09-25", to: today });
    expect(resolvePeriod("custom", today, "2026-01-01", "2026-09-30").from).toBe("2026-07-01");
    expect(resolvePeriod("custom", today, "nope", null).kind).toBe("30d");
  });
  it("parsePeriodKind", () => {
    expect(parsePeriodKind("7d")).toBe("7d");
    expect(parsePeriodKind("x")).toBe("30d");
  });
});

const ag = (id: string, name: string) => ({ id, name, color: null, avatar_url: null });
const ord = (a: string, st: string, extra: Record<string, unknown> = {}) => ({ a, cur: true, st, upl: st === "delivered", rsn: null, sub: null, p: "p1", no_try: null, late: false, ...extra });
const many = (n: number, f: () => object) => Array.from({ length: n }, f);

describe("buildView", () => {
  const w = resolvePeriod("30d", "2026-10-03");
  const facts = normalizeFacts({
    agents: [ag("u1", "salima"), ag("u2", "tasnim"), ag("u3", "riheb"), ag("u4", "ghost")],
    orders: [
      ...many(40, () => ord("u1", "delivered")),
      ...many(60, () => ord("u1", "rejected", { sub: "non_serieux", no_try: true })),
      ...many(50, () => ord("u2", "delivered")),
      ...many(50, () => ord("u2", "rejected", { sub: "prix_eleve", no_try: false })),
      ...many(30, () => ord("u2", "delivered", { cur: false })),
      ...many(5, () => ord("u3", "pending", { cur: false, p: "p2" })),
    ],
    decisions: [{ a: "u1", cur: true, up: 40, rej: 60 }, { a: "u2", cur: true, up: 50, rej: 50 }],
    actions: [
      { a: "u1", day: "2026-09-10", mins: [600, 650, 700] },
      { a: "u1", day: "2026-09-11", mins: [600, 900] },
      { a: "u2", day: "2026-09-10", mins: [840, 880] },
      { a: "u2", day: "2026-08-20", mins: [600, 660] },
    ],
    products: [{ id: "p1", name: "Livre", image_url: null }],
    reasons: [{ key: "non_serieux", group: "commande_invalide", fr: "Commande non sérieuse", ar: "طلب غير جدي" }],
  });
  const v = buildView(facts, w);

  it("keeps the agents who did something in either window", () => {
    expect(v.agents.map((a) => a.id)).toEqual(["u2", "u1", "u3"]);
  });
  it("team and previous team outcomes", () => {
    expect(v.team).toMatchObject({ a: 200, del: 90, rej: 110 });
    expect(v.teamPrev).toMatchObject({ a: 35, del: 30 });
  });
  it("ranks with leaks, and keeps the rest as chips", () => {
    expect(v.ranked.map((r) => [r.id, r.rank])).toEqual([["u2", 1], ["u1", 2]]);
    expect(v.ranked[0].prev).toBe(100);
    expect(v.ranked[1].leaks[0]).toMatchObject({ key: "non_serieux", her: 60 });
    expect(v.ranked[1].leaks.map((l) => l.key)).toContain("first");
    expect(v.hors).toEqual([{ id: "u3", n: 0 }]);
  });
  it("chains actions into shift segments, the window's days only", () => {
    expect(v.presence.segs.u1["2026-09-10"]).toEqual([{ b: 600, e: 700, n: 3 }]);
    expect(v.presence.segs.u1["2026-09-11"]).toEqual([{ b: 600, e: 600, n: 1 }, { b: 900, e: 900, n: 1 }]);
    expect(v.presence.segs.u2["2026-08-20"]).toBeUndefined();
    expect(v.presence.totals.u1).toEqual({ min: 100, days: 2 });
    expect(v.presence.days).toHaveLength(30);
    expect(v.presence.agents).toEqual(["u2", "u1"]);
    expect(v.presence.defaultDay).toBe("2026-09-10");
    expect(v.ranked.find((r) => r.id === "u1")!.days).toBe(2);
  });
  it("places on the map from 30 decisions and an hour on shift", () => {
    expect(v.map.points.map((p) => p.id)).toEqual(["u1"]);
    expect(v.map.team).toMatchObject({ dec: 200, min: 140 });
  });
  it("products × ranked agents, with the names", () => {
    expect(v.products.cols).toEqual(["u2", "u1"]);
    expect(v.products.rows[0]).toMatchObject({ id: "p1", name: "Livre", t: [200, 90] });
  });
  it("reasons by key", () => expect(v.reasons.non_serieux).toEqual({ group: "commande_invalide", fr: "Commande non sérieuse", ar: "طلب غير جدي" }));
});
