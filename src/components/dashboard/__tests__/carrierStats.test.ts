import { describe, test, expect } from "vitest";
import {
  carrierInitials,
  carrierTint,
  carrierTotals,
  rankCarriers,
  rateTone,
} from "../charts/carrierStats";
import type { CarrierStat } from "@/lib/dashboard/health";

function carrier(over: Partial<CarrierStat> & { carrier_id: string }): CarrierStat {
  const delivered = over.delivered ?? 0;
  const returned = over.returned ?? 0;
  const resolved = delivered + returned;
  return {
    name: "Transporteur",
    delivered,
    returned,
    deliveryRate: resolved > 0 ? (delivered / resolved) * 100 : 0,
    avgTransitDays: null,
    realCostPerDelivered: null,
    returnSpend: 0,
    inFlight: 0,
    stuck: 0,
    hasResolved: resolved > 0,
    ...over,
  };
}

describe("carrierTotals", () => {
  test("sums only resolved outcomes into the headline rate", () => {
    const totals = carrierTotals([
      carrier({ carrier_id: "a", delivered: 221, returned: 64, returnSpend: 320 }),
      carrier({ carrier_id: "b", delivered: 133, returned: 30, returnSpend: 150 }),
    ]);
    expect(totals.delivered).toBe(354);
    expect(totals.returned).toBe(94);
    expect(totals.resolved).toBe(448);
    expect(totals.returnSpend).toBe(470);
    expect(totals.overallRate).toBeCloseTo(79.0, 1);
  });

  // A carrier on the list purely because it is holding parcels contributes to
  // the live column, not to a delivery rate.
  test("a live-only carrier does not move the rate", () => {
    const totals = carrierTotals([
      carrier({ carrier_id: "a", delivered: 90, returned: 10 }),
      carrier({ carrier_id: "b", inFlight: 40, hasResolved: false }),
    ]);
    expect(totals.overallRate).toBe(90);
  });

  test("no resolved outcome yields an empty ring rather than a 0%", () => {
    expect(carrierTotals([carrier({ carrier_id: "a", inFlight: 5 })]).overallRate).toBeNull();
  });
});

describe("rankCarriers", () => {
  test("crowns the higher rate and reports the gap in whole points", () => {
    const tripoli = carrier({ carrier_id: "a", delivered: 221, returned: 64 });
    const benghazi = carrier({ carrier_id: "b", delivered: 133, returned: 30 });
    // 221/285 = 77.5% against 133/163 = 81.6%.
    const { leader, gapPts, canRank } = rankCarriers([tripoli, benghazi]);
    expect(leader?.carrier_id).toBe("b");
    expect(gapPts).toBe(4);
    expect(canRank).toBe(true);
  });

  // Otherwise a carrier that delivered its only two parcels "wins" at 100%.
  test("excludes carriers below the confidence floor from the ranking", () => {
    const lucky = carrier({ carrier_id: "lucky", delivered: 2, returned: 0 });
    const real = carrier({ carrier_id: "real", delivered: 80, returned: 20 });
    const { leader } = rankCarriers([lucky, real]);
    expect(leader?.carrier_id).toBe("real");
  });

  // One carrier is not a comparison, so no badge and no gap sentence.
  test("a single qualifying carrier cannot be ranked", () => {
    const { canRank, gapPts } = rankCarriers([carrier({ carrier_id: "a", delivered: 80, returned: 20 })]);
    expect(canRank).toBe(false);
    expect(gapPts).toBe(0);
  });
});

describe("rateTone", () => {
  test("colours by what the rate means, not by where it ranks", () => {
    expect(rateTone(60)).toBe("text-oms-age-late");
    // The case the two-donut predecessor got wrong: one parcel in four coming
    // back rendered as a success because it happened to be the better of two.
    expect(rateTone(75.2)).toBe("text-oms-ink-1");
    expect(rateTone(87.3)).toBe("text-oms-ok");
  });
});

describe("carrierInitials", () => {
  // Libya runs two Darb Assabil accounts; the shared first word cannot be the
  // only source of the monogram or the twins collide.
  test("reaches the distinguishing word rather than the shared one", () => {
    expect(carrierInitials("Dar Assadli – Tripoli")).toBe("DT");
    expect(carrierInitials("Dar Assadli – Benghazi")).toBe("DB");
  });

  test("takes two letters from a single-word name", () => {
    expect(carrierInitials("Aramex")).toBe("AR");
  });

  test("never turns punctuation into an initial", () => {
    expect(carrierInitials("Dar / Assadli")).toBe("DA");
  });

  test("survives a name with no letters at all", () => {
    expect(carrierInitials("—")).toBe("?");
  });
});

describe("carrierTint", () => {
  test("is stable for a given carrier across calls", () => {
    expect(carrierTint("carrier-1")).toBe(carrierTint("carrier-1"));
  });

  test("separates the two Darb Assabil accounts", () => {
    expect(carrierTint("darb-tripoli")).not.toBe(carrierTint("darb-benghazi"));
  });
});
