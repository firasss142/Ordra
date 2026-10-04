import { describe, it, expect } from "vitest";
import {
  buildDayLoop,
  buildDecisions,
  buildTeam,
  sumSiteCounts,
  type DayCounts,
} from "../day-loop";

/**
 * « Aujourd'hui » — les quatre métiers d'une journée d'entrepôt.
 *
 * Sortir, Rentrer, Recevoir, Compter : chaque ligne est la seule porte vers son
 * travail et porte UN chiffre, la taille de ce travail. L'ancien « Aujourd'hui »
 * (supprimé le 2026-09-08) répétait les chiffres des autres écrans et ses
 * actions n'étaient pas cliquables ; celui-ci ne dit que ce qui attend.
 */

const EMPTY: DayCounts = {
  toPrepare: 0,
  oldestHours: 0,
  setAside: 0,
  returnsAtCarrier: 0,
  returnsOnTheWay: 0,
  receptionsOpen: 0,
  receptionsLate: 0,
  products: 0,
  neverCounted: 0,
};

describe("buildDayLoop", () => {
  it("lists the four jobs in the physical order of a day", () => {
    const loop = buildDayLoop({ counts: EMPTY, scannedToday: 0, goal: null });
    expect(loop.jobs.map((j) => j.key)).toEqual(["out", "returns", "receive", "count"]);
  });

  it("gives each job the size of its backlog, and nothing else", () => {
    const loop = buildDayLoop({
      counts: { ...EMPTY, toPrepare: 31, returnsAtCarrier: 2, receptionsOpen: 1, products: 7, neverCounted: 7 },
      scannedToday: 14,
      goal: null,
    });
    expect(Object.fromEntries(loop.jobs.map((j) => [j.key, j.count]))).toEqual({
      out: 31,
      returns: 2,
      receive: 1,
      count: 7,
    });
  });

  it("marks a job with nothing waiting as idle, not as zero work to do", () => {
    const loop = buildDayLoop({ counts: { ...EMPTY, products: 7 }, scannedToday: 0, goal: null });
    expect(loop.jobs.find((j) => j.key === "receive")?.state).toBe("idle");
    expect(loop.jobs.find((j) => j.key === "count")?.state).toBe("idle");
  });

  it("says a count that has NEVER happened apart from one that is merely due", () => {
    // 0 stock_count rows in prod on 2026-10-02: every stock figure is the
    // register alone. That is a different fact from "two products are due".
    const never = buildDayLoop({ counts: { ...EMPTY, products: 7, neverCounted: 7 }, scannedToday: 0, goal: null });
    expect(never.jobs.find((j) => j.key === "count")?.state).toBe("never");

    const some = buildDayLoop({ counts: { ...EMPTY, products: 7, neverCounted: 2 }, scannedToday: 0, goal: null });
    expect(some.jobs.find((j) => j.key === "count")?.state).toBe("work");
  });

  it("measures the day against the market goal when one is set", () => {
    const loop = buildDayLoop({ counts: { ...EMPTY, toPrepare: 31 }, scannedToday: 14, goal: 45 });
    expect(loop.progress).toEqual({ done: 14, target: 45, pct: 31, hasGoal: true });
  });

  it("falls back to scanned / (scanned + waiting) when no goal is set — never an invented 40", () => {
    const loop = buildDayLoop({ counts: { ...EMPTY, toPrepare: 6 }, scannedToday: 14, goal: null });
    expect(loop.progress).toEqual({ done: 14, target: 20, pct: 70, hasGoal: false });
  });

  it("does not divide by zero on a quiet day", () => {
    const loop = buildDayLoop({ counts: EMPTY, scannedToday: 0, goal: null });
    expect(loop.progress.pct).toBe(0);
  });

  it("caps the bar at 100 when the team beats the goal", () => {
    const loop = buildDayLoop({ counts: EMPTY, scannedToday: 60, goal: 45 });
    expect(loop.progress.pct).toBe(100);
  });
});

describe("sumSiteCounts", () => {
  const market = { products: 7, neverCounted: 7 };

  it("adds counts across buildings and keeps the OLDEST parcel, not the sum of ages", () => {
    const total = sumSiteCounts(
      [
        { ...EMPTY, toPrepare: 16, oldestHours: 26, setAside: 351 },
        { ...EMPTY, toPrepare: 31, oldestHours: 70, setAside: 42 },
      ],
      market,
    );
    expect(total.toPrepare).toBe(47);
    expect(total.oldestHours).toBe(70);
    expect(total.setAside).toBe(393);
  });

  it("takes the catalogue figures from the market, never from a sum of buildings", () => {
    // Products belong to the market. Summing two buildings would say 14 products,
    // and "never counted" 7 + 3 = 10 of 7. A product is uncounted for the market
    // only when no building counted it, which only the caller can know.
    const total = sumSiteCounts(
      [
        { ...EMPTY, products: 7, neverCounted: 7 },
        { ...EMPTY, products: 7, neverCounted: 3 },
      ],
      { products: 7, neverCounted: 3 },
    );
    expect(total.products).toBe(7);
    expect(total.neverCounted).toBe(3);
  });
});

describe("buildDecisions", () => {
  it("returns nothing on a day with nothing to decide", () => {
    expect(buildDecisions(EMPTY)).toEqual([]);
  });

  it("names each open decision with its size and where it is acted on", () => {
    const decisions = buildDecisions({
      ...EMPTY,
      setAside: 351,
      returnsAtCarrier: 2,
      receptionsLate: 1,
      neverCounted: 7,
      products: 7,
    });
    expect(decisions.map((d) => [d.key, d.count, d.target])).toEqual([
      ["setAside", 351, "out"],
      ["returns", 2, "returns"],
      ["receptionsLate", 1, "receptions"],
      ["neverCounted", 7, "count"],
    ]);
  });

  it("marks parcels set aside as critical — they are still `uploaded` in every other figure", () => {
    const [first] = buildDecisions({ ...EMPTY, setAside: 3 });
    expect(first.severity).toBe("critical");
  });

  /*
   * UN GROUPE OUVERT N'EST PAS UNE ALERTE. Le bureau solde une fois la semaine :
   * crier dès le premier carton transformerait le fonctionnement normal en
   * reproche quotidien. Seul un groupe ouvert DEPUIS LA VEILLE mérite un mot —
   * la marchandise est vendable et sa marge reste inconnue.
   */
  it("ne signale pas un groupe ouvert du jour", () => {
    expect(buildDecisions({ ...EMPTY, receptionsOpen: 1 })).toEqual([]);
  });

  it("signale un groupe ouvert depuis la veille", () => {
    const decisions = buildDecisions({ ...EMPTY, receptionsOpen: 2, receptionsLate: 1 });
    expect(decisions.map((d) => d.key)).toEqual(["receptionsLate"]);
  });
});

describe("buildTeam", () => {
  const agents = [
    { id: "a", name: "adel", warehouseId: "B" },
    { id: "t", name: "tarek", warehouseId: "T" },
  ];

  it("lists every warehouse agent, including one who has not scanned today", () => {
    const team = buildTeam(agents, [{ actorId: "a", scanned: 14, lastScanAt: "2026-10-02T10:41:00Z" }]);
    expect(team).toEqual([
      { id: "a", name: "adel", warehouseId: "B", scannedToday: 14, lastScanAt: "2026-10-02T10:41:00Z" },
      { id: "t", name: "tarek", warehouseId: "T", scannedToday: 0, lastScanAt: null },
    ]);
  });

  it("puts the busiest first, so a silent building sinks to the end where it is noticed", () => {
    const team = buildTeam(
      [{ id: "t", name: "tarek", warehouseId: "T" }, { id: "a", name: "adel", warehouseId: "B" }],
      [{ actorId: "a", scanned: 3, lastScanAt: null }],
    );
    expect(team.map((r) => r.id)).toEqual(["a", "t"]);
  });

  it("keeps a manager who scanned out of the agents' list", () => {
    const team = buildTeam(agents, [{ actorId: "m", scanned: 1, lastScanAt: null }]);
    expect(team.map((r) => r.id)).toEqual(["a", "t"]);
  });
});
