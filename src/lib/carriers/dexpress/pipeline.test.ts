import { describe, test, expect } from "vitest";
import { buildTimeline, HAPPY_PATH, colorForSlug, SLUG_COLOR } from "./pipeline";

describe("buildTimeline — happy path", () => {
  test("BEING_PREPARED: first node current, rest future", () => {
    const nodes = buildTimeline("BEING_PREPARED");
    expect(nodes).toHaveLength(5);
    expect(nodes[0]).toEqual({
      slug: "BEING_PREPARED",
      state: "current",
      branch: false,
    });
    expect(nodes.slice(1).every((n) => n.state === "future")).toBe(true);
    expect(nodes.every((n) => n.branch === false)).toBe(true);
  });

  test("IN_COMPANY: 1 past, 1 current, 3 future", () => {
    const nodes = buildTimeline("IN_COMPANY");
    expect(nodes.map((n) => n.state)).toEqual([
      "past",
      "current",
      "future",
      "future",
      "future",
    ]);
  });

  test("OUT_FOR_DELIVERY: 3 past, 1 current, 1 future", () => {
    const nodes = buildTimeline("OUT_FOR_DELIVERY");
    expect(nodes.map((n) => n.state)).toEqual([
      "past",
      "past",
      "past",
      "current",
      "future",
    ]);
  });

  test("DELIVERED: all past except the last which is current", () => {
    const nodes = buildTimeline("DELIVERED");
    expect(nodes.map((n) => n.state)).toEqual([
      "past",
      "past",
      "past",
      "past",
      "current",
    ]);
  });

  test("happy-path nodes always render in HAPPY_PATH order regardless of input", () => {
    for (const slug of HAPPY_PATH) {
      const nodes = buildTimeline(slug);
      expect(nodes.map((n) => n.slug)).toEqual(HAPPY_PATH);
    }
  });
});

describe("buildTimeline — sub-state collapsing", () => {
  test("EN_ROUTE_TO_BRANCHES renders as IN_COMPANY current", () => {
    const nodes = buildTimeline("EN_ROUTE_TO_BRANCHES");
    expect(nodes.map((n) => n.slug)).toEqual(HAPPY_PATH);
    const current = nodes.find((n) => n.state === "current");
    expect(current?.slug).toBe("IN_COMPANY");
  });

  test("WILL_BE_SENT_TO_BRANCHES collapses to IN_COMPANY", () => {
    const nodes = buildTimeline("WILL_BE_SENT_TO_BRANCHES");
    const current = nodes.find((n) => n.state === "current");
    expect(current?.slug).toBe("IN_COMPANY");
  });

  test("ARRIVED_AT_BRANCHES collapses to IN_COMPANY", () => {
    const nodes = buildTimeline("ARRIVED_AT_BRANCHES");
    expect(nodes.find((n) => n.state === "current")?.slug).toBe("IN_COMPANY");
  });

  test("AWAITING_COURIER_SETTLEMENT collapses to SENT_TO_COURIER", () => {
    const nodes = buildTimeline("AWAITING_COURIER_SETTLEMENT");
    expect(nodes.find((n) => n.state === "current")?.slug).toBe(
      "SENT_TO_COURIER",
    );
  });
});

describe("buildTimeline — off-path / branching", () => {
  test("RETURNED_AT_COMPANY: 4 happy-path past + branch node current", () => {
    const nodes = buildTimeline("RETURNED_AT_COMPANY");
    expect(nodes).toHaveLength(5);
    expect(nodes.slice(0, 4).every((n) => n.state === "past" && !n.branch)).toBe(
      true,
    );
    expect(nodes[4]).toEqual({
      slug: "RETURNED_AT_COMPANY",
      state: "current",
      branch: true,
    });
  });

  test("RECEIPT_REFUSED: 4 past + branch current, no DELIVERED node", () => {
    const nodes = buildTimeline("RECEIPT_REFUSED");
    expect(nodes).toHaveLength(5);
    expect(nodes[4].slug).toBe("RECEIPT_REFUSED");
    expect(nodes[4].branch).toBe(true);
    expect(nodes.map((n) => n.slug)).not.toContain("DELIVERED");
  });

  test("DELIVERY_POSTPONED: same shape as RECEIPT_REFUSED", () => {
    const nodes = buildTimeline("DELIVERY_POSTPONED");
    expect(nodes).toHaveLength(5);
    expect(nodes[4]).toEqual({
      slug: "DELIVERY_POSTPONED",
      state: "current",
      branch: true,
    });
  });

  test("AT_CUSTOMER: no happy-path past, just a single branch node", () => {
    const nodes = buildTimeline("AT_CUSTOMER");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      slug: "AT_CUSTOMER",
      state: "current",
      branch: true,
    });
  });

  test("RETURNING_VIA_COURIER: 4 past + branch", () => {
    const nodes = buildTimeline("RETURNING_VIA_COURIER");
    expect(nodes[nodes.length - 1].slug).toBe("RETURNING_VIA_COURIER");
    expect(nodes[nodes.length - 1].branch).toBe(true);
  });
});

describe("buildTimeline — unknown/null", () => {
  test("null currentSlug returns empty timeline", () => {
    expect(buildTimeline(null)).toEqual([]);
  });
});

describe("colorForSlug / SLUG_COLOR — per-status story color", () => {
  test("BEING_PREPARED is indigo and unique to itself", () => {
    expect(colorForSlug("BEING_PREPARED")).toBe("#4F46E5");
  });

  test("IN_COMPANY + its branch sub-states all share teal", () => {
    const teal = "#0D9488";
    expect(colorForSlug("IN_COMPANY")).toBe(teal);
    expect(colorForSlug("WILL_BE_SENT_TO_BRANCHES")).toBe(teal);
    expect(colorForSlug("EN_ROUTE_TO_BRANCHES")).toBe(teal);
    expect(colorForSlug("ARRIVED_AT_BRANCHES")).toBe(teal);
  });

  test("SENT_TO_COURIER + AWAITING_COURIER_SETTLEMENT share cyan", () => {
    const cyan = "#0891B2";
    expect(colorForSlug("SENT_TO_COURIER")).toBe(cyan);
    expect(colorForSlug("AWAITING_COURIER_SETTLEMENT")).toBe(cyan);
  });

  test("OUT_FOR_DELIVERY is purple — its own unique color", () => {
    expect(colorForSlug("OUT_FOR_DELIVERY")).toBe("#7C3AED");
  });

  test("DELIVERED is green — its own unique terminal color", () => {
    expect(colorForSlug("DELIVERED")).toBe("#008060");
  });

  test("AT_CUSTOMER / PARTIALLY_DELIVERED / REPLACED share amber", () => {
    const amber = "#B98900";
    expect(colorForSlug("AT_CUSTOMER")).toBe(amber);
    expect(colorForSlug("PARTIALLY_DELIVERED")).toBe(amber);
    expect(colorForSlug("REPLACED")).toBe(amber);
  });

  test("DELIVERY_POSTPONED + POSTPONED_WITH_COURIER share orange", () => {
    const orange = "#EA580C";
    expect(colorForSlug("DELIVERY_POSTPONED")).toBe(orange);
    expect(colorForSlug("POSTPONED_WITH_COURIER")).toBe(orange);
  });

  test("RECEIPT_REFUSED is its own red", () => {
    expect(colorForSlug("RECEIPT_REFUSED")).toBe("#D72C0D");
  });

  test("RETURNING family shares rose", () => {
    const rose = "#E11D48";
    expect(colorForSlug("RETURNING_VIA_COURIER")).toBe(rose);
    expect(colorForSlug("RETURNING_AT_BRANCHES")).toBe(rose);
    expect(colorForSlug("RETURNING_TO_COMPANY")).toBe(rose);
  });

  test("RETURNED_AT_COMPANY is dark red, distinct from RETURNING family", () => {
    expect(colorForSlug("RETURNED_AT_COMPANY")).toBe("#9F1239");
    expect(colorForSlug("RETURNED_AT_COMPANY")).not.toBe(
      colorForSlug("RETURNING_VIA_COURIER"),
    );
  });

  test("SLUG_COLOR has an entry for every taxonomy slug", () => {
    // Smoke test: every key in SLUG_COLOR resolves to a non-empty hex.
    for (const [slug, hex] of Object.entries(SLUG_COLOR)) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(slug).toBeTruthy();
    }
  });
});
