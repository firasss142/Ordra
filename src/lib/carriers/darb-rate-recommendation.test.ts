import { describe, test, expect } from "vitest";
import {
  recommendCarrierByRate,
  isQuoteUsable,
  type CarrierRateCandidate,
} from "./darb-rate-recommendation";

const NOW = new Date("2026-08-08T12:00:00.000Z");
const FRESH = "2026-08-08T00:00:00.000Z";
const STALE = "2026-06-01T00:00:00.000Z";

function candidate(over: Partial<CarrierRateCandidate>): CarrierRateCandidate {
  return {
    carrierId: "c-tripoli",
    carrierName: "Darb Assabil - Tripoli",
    quotedFee: 15,
    quotedAt: FRESH,
    trueCostPerDelivered: 11.65,
    stickerDeliveryFee: 10,
    ...over,
  };
}

const TRIPOLI = candidate({});
const BENGHAZI = candidate({
  carrierId: "c-benghazi",
  carrierName: "Darb Assabil — Benghazi",
  quotedFee: 20,
  trueCostPerDelivered: 10.73,
});

describe("isQuoteUsable", () => {
  test("a fresh numeric quote is usable", () => {
    expect(isQuoteUsable(candidate({ quotedFee: 15, quotedAt: FRESH }), NOW, 14)).toBe(true);
  });

  test("a zero quote is usable — zero is a price", () => {
    expect(isQuoteUsable(candidate({ quotedFee: 0, quotedAt: FRESH }), NOW, 14)).toBe(true);
  });

  test("a null quote is not usable", () => {
    expect(isQuoteUsable(candidate({ quotedFee: null, quotedAt: null }), NOW, 14)).toBe(false);
  });

  test("a quote older than the max age is not usable", () => {
    expect(isQuoteUsable(candidate({ quotedAt: STALE }), NOW, 14)).toBe(false);
  });

  test("a quote with no timestamp is not usable", () => {
    expect(isQuoteUsable(candidate({ quotedFee: 15, quotedAt: null }), NOW, 14)).toBe(false);
  });
});

describe("recommendCarrierByRate", () => {
  const opts = { now: NOW };

  test("recommends the strictly cheaper quote", () => {
    // Real probed figures for طرابلس: Tripoli 15, Benghazi 20.
    const r = recommendCarrierByRate([TRIPOLI, BENGHAZI], opts);
    expect(r.recommendedCarrierId).toBe("c-tripoli");
    expect(r.reason).toBe("quote");
  });

  test("recommends Benghazi where Benghazi is cheaper", () => {
    // Real probed figures for بنغازي: Tripoli 30, Benghazi 10.
    const r = recommendCarrierByRate(
      [candidate({ quotedFee: 30 }), { ...BENGHAZI, quotedFee: 10 }],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.reason).toBe("quote");
  });

  test("ranks cheapest first and marks exactly one as cheapest", () => {
    const r = recommendCarrierByRate([BENGHAZI, TRIPOLI], opts);
    expect(r.ranked.map((c) => c.carrierId)).toEqual(["c-tripoli", "c-benghazi"]);
    expect(r.ranked.filter((c) => c.isCheapest)).toHaveLength(1);
    expect(r.ranked[0].isCheapest).toBe(true);
  });

  test("a fresh zero quote wins — zero is a price, not a gap", () => {
    const r = recommendCarrierByRate(
      [TRIPOLI, { ...BENGHAZI, quotedFee: 0 }],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.reason).toBe("quote");
  });

  // سبها quotes 35 from both accounts. The tie-break is the measured cost of a
  // successful delivery, which prices in each account's return rate.
  test("falls back to the cheaper historical true cost when quotes are equal", () => {
    const r = recommendCarrierByRate(
      [candidate({ quotedFee: 35 }), { ...BENGHAZI, quotedFee: 35 }],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.reason).toBe("quote_tie_true_cost");
  });

  test("treats quotes within epsilon as equal", () => {
    const r = recommendCarrierByRate(
      [candidate({ quotedFee: 35 }), { ...BENGHAZI, quotedFee: 35.0004 }],
      opts,
    );
    expect(r.reason).toBe("quote_tie_true_cost");
    expect(r.recommendedCarrierId).toBe("c-benghazi");
  });

  test("with equal quotes and equal true costs, falls back to the sticker fee", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: 35, trueCostPerDelivered: 11, stickerDeliveryFee: 12 }),
        { ...BENGHAZI, quotedFee: 35, trueCostPerDelivered: 11, stickerDeliveryFee: 9 },
      ],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.reason).toBe("quote_tie_sticker");
  });

  // THE RULE THAT IS EASY TO GET WRONG. Treating an unquoted carrier as
  // infinitely expensive would silently hard-route every order to whichever
  // account happened to get a fresher harvest. Missing data means "we cannot
  // compare on price", not "expensive".
  test("abandons the price comparison entirely when any candidate lacks a quote", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: 15, trueCostPerDelivered: 11.65 }),
        { ...BENGHAZI, quotedFee: null, quotedAt: null, trueCostPerDelivered: 10.73 },
      ],
      opts,
    );
    expect(r.reason).toBe("true_cost");
    expect(r.recommendedCarrierId).toBe("c-benghazi");
  });

  test("never recommends a carrier purely because the other one lacks a quote", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: 50, trueCostPerDelivered: 20 }),
        { ...BENGHAZI, quotedFee: null, quotedAt: null, trueCostPerDelivered: 10 },
      ],
      opts,
    );
    // The quoted one is more expensive on history; it must not win on the mere
    // fact that it has a number.
    expect(r.recommendedCarrierId).toBe("c-benghazi");
  });

  test("treats a stale quote as missing", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: 15, quotedAt: STALE, trueCostPerDelivered: 11.65 }),
        { ...BENGHAZI, quotedFee: 20, quotedAt: FRESH, trueCostPerDelivered: 10.73 },
      ],
      opts,
    );
    expect(r.reason).toBe("true_cost");
    expect(r.recommendedCarrierId).toBe("c-benghazi");
  });

  test("honours a custom maxQuoteAgeDays", () => {
    const r = recommendCarrierByRate([TRIPOLI, BENGHAZI], { now: NOW, maxQuoteAgeDays: 0 });
    expect(r.reason).toBe("true_cost");
  });

  test("falls back to the sticker fee when neither quotes nor history exist", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: null, quotedAt: null, trueCostPerDelivered: null, stickerDeliveryFee: 12 }),
        { ...BENGHAZI, quotedFee: null, quotedAt: null, trueCostPerDelivered: null, stickerDeliveryFee: 9 },
      ],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.reason).toBe("sticker");
  });

  test("a null true cost sorts after a numeric one", () => {
    const r = recommendCarrierByRate(
      [
        candidate({ quotedFee: null, quotedAt: null, trueCostPerDelivered: null }),
        { ...BENGHAZI, quotedFee: null, quotedAt: null, trueCostPerDelivered: 10.73 },
      ],
      opts,
    );
    expect(r.recommendedCarrierId).toBe("c-benghazi");
    expect(r.ranked[0].carrierId).toBe("c-benghazi");
  });

  // A badge that flickers between two identical options on every refetch is
  // worse than no badge. Callers pass carriers ordered by id.
  test("with everything equal, preserves input order", () => {
    const a = candidate({ carrierId: "c-a", quotedFee: 20, trueCostPerDelivered: 10, stickerDeliveryFee: 10 });
    const b = candidate({ carrierId: "c-b", quotedFee: 20, trueCostPerDelivered: 10, stickerDeliveryFee: 10 });
    expect(recommendCarrierByRate([a, b], opts).recommendedCarrierId).toBe("c-a");
    expect(recommendCarrierByRate([a, b], opts).ranked.map((c) => c.carrierId)).toEqual(["c-a", "c-b"]);
  });

  test("returns only_candidate for a single carrier", () => {
    const r = recommendCarrierByRate([TRIPOLI], opts);
    expect(r.recommendedCarrierId).toBe("c-tripoli");
    expect(r.reason).toBe("only_candidate");
  });

  test("returns none for an empty candidate list", () => {
    expect(recommendCarrierByRate([], opts)).toEqual({
      recommendedCarrierId: null,
      reason: "none",
      ranked: [],
    });
  });

  test("preserves every input candidate in ranked — no silent drops", () => {
    const third = candidate({ carrierId: "c-third", quotedFee: 40 });
    const r = recommendCarrierByRate([TRIPOLI, BENGHAZI, third], opts);
    expect(r.ranked).toHaveLength(3);
    expect(new Set(r.ranked.map((c) => c.carrierId))).toEqual(
      new Set(["c-tripoli", "c-benghazi", "c-third"]),
    );
  });

  test("reports which quotes were actually usable", () => {
    const r = recommendCarrierByRate(
      [TRIPOLI, { ...BENGHAZI, quotedAt: STALE }],
      opts,
    );
    expect(r.ranked.find((c) => c.carrierId === "c-tripoli")?.quoteUsable).toBe(true);
    expect(r.ranked.find((c) => c.carrierId === "c-benghazi")?.quoteUsable).toBe(false);
  });

  test("exposes the effective cost the ranking actually compared", () => {
    const r = recommendCarrierByRate([TRIPOLI, BENGHAZI], opts);
    expect(r.ranked.find((c) => c.carrierId === "c-tripoli")?.effectiveCost).toBe(15);
    expect(r.ranked.find((c) => c.carrierId === "c-benghazi")?.effectiveCost).toBe(20);
  });

  test("does not mutate the input array or its members", () => {
    const input = [TRIPOLI, BENGHAZI];
    const snapshot = JSON.parse(JSON.stringify(input));
    recommendCarrierByRate(input, opts);
    expect(input).toEqual(snapshot);
    expect(input[0].carrierId).toBe("c-tripoli");
  });

  test("never recommends a carrier absent from the candidates", () => {
    const r = recommendCarrierByRate([TRIPOLI, BENGHAZI], opts);
    expect(["c-tripoli", "c-benghazi"]).toContain(r.recommendedCarrierId);
  });

  test("is deterministic across repeated calls", () => {
    const a = recommendCarrierByRate([TRIPOLI, BENGHAZI], opts);
    const b = recommendCarrierByRate([TRIPOLI, BENGHAZI], opts);
    expect(a).toEqual(b);
  });
});
