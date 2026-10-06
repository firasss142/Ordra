import { describe, expect, it } from "vitest";
import { canContinue, newDraft, presetRange, toConditions, type Draft } from "../wizard";
import { validateConditions } from "../../audience";

const NOW = Date.parse("2026-10-06T10:00:00Z");

describe("presetRange", () => {
  it("covers the last N days up to today", () => {
    expect(presetRange("30", NOW)).toEqual({ preset: "30", from: "2026-09-06", to: "2026-10-06" });
  });
  it("covers this calendar month and the previous one", () => {
    expect(presetRange("month", NOW)).toEqual({ preset: "month", from: "2026-10-01", to: "2026-10-06" });
    expect(presetRange("last", NOW)).toEqual({ preset: "last", from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("newDraft", () => {
  it("opens each starting point on sensible defaults", () => {
    expect(newDraft("old", NOW)).toMatchObject({ step: 1, start: "old", noReorder: true, range: { preset: "custom", from: "2026-04-09", to: "2026-09-06" } });
    expect(newDraft("rej", NOW)).toMatchObject({ subreasons: ["changement_avis", "prix_eleve", "pas_de_reponse"], range: { preset: "30" } });
    expect(newDraft("ret", NOW)).toMatchObject({ noReorder: true, range: { preset: "90" } });
    expect(newDraft("old", NOW)).toMatchObject({ offerProductIds: [], how: "call" });
  });
});

describe("toConditions", () => {
  it("past buyers: delivered, in the window, chosen products with their own dates, not reordered", () => {
    const d: Draft = { ...newDraft("old", NOW), products: [{ id: "p1", own: null }, { id: "p2", own: { preset: "custom", from: "2026-08-01", to: "2026-09-01" } }] };
    const cs = toConditions(d);
    expect(cs).toEqual([
      { kind: "outcome", statuses: ["delivered"] },
      { kind: "period", mode: "custom", days: 150, from: "2026-04-09", to: "2026-09-06" },
      { kind: "product", productIds: ["p1", "p2"], windows: [{ productId: "p2", from: "2026-08-01", to: "2026-09-01" }] },
      { kind: "noOrderAfterOutcome" },
    ]);
    expect(validateConditions(cs)).toEqual([]);
  });

  it("no products chosen means every product: no product condition at all", () => {
    expect(toConditions(newDraft("old", NOW)).some((c) => c.kind === "product")).toBe(false);
  });

  it("rejections carry their sub-reasons; returns use Libya's whole return path", () => {
    expect(toConditions(newDraft("rej", NOW))).toContainEqual({ kind: "subreason", subreasons: ["changement_avis", "prix_eleve", "pas_de_reponse"] });
    expect(toConditions(newDraft("ret", NOW))[0]).toEqual({ kind: "outcome", statuses: ["returning", "to_be_returned", "returned"] });
  });

  it("adds the refinements the manager opened", () => {
    const d: Draft = { ...newDraft("old", NOW), refine: { cities: ["طرابلس"], orderCountMin: 2, basketMin: 200 } };
    const cs = toConditions(d);
    expect(cs).toContainEqual({ kind: "city", cities: ["طرابلس"] });
    expect(cs).toContainEqual({ kind: "orderCount", op: "gte", n: 2 });
    expect(cs).toContainEqual({ kind: "basket", min: 200 });
  });

  it("a CSV list has no audience conditions", () => {
    expect(toConditions(newDraft("csv", NOW))).toEqual([]);
  });
});

describe("canContinue", () => {
  it("step 1 needs a reason for rejections, a file for CSV, and an ordered range", () => {
    expect(canContinue({ ...newDraft("rej", NOW), subreasons: [] })).toBe(false);
    expect(canContinue(newDraft("rej", NOW))).toBe(true);
    expect(canContinue(newDraft("csv", NOW))).toBe(false);
    expect(canContinue({ ...newDraft("csv", NOW), csv: { fileName: "a.csv", rows: [{ name: "x", phone: "0912345678", city: null }] } })).toBe(true);
    expect(canContinue({ ...newDraft("old", NOW), range: { preset: "custom", from: "2026-09-10", to: "2026-09-01" } })).toBe(false);
  });

  it("step 3 with WhatsApp needs a message", () => {
    const d = { ...newDraft("old", NOW), step: 3 as const, how: "wa" as const };
    expect(canContinue({ ...d, wa: { ...d.wa, message: "  " } })).toBe(false);
    expect(canContinue({ ...d, wa: { ...d.wa, message: "Bonjour {prénom}" } })).toBe(true);
  });
});
