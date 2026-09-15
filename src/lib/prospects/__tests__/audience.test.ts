import { describe, expect, test } from "vitest";
import {
  CONDITION_KINDS,
  TEMPLATES,
  conditionsOf,
  defaultCondition,
  periodDays,
  toFilterJson,
  fromFilterJson,
  validateConditions,
  type Condition,
} from "../audience";

/**
 * The campaign audience. Every condition here has to survive the round trip to
 * `prospect_campaigns.filter_json` and back, because the same JSON is read by
 * the preview and by the RPC that creates the leads — if they disagreed, the
 * manager would be shown a number that never happens.
 */

const NOW = Date.parse("2026-09-15T10:00:00Z");

const find = <K extends Condition["kind"]>(cs: Condition[], kind: K) =>
  cs.find((c) => c.kind === kind) as Extract<Condition, { kind: K }> | undefined;

describe("the templates are starting points a manager can recognise", () => {
  test("every template names conditions that exist", () => {
    for (const key of Object.keys(TEMPLATES)) {
      for (const c of conditionsOf(key as keyof typeof TEMPLATES, NOW)) {
        expect(CONDITION_KINDS).toContain(c.kind);
      }
    }
  });

  test("every template carries the outcome and period it is built on", () => {
    // Both are fixed conditions in the composer: an audience with no outcome
    // and no window is every customer who ever ordered.
    for (const key of Object.keys(TEMPLATES)) {
      const cs = conditionsOf(key as keyof typeof TEMPLATES, NOW);
      expect(find(cs, "outcome")).toBeDefined();
      expect(find(cs, "period")).toBeDefined();
    }
  });

  test("rebuy looks for delivered customers in a recency window", () => {
    const cs = conditionsOf("rebuy", NOW);
    expect(find(cs, "outcome")?.statuses).toEqual(["delivered"]);
    expect(find(cs, "recency")).toMatchObject({ from: 60, to: 120 });
  });

  test("winback looks for returns, and for why they came back", () => {
    const cs = conditionsOf("winback", NOW);
    expect(find(cs, "outcome")?.statuses).toEqual(["returned"]);
    expect(find(cs, "reason")?.reasons.length).toBeGreaterThan(0);
  });

  test("vip asks for repeat customers with a real basket", () => {
    const cs = conditionsOf("vip", NOW);
    expect(find(cs, "orderCount")).toMatchObject({ op: "gte", n: 3 });
    expect(find(cs, "basket")?.min).toBeGreaterThan(0);
  });
});

describe("the period is the window the audience is drawn from", () => {
  test("a preset is a number of days back from now", () => {
    const c = defaultCondition("period", NOW) as Extract<Condition, { kind: "period" }>;
    expect(periodDays(c)).toBe(c.days);
  });

  test("custom dates are measured between the two dates, not from a preset", () => {
    const c: Condition = {
      kind: "period",
      mode: "custom",
      days: 90,
      from: "2026-01-01",
      to: "2026-03-02",
    };
    // 1 Jan to 2 Mar 2026 is 60 days.
    expect(periodDays(c)).toBe(60);
  });

  test("a custom range that is inverted or empty still counts as a day", () => {
    // Never zero: the count query divides by nothing and the UI would show
    // an audience drawn from a window that does not exist.
    const c: Condition = {
      kind: "period",
      mode: "custom",
      days: 90,
      from: "2026-03-02",
      to: "2026-01-01",
    };
    expect(periodDays(c)).toBeGreaterThanOrEqual(1);
  });
});

describe("filter_json is the contract between the preview and the RPC", () => {
  test("a full condition set survives the round trip unchanged", () => {
    const cs = conditionsOf("vip", NOW);
    expect(fromFilterJson(toFilterJson(cs))).toEqual(cs);
  });

  test("every template survives the round trip", () => {
    for (const key of Object.keys(TEMPLATES)) {
      const cs = conditionsOf(key as keyof typeof TEMPLATES, NOW);
      expect(fromFilterJson(toFilterJson(cs))).toEqual(cs);
    }
  });

  test("the five keys the old RPC already reads keep their names", () => {
    // 20260615000001 reads order_statuses, date_from, date_to, product_id and
    // city. Renaming them would strand every campaign already in the table.
    const cs: Condition[] = [
      { kind: "outcome", statuses: ["delivered"] },
      { kind: "period", mode: "custom", days: 90, from: "2026-06-01", to: "2026-09-01" },
      { kind: "product", productIds: ["p-1"] },
      { kind: "city", cities: ["Tripoli"] },
    ];
    const json = toFilterJson(cs);
    expect(json.order_statuses).toEqual(["delivered"]);
    expect(json.date_from).toBe("2026-06-01");
    expect(json.date_to).toBe("2026-09-01");
    expect(json.product_id).toBe("p-1");
    expect(json.city).toBe("Tripoli");
  });

  test("a campaign saved before the composer existed still reads back", () => {
    // 1 982 production leads belong to campaigns whose filter_json has only
    // the five original keys.
    const cs = fromFilterJson({
      order_statuses: ["delivered"],
      date_from: "2026-01-01",
      date_to: "2026-06-30",
      product_id: "p-9",
      city: "Benghazi",
    });
    expect(find(cs, "outcome")?.statuses).toEqual(["delivered"]);
    expect(find(cs, "product")?.productIds).toEqual(["p-9"]);
    expect(find(cs, "city")?.cities).toEqual(["Benghazi"]);
  });

  test("an empty filter reads back as an audience with an outcome and a window", () => {
    const cs = fromFilterJson({});
    expect(find(cs, "outcome")).toBeDefined();
    expect(find(cs, "period")).toBeDefined();
  });

  test("the guards are carried, not assumed by the reader", () => {
    // Whether a campaign skips customers with an open prospect is a decision
    // the manager made; it must be stored, not re-derived from a default.
    const cs: Condition[] = [
      { kind: "outcome", statuses: ["delivered"] },
      { kind: "period", mode: "preset", days: 90, from: "2026-06-17", to: "2026-09-15" },
      { kind: "notOrderedSince", days: 30 },
      { kind: "notInCampaign", days: 60 },
      { kind: "notLostNotInterested" },
    ];
    const json = toFilterJson(cs);
    expect(json.guards).toMatchObject({
      not_ordered_days: 30,
      not_in_campaign_days: 60,
      not_lost_not_interested: true,
    });
    expect(fromFilterJson(json)).toEqual(cs);
  });

  test("a cap on the audience size survives with its sort", () => {
    const cs: Condition[] = [
      { kind: "outcome", statuses: ["delivered"] },
      { kind: "period", mode: "preset", days: 90, from: "2026-06-17", to: "2026-09-15" },
      { kind: "limit", sort: "basket", n: 300 },
    ];
    expect(fromFilterJson(toFilterJson(cs))).toEqual(cs);
  });
});

describe("what the composer refuses to send", () => {
  const base: Condition[] = [
    { kind: "outcome", statuses: ["delivered"] },
    { kind: "period", mode: "preset", days: 90, from: "2026-06-17", to: "2026-09-15" },
  ];

  test("a sound audience has nothing to report", () => {
    expect(validateConditions(base)).toEqual([]);
  });

  test("an outcome with nothing ticked is refused", () => {
    // It would silently mean "every order in any state".
    const errors = validateConditions([{ kind: "outcome", statuses: [] }, base[1]]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "outcome" }));
  });

  test("a recency window wider than the period is refused", () => {
    // Asking for customers who last ordered 200 days ago inside a 90-day
    // window returns nobody, and the manager cannot see why.
    const errors = validateConditions([
      ...base,
      { kind: "recency", from: 150, to: 200 },
    ]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "recency" }));
  });

  test("a recency window that runs backwards is refused", () => {
    const errors = validateConditions([...base, { kind: "recency", from: 90, to: 30 }]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "recency" }));
  });

  test("a loss-reason condition without a losing outcome is refused", () => {
    // Delivered orders have no rejection reason; the condition would quietly
    // empty the audience.
    const errors = validateConditions([...base, { kind: "reason", reasons: ["refus_client"] }]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "reason" }));
  });

  test("the same loss-reason condition is fine once rejected is included", () => {
    const errors = validateConditions([
      { kind: "outcome", statuses: ["rejected"] },
      base[1],
      { kind: "reason", reasons: ["refus_client"] },
    ]);
    expect(errors).toEqual([]);
  });

  test("a product condition with nothing ticked is refused", () => {
    const errors = validateConditions([...base, { kind: "product", productIds: [] }]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "product" }));
  });

  test("the same condition twice is refused", () => {
    // Two recency windows cannot both hold; one would silently win.
    const errors = validateConditions([
      ...base,
      { kind: "recency", from: 30, to: 60 },
      { kind: "recency", from: 60, to: 90 },
    ]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "recency" }));
  });

  test("a negative or zero limit is refused", () => {
    const errors = validateConditions([...base, { kind: "limit", sort: "oldest", n: 0 }]);
    expect(errors).toContainEqual(expect.objectContaining({ kind: "limit" }));
  });
});
