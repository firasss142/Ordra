import { describe, test, expect } from "vitest";
import { formatDeltaParts, toMetric, type DeltaLabels } from "../confidence";

const labels: DeltaLabels = {
  vsPrevious: "vs 15 juin — 14 juil.",
  basedOn: (n) => `sur ${n} commandes`,
  tooFew: (n) => `${n} commandes — trop peu pour comparer`,
  noBaseline: "pas d'historique",
};

describe("formatDeltaParts", () => {
  test("names the baseline in the caption and puts the movement in the pill", () => {
    const parts = formatDeltaParts(toMetric(52, 38), labels);
    expect(parts.badge).toBe("↗ +36.8%");
    expect(parts.note).toBe("vs 15 juin — 14 juil.");
    expect(parts.tone).toBe("positive");
  });

  test("a fall is negative and points down", () => {
    const parts = formatDeltaParts(toMetric(18, 31), labels);
    expect(parts.badge).toBe("↘ −41.9%");
    expect(parts.tone).toBe("negative");
  });

  // The honesty rule, made structural: below n=10 the caller is handed no pill
  // at all, so it cannot colour a comparison the data does not support.
  test("withholds the pill entirely when the sample is too thin", () => {
    const parts = formatDeltaParts(toMetric(6, 40), labels);
    expect(parts.badge).toBeNull();
    expect(parts.note).toBe("6 commandes — trop peu pour comparer");
    expect(parts.tone).toBe("neutral");
  });

  test("withholds the pill when there is no baseline to divide by", () => {
    const parts = formatDeltaParts(toMetric(52, 0), labels);
    expect(parts.badge).toBeNull();
    expect(parts.note).toBe("pas d'historique");
  });

  // n between 10 and 30: the comparison is shown, but the caption states the
  // denominator instead of the baseline so the reader can discount it.
  test("swaps the baseline caption for the sample size on low confidence", () => {
    const parts = formatDeltaParts(toMetric(18, 12), labels);
    expect(parts.badge).toBe("↗ +50.0%");
    expect(parts.note).toBe("sur 18 commandes");
    expect(parts.isCaveat).toBe(true);
  });

  // Rejections falling is good news. The arrow reports direction of movement;
  // only the tone is allowed to know whether that movement is welcome.
  test("invert flips the tone but never the arrow", () => {
    const parts = formatDeltaParts(toMetric(40, 60), labels, { invert: true });
    expect(parts.badge).toBe("↘ −33.3%");
    expect(parts.tone).toBe("positive");
  });

  test("rate metrics move in percentage points, not percent", () => {
    const parts = formatDeltaParts(toMetric(80, 78, 200), labels, { pp: true });
    expect(parts.badge).toBe("↗ +2.0 pp");
  });

  test("a flat metric gets a neutral pill with no arrow", () => {
    const parts = formatDeltaParts(toMetric(40, 40), labels);
    expect(parts.badge).toBe("0.0%");
    expect(parts.tone).toBe("neutral");
  });
});
