import { describe, expect, test } from "vitest";
import { computeOverview, COURIER_AGENT, type CubeRow } from "../overview";
import type { Family } from "../product-family";

const BAG: Family = { id: "bm", label: "دميه ملاكمه", imageUrl: null, productIds: ["bm", "bs"] };
const QURAN: Family = { id: "q", label: "القرآن تدبر وعمل", imageUrl: null, productIds: ["q"] };
const AGENTS = [
  { id: "tasnim", name: "tasnim" },
  { id: "hend", name: "hend" },
  { id: "salima", name: "salima" },
];

const r = (day: string, category: CubeRow["category"], topic_id: string | null, product_id: string | null, created_by: string | null, n = 1, source = "agent"): CubeRow =>
  ({ day, category, topic_id, product_id, created_by, source, n });

// Current range 09-21 → 09-30 (10 days), previous 09-11 → 09-20.
const CUBE: CubeRow[] = [
  r("2026-09-21", "objection", "nocash", "q", "tasnim", 3),
  r("2026-09-25", "objection", "nocash", "bm", "tasnim", 2),
  r("2026-09-26", "objection", "card", "bs", "hend", 1),
  r("2026-09-30", "reclamation", "nonconform", "bm", null, 2, "courier"),
  r("2026-09-29", "suggestion", "version", "q", "admin-user", 1),
  r("2026-09-28", "objection", null, "q", "tasnim", 1),
  // previous period
  r("2026-09-12", "objection", "nocash", "q", "tasnim", 1),
  r("2026-09-15", "reclamation", "nonconform", "bm", null, 1, "courier"),
];

const base = {
  cube: CUBE,
  from: "2026-09-21",
  to: "2026-09-30",
  hasPrev: true,
  families: [BAG, QURAN],
  agents: AGENTS,
  familyId: null as string | null,
  agentId: null as string | null,
  category: null as CubeRow["category"] | null,
};

describe("computeOverview", () => {
  test("category cards: count, previous count, daily series", () => {
    const o = computeOverview(base);
    const obj = o.kpis.find((k) => k.category === "objection")!;
    expect(obj.count).toBe(7);
    expect(obj.prev).toBe(1);
    expect(obj.series).toHaveLength(10);
    expect(obj.series[0]).toBe(3);
    expect(obj.series[4]).toBe(2);
    expect(o.kpis.find((k) => k.category === "reclamation")).toMatchObject({ count: 2, prev: 1 });
    expect(o.kpis.find((k) => k.category === "suggestion")).toMatchObject({ count: 1, prev: 0 });
    expect(o.total).toBe(10);
  });

  test("no previous period → prev is null (the page hides the deltas)", () => {
    const o = computeOverview({ ...base, hasPrev: false });
    expect(o.kpis.every((k) => k.prev === null)).toBe(true);
    expect(o.topics.every((t) => t.prev === null)).toBe(true);
  });

  test("product tabs count the current range under the agent filter, not the product filter", () => {
    const o = computeOverview({ ...base, familyId: "q" });
    expect(o.tabs.all).toBe(10);
    // Busiest first; a tie keeps the catalogue order.
    expect(o.tabs.byFamily).toEqual([
      { id: "bm", count: 5 },
      { id: "q", count: 5 },
    ]);
    const tilted = computeOverview({ ...base, cube: [...CUBE, r("2026-09-22", "objection", "nocash", "q", "hend")] });
    expect(tilted.tabs.byFamily[0]).toEqual({ id: "q", count: 6 });
    const withAgent = computeOverview({ ...base, agentId: "tasnim" });
    expect(withAgent.tabs.all).toBe(6);
  });

  test("the product filter folds every size into its family", () => {
    const o = computeOverview({ ...base, familyId: "bm" });
    expect(o.total).toBe(5);
    expect(o.kpis.find((k) => k.category === "objection")!.count).toBe(3);
  });

  test("top topics: ranked, with share, previous count and the category filter", () => {
    const o = computeOverview(base);
    expect(o.topics[0]).toEqual({ category: "objection", topicId: "nocash", count: 5, prev: 1, share: 50 });
    expect(o.topics.map((t) => t.topicId)).toEqual(["nocash", "nonconform", "card", "version", null]);
    const onlyObj = computeOverview({ ...base, category: "objection" });
    expect(onlyObj.topics.map((t) => t.topicId)).toEqual(["nocash", "card", null]);
    // 5 of the 7 objections
    expect(onlyObj.topics[0].share).toBe(71);
  });

  test("the category mix follows the product and agent filters, never the category filter", () => {
    const o = computeOverview({ ...base, category: "objection" });
    expect(o.mix).toEqual([
      { category: "reclamation", count: 2 },
      { category: "objection", count: 7 },
      { category: "suggestion", count: 1 },
    ]);
  });

  test("agents: every agent listed, courier and non-agents left out, stacked by category", () => {
    const o = computeOverview(base);
    expect(o.agents).toEqual([
      { id: "tasnim", name: "tasnim", count: 6, byCategory: { reclamation: 0, objection: 6, suggestion: 0 } },
      { id: "hend", name: "hend", count: 1, byCategory: { reclamation: 0, objection: 1, suggestion: 0 } },
      { id: "salima", name: "salima", count: 0, byCategory: { reclamation: 0, objection: 0, suggestion: 0 } },
    ]);
    expect(o.agentsTotal).toBe(7);
  });

  test("agents follow the product filter but not the agent filter", () => {
    const o = computeOverview({ ...base, familyId: "bm", agentId: "hend" });
    expect(o.agents.find((a) => a.id === "tasnim")!.count).toBe(2);
    expect(o.agents.find((a) => a.id === "hend")!.count).toBe(1);
  });

  test("« livreur Darb » as the agent filter keeps the courier's entries", () => {
    const o = computeOverview({ ...base, agentId: COURIER_AGENT });
    expect(o.total).toBe(2);
    expect(o.kpis.find((k) => k.category === "reclamation")!.count).toBe(2);
  });
});
