import { describe, it, expect } from "vitest";
import {
  normaliseInsightsRow,
  extractLeadCount,
  convertToMarketCurrency,
  type MetaInsightsRow,
} from "../insights";

/**
 * A complete row exactly as the Graph API serialises it: every metric is a
 * string, including the campaign id. The fixtures below deliberately keep the
 * quotes — the whole point of this module is that nothing downstream ever sees
 * one of these strings unparsed.
 */
function row(overrides: Partial<MetaInsightsRow> = {}): MetaInsightsRow {
  return {
    campaign_id: "23859123456789012",
    campaign_name: "TN — Black Hair Oil — Prospecting",
    spend: "128.50",
    impressions: "45231",
    reach: "31004",
    clicks: "1187",
    ctr: "2.6242",
    cpc: "0.10826",
    cpm: "2.8410",
    frequency: "1.459",
    account_currency: "USD",
    date_start: "2026-08-01",
    date_stop: "2026-08-01",
    ...overrides,
  };
}

describe("normaliseInsightsRow — every metric leaves as a real number", () => {
  it("parses each numeric string into a number, never leaving a string behind", () => {
    const n = normaliseInsightsRow(row());

    // typeof is the assertion that matters: a surviving string would
    // concatenate under + in realized-metrics.ts rather than add.
    expect(typeof n.spendOriginal).toBe("number");
    expect(typeof n.impressions).toBe("number");
    expect(typeof n.clicks).toBe("number");
    expect(typeof n.reach).toBe("number");
    expect(typeof n.ctr).toBe("number");

    expect(n.spendOriginal).toBe(128.5);
    expect(n.impressions).toBe(45231);
    expect(n.reach).toBe(31004);
    expect(n.clicks).toBe(1187);
    expect(n.ctr).toBeCloseTo(2.6242, 6);
    expect(n.cpc).toBeCloseTo(0.10826, 6);
    expect(n.cpm).toBeCloseTo(2.841, 6);
    expect(n.frequency).toBeCloseTo(1.459, 6);
  });

  it("adds rather than concatenates two normalised spends", () => {
    const a = normaliseInsightsRow(row({ spend: "12" }));
    const b = normaliseInsightsRow(row({ spend: "34" }));
    expect(a.spendOriginal + b.spendOriginal).toBe(46);
  });

  it("integer-parses counters, discarding any fractional part Meta sends", () => {
    const n = normaliseInsightsRow(
      row({ impressions: "45231.0", clicks: "1187.9", reach: "31004.4" }),
    );
    expect(n.impressions).toBe(45231);
    expect(n.clicks).toBe(1187);
    expect(n.reach).toBe(31004);
  });

  it("keeps campaign_id an exact string — 17-digit ids exceed MAX_SAFE_INTEGER", () => {
    // Both are real-length Meta ids past 2^53. The first happens to be exactly
    // representable as a double; the second is not, and numeric parsing would
    // silently hand back the first one instead — a different campaign.
    const exactlyRepresentable = "23859123456789012";
    const corruptedByNumber = "23859123456789013";

    expect(normaliseInsightsRow(row({ campaign_id: exactlyRepresentable })).externalCampaignId)
      .toBe(exactlyRepresentable);
    expect(normaliseInsightsRow(row({ campaign_id: corruptedByNumber })).externalCampaignId)
      .toBe(corruptedByNumber);
    expect(typeof normaliseInsightsRow(row()).externalCampaignId).toBe("string");

    // The failure this guards against, made explicit.
    expect(String(Number(corruptedByNumber))).toBe(exactlyRepresentable);
  });

  it("carries campaign name, currency and the row's own date", () => {
    const n = normaliseInsightsRow(row());
    expect(n.campaignName).toBe("TN — Black Hair Oil — Prospecting");
    expect(n.currency).toBe("USD");
    expect(n.date).toBe("2026-08-01");
  });
});

describe("normaliseInsightsRow — absent fields become null, never 0 or NaN", () => {
  it("returns null for every optional metric Meta omitted", () => {
    const sparse: MetaInsightsRow = {
      campaign_id: "23859123456789012",
      campaign_name: "Zero-delivery campaign",
      spend: "0",
      account_currency: "TND",
      date_start: "2026-08-02",
      date_stop: "2026-08-02",
    };
    const n = normaliseInsightsRow(sparse);

    for (const value of [
      n.impressions,
      n.reach,
      n.clicks,
      n.ctr,
      n.cpc,
      n.cpm,
      n.frequency,
      n.platformResults,
    ]) {
      expect(value).toBeNull();
    }
  });

  it("returns null rather than NaN for empty or unparseable strings", () => {
    const n = normaliseInsightsRow(row({ clicks: "", cpc: "  ", ctr: "n/a" }));
    expect(n.clicks).toBeNull();
    expect(n.cpc).toBeNull();
    expect(n.ctr).toBeNull();
    expect(Number.isNaN(n.clicks as unknown as number)).toBe(false);
  });
});

describe("extractLeadCount — one source, never the sum of two", () => {
  const pixel = { action_type: "offsite_conversion.fb_pixel_lead", value: "42" };
  const onsite = { action_type: "onsite_conversion.lead_grouped", value: "17" };
  const noise = { action_type: "landing_page_view", value: "900" };

  it("reads the pixel lead action and parses its string value", () => {
    expect(extractLeadCount([noise, pixel])).toBe(42);
  });

  it("reads the on-Meta lead form action when it is the only lead action", () => {
    expect(extractLeadCount([noise, onsite])).toBe(17);
  });

  it("never sums the two lead actions when both are present", () => {
    const both = extractLeadCount([pixel, onsite, noise]);
    expect(both).not.toBe(59);
    expect([42, 17]).toContain(both);
  });

  it("defaults to the pixel action when both are present and no hint is given", () => {
    expect(extractLeadCount([onsite, pixel])).toBe(42);
  });

  it("honours an explicit onsite hint over the pixel action", () => {
    expect(extractLeadCount([pixel, onsite], "onsite")).toBe(17);
  });

  it("falls back to the other source when the hinted one is absent", () => {
    expect(extractLeadCount([pixel], "onsite")).toBe(42);
    expect(extractLeadCount([onsite], "pixel")).toBe(17);
  });

  it("returns null when no lead action is present at all", () => {
    expect(extractLeadCount([noise])).toBeNull();
    expect(extractLeadCount([])).toBeNull();
    expect(extractLeadCount(undefined)).toBeNull();
  });

  it("feeds platformResults on the normalised row", () => {
    const n = normaliseInsightsRow(row({ actions: [noise, pixel] }));
    expect(n.platformResults).toBe(42);
  });
});

describe("convertToMarketCurrency — dinars at 3dp, exact", () => {
  it("converts 100 USD at 4.85 to exactly 485", () => {
    expect(convertToMarketCurrency(100, 4.85)).toBe(485);
  });

  it("rounds to the millime, never below it", () => {
    // 10.001 dinars ×1.5 is 15.0015 — half-up at 3dp is 15.002.
    expect(convertToMarketCurrency(10.001, 1.5)).toBe(15.002);
    expect(convertToMarketCurrency(12.345, 3)).toBe(37.035);
  });

  it("produces no floating-point residue", () => {
    const converted = convertToMarketCurrency(0.1 + 0.2, 1);
    expect(converted).toBe(0.3);
  });

  it("leaves an amount untouched at a rate of 1", () => {
    expect(convertToMarketCurrency(128.5, 1)).toBe(128.5);
  });
});
