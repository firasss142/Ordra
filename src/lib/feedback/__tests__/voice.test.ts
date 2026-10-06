import { describe, expect, test } from "vitest";
import { computeVoice, pickQuotes, COURIER_AGENT, type CubeRow, type QuoteRow } from "../voice";
import type { Family } from "../product-family";
import type { FeedbackTopic } from "@/types/feedback";

const BAG: Family = { id: "bm", label: "دمية الملاكمة", imageUrl: null, productIds: ["bm", "bs"] };
const QURAN: Family = { id: "q", label: "القرآن تدبر وعمل", imageUrl: "/q.png", productIds: ["q"] };
const BOOK: Family = { id: "h", label: "كتاب الحفظ الميسر", imageUrl: null, productIds: ["h"] };

const topic = (id: string, category: FeedbackTopic["category"], sort_order: number, response: string | null = null): FeedbackTopic =>
  ({ id, category, key: id, label_fr: id.toUpperCase(), label_ar: `ar-${id}`, sort_order, response });

const TOPICS: FeedbackTopic[] = [
  topic("nocash", "objection", 1, "Rappeler le 1er du mois."),
  topic("card", "objection", 2),
  topic("delivery", "objection", 5),
  topic("expensive", "objection", 0),
  topic("version", "suggestion", 0),
  topic("again", "suggestion", 3),
  topic("nonconform", "reclamation", 0),
];

const r = (day: string, category: CubeRow["category"], topic_id: string | null, product_id: string | null, created_by: string | null, n = 1, source = "agent"): CubeRow =>
  ({ day, category, topic_id, product_id, created_by, source, n });

// Current range 09-21 → 09-30 (10 days), previous 09-11 → 09-20.
const CUBE: CubeRow[] = [
  r("2026-09-21", "objection", "nocash", "q", "rania", 3),
  r("2026-09-25", "objection", "nocash", "bm", "rania", 2),
  r("2026-09-26", "objection", "nocash", "h", "hiba", 1),
  r("2026-09-26", "objection", "card", "bs", "hiba", 1),
  r("2026-09-27", "objection", "card", "bm", null, 1, "courier"),
  r("2026-09-30", "reclamation", "nonconform", "bm", null, 2, "courier"),
  r("2026-09-29", "suggestion", "version", "q", "rania", 2),
  r("2026-09-28", "objection", null, "q", "rania", 1),
  r("2026-09-28", "suggestion", null, null, "hiba", 1),
  // previous period
  r("2026-09-12", "objection", "nocash", "q", "rania", 1),
  r("2026-09-13", "objection", "delivery", "q", "rania", 2),
  r("2026-09-14", "objection", "card", "q", "hiba", 3),
  r("2026-09-15", "reclamation", "nonconform", "bm", null, 1, "courier"),
];

const base = {
  cube: CUBE,
  topics: TOPICS,
  from: "2026-09-21",
  to: "2026-09-30",
  hasPrev: true,
  families: [BAG, QURAN, BOOK],
  familyId: null as string | null,
  agentId: null as string | null,
};

describe("computeVoice", () => {
  test("totals and the three categories, with the previous period", () => {
    const v = computeVoice(base);
    expect(v.total).toBe(14);
    expect(v.kpis).toEqual([
      { category: "objection", count: 9, prev: 6 },
      { category: "suggestion", count: 3, prev: 0 },
      { category: "reclamation", count: 2, prev: 1 },
    ]);
  });

  test("« à vérifier » = no reason, outside complaints", () => {
    expect(computeVoice(base).toCheck).toBe(2);
  });

  test("objection reasons ranked by count, with trend, response and top products", () => {
    const v = computeVoice(base);
    expect(v.reasons.map((x) => [x.topicId, x.count, x.prev])).toEqual([
      ["nocash", 6, 1],
      ["card", 2, 3],
    ]);
    expect(v.reasons[0].response).toBe("Rappeler le 1er du mois.");
    // Products fold into families: bm + bs are one bag.
    expect(v.reasons[1].products).toEqual([{ id: "bm", label: "دمية الملاكمة", imageUrl: null, count: 2 }]);
    expect(v.reasons[0].products.map((p) => [p.id, p.count])).toEqual([["q", 3], ["bm", 2], ["h", 1]]);
  });

  test("a reason nobody gave this period but did before is « plus mentionné »", () => {
    const v = computeVoice(base);
    expect(v.gone.map((x) => x.topicId)).toEqual(["delivery"]);
    // Never mentioned at all: not listed anywhere.
    expect(v.reasons.concat(v.gone).some((x) => x.topicId === "expensive")).toBe(false);
  });

  test("suggestion reasons are the « ce qu'ils aimeraient trouver » list", () => {
    const v = computeVoice(base);
    expect(v.wants.map((x) => [x.topicId, x.count, x.prev])).toEqual([["version", 2, 0]]);
    expect(v.wantsGone).toEqual([]);
  });

  test("ties break on the topic's sort order", () => {
    const cube = [r("2026-09-22", "objection", "card", "q", "x"), r("2026-09-22", "objection", "nocash", "q", "x")];
    expect(computeVoice({ ...base, cube }).reasons.map((x) => x.topicId)).toEqual(["nocash", "card"]);
  });

  test("no previous period → prev is null everywhere, nothing is « plus mentionné »", () => {
    const v = computeVoice({ ...base, hasPrev: false });
    expect(v.kpis[0].prev).toBeNull();
    expect(v.reasons[0].prev).toBeNull();
    expect(v.gone).toEqual([]);
  });

  test("the product filter narrows everything to the family", () => {
    const v = computeVoice({ ...base, familyId: "bm" });
    expect(v.total).toBe(6);
    expect(v.reasons.map((x) => [x.topicId, x.count])).toEqual([["nocash", 2], ["card", 2]]);
    expect(v.toCheck).toBe(0);
  });

  test("the agent filter: one agent, or the Darb courier", () => {
    expect(computeVoice({ ...base, agentId: "hiba" }).total).toBe(3);
    const darb = computeVoice({ ...base, agentId: COURIER_AGENT });
    expect(darb.total).toBe(3);
    expect(darb.kpis.find((k) => k.category === "reclamation")).toEqual({ category: "reclamation", count: 2, prev: 1 });
  });
});

describe("pickQuotes", () => {
  const q = (id: string, topic_id: string | null, created_at: string): QuoteRow =>
    ({ id, topic_id, created_at, body: `body ${id}`, moment: "call", source: "agent", author: "Rania" });

  test("the newest three per topic", () => {
    const rows = [
      q("a", "nocash", "2026-09-21T10:00:00Z"),
      q("b", "nocash", "2026-09-24T10:00:00Z"),
      q("c", "card", "2026-09-22T10:00:00Z"),
      q("d", "nocash", "2026-09-23T10:00:00Z"),
      q("e", "nocash", "2026-09-29T10:00:00Z"),
      q("f", null, "2026-09-29T10:00:00Z"),
    ];
    const by = pickQuotes(rows, 3);
    expect(by.get("nocash")!.map((x) => x.id)).toEqual(["e", "b", "d"]);
    expect(by.get("card")!.map((x) => x.id)).toEqual(["c"]);
    expect(by.has("")).toBe(false);
  });
});
