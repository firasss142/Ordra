import { describe, it, expect } from "vitest";
import {
  computeSignals,
  MIN_SAMPLE,
  MIN_REJECTIONS_FOR_REASON,
  type SignalCounts,
} from "@/lib/products/signals";

function counts(overrides: Partial<SignalCounts> = {}): SignalCounts {
  return {
    rejected: 25,
    confirmed: 80,
    delivered: 80,
    returned: 20,
    top_rejection_reason: "prix",
    ...overrides,
  };
}

describe("computeSignals — confirmation rate", () => {
  it("computes confirmed / (confirmed + rejected)", () => {
    const s = computeSignals(counts({ confirmed: 80, rejected: 20 }));
    expect(s.confirmation?.percent).toBe(80);
    expect(s.confirmation?.sample).toBe(100);
  });

  it("rounds to a whole percent", () => {
    // 80 / 105 = 76.19%
    const s = computeSignals(counts({ confirmed: 80, rejected: 25 }));
    expect(s.confirmation?.percent).toBe(76);
  });

  it("is success at or above 70", () => {
    expect(computeSignals(counts({ confirmed: 70, rejected: 30 })).confirmation?.tone).toBe(
      "success",
    );
  });

  it("is warning just below 70", () => {
    expect(computeSignals(counts({ confirmed: 69, rejected: 31 })).confirmation?.tone).toBe(
      "warning",
    );
  });

  it("is warning at 50", () => {
    expect(computeSignals(counts({ confirmed: 50, rejected: 50 })).confirmation?.tone).toBe(
      "warning",
    );
  });

  it("is critical just below 50", () => {
    expect(computeSignals(counts({ confirmed: 49, rejected: 51 })).confirmation?.tone).toBe(
      "critical",
    );
  });

  it("colours the tone by what is displayed, not the raw rate", () => {
    // 699/1000 = 69.9% → displays 70, so it must not read as a warning.
    const s = computeSignals(counts({ confirmed: 699, rejected: 301 }));
    expect(s.confirmation?.percent).toBe(70);
    expect(s.confirmation?.tone).toBe("success");
  });
});

describe("computeSignals — return rate", () => {
  it("computes returned / (delivered + returned)", () => {
    const s = computeSignals(counts({ delivered: 80, returned: 20 }));
    expect(s.returns?.percent).toBe(20);
    expect(s.returns?.sample).toBe(100);
  });

  it("is success at or below 10", () => {
    expect(computeSignals(counts({ delivered: 90, returned: 10 })).returns?.tone).toBe("success");
  });

  it("is warning just above 10", () => {
    expect(computeSignals(counts({ delivered: 89, returned: 11 })).returns?.tone).toBe("warning");
  });

  it("is warning at 20", () => {
    expect(computeSignals(counts({ delivered: 80, returned: 20 })).returns?.tone).toBe("warning");
  });

  it("is critical above 20", () => {
    expect(computeSignals(counts({ delivered: 79, returned: 21 })).returns?.tone).toBe("critical");
  });

  it("reads Biovera's real numbers as critical", () => {
    // Live data: 1 634 delivered, 423 returned → 20.6%
    const s = computeSignals(counts({ delivered: 1634, returned: 423 }));
    expect(s.returns?.percent).toBe(21);
    expect(s.returns?.tone).toBe("critical");
  });
});

describe("computeSignals — suppression", () => {
  it("suppresses a rate below the minimum sample", () => {
    const s = computeSignals(counts({ confirmed: 3, rejected: 0, delivered: 3, returned: 0 }));
    expect(s.confirmation).toBeNull();
    expect(s.returns).toBeNull();
  });

  it("shows a rate exactly at the minimum sample", () => {
    const s = computeSignals(
      counts({ confirmed: MIN_SAMPLE, rejected: 0, delivered: MIN_SAMPLE, returned: 0 }),
    );
    expect(s.confirmation).not.toBeNull();
    expect(s.returns).not.toBeNull();
  });

  it("suppresses each rate independently", () => {
    // Plenty of confirmation history, almost nothing delivered yet.
    const s = computeSignals(counts({ confirmed: 90, rejected: 10, delivered: 2, returned: 1 }));
    expect(s.confirmation).not.toBeNull();
    expect(s.returns).toBeNull();
  });

  it("survives a product with no orders at all", () => {
    const s = computeSignals({
      rejected: 0,
      confirmed: 0,
      delivered: 0,
      returned: 0,
      top_rejection_reason: null,
    });
    expect(s.confirmation).toBeNull();
    expect(s.returns).toBeNull();
    expect(s.topRejectionReason).toBeNull();
    expect(s.hasAny).toBe(false);
  });

  it("never produces NaN or Infinity", () => {
    const s = computeSignals({
      rejected: 0,
      confirmed: 0,
      delivered: 0,
      returned: 0,
      top_rejection_reason: null,
    });
    expect(Number.isFinite(s.totalOutcomes)).toBe(true);
  });
});

describe("computeSignals — top rejection reason", () => {
  it("is shown once there are enough rejections to mean something", () => {
    const s = computeSignals(counts({ rejected: MIN_REJECTIONS_FOR_REASON }));
    expect(s.topRejectionReason).toBe("prix");
  });

  it("is suppressed below that, so one rejection is not read as a pattern", () => {
    const s = computeSignals(counts({ rejected: MIN_REJECTIONS_FOR_REASON - 1 }));
    expect(s.topRejectionReason).toBeNull();
  });

  it("is null when the database returned none", () => {
    expect(computeSignals(counts({ top_rejection_reason: null })).topRejectionReason).toBeNull();
  });
});

describe("computeSignals — block visibility", () => {
  it("reports hasAny when at least one signal survived", () => {
    expect(computeSignals(counts()).hasAny).toBe(true);
  });

  it("reports hasAny=false when everything was suppressed", () => {
    const s = computeSignals(counts({ rejected: 1, confirmed: 1, delivered: 1, returned: 0 }));
    expect(s.hasAny).toBe(false);
  });

  it("exposes the total outcome count for the sample line", () => {
    const s = computeSignals(counts({ confirmed: 80, rejected: 25 }));
    expect(s.totalOutcomes).toBe(105);
  });
});
