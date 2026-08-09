import { describe, test, expect } from "vitest";
import { pickRateForOrder, type DarbRateRow } from "./darb-rate-lookup";

function row(over: Partial<DarbRateRow>): DarbRateRow {
  return {
    carrier_id: "c-tripoli",
    city: "طرابلس",
    area: "الرياضية",
    shipping_amount: 15,
    currency: "lyd",
    last_success_at: "2026-08-08T00:00:00.000Z",
    ...over,
  };
}

describe("pickRateForOrder", () => {
  test("returns the exact (city, area) row", () => {
    const rows = [
      row({ area: "الرياضية", shipping_amount: 15 }),
      row({ area: "زناتة", shipping_amount: 20 }),
    ];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: "الرياضية" })?.shipping_amount).toBe(15);
  });

  test("scopes to the carrier's own rows when several accounts are present", () => {
    const rows = [
      row({ carrier_id: "c-tripoli", shipping_amount: 15 }),
      row({ carrier_id: "c-benghazi", shipping_amount: 20 }),
    ];
    const picked = pickRateForOrder(rows, { city: "طرابلس", area: "الرياضية" }, "c-benghazi");
    expect(picked?.shipping_amount).toBe(20);
  });

  // Missing is not zero — the caller must be able to tell "no price" from "free".
  test("returns null when no row matches the destination", () => {
    expect(pickRateForOrder([row({})], { city: "بنغازي", area: "قمينس" })).toBeNull();
  });

  test("returns null for an unpriced row rather than treating it as free", () => {
    const rows = [row({ shipping_amount: null, last_success_at: null })];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: "الرياضية" })).toBeNull();
  });

  test("keeps a genuine zero price — Benghazi really does quote 0 into بنغازي", () => {
    const rows = [row({ city: "بنغازي", area: "بنغازي", shipping_amount: 0 })];
    expect(pickRateForOrder(rows, { city: "بنغازي", area: "بنغازي" })?.shipping_amount).toBe(0);
  });

  // At intake, a multi-area city (طرابلس has 92 areas) often has no area picked
  // yet — the agent chooses it in the dispatch modal. Quote conservatively, and
  // identically for both accounts so the comparison stays fair.
  test("takes the most expensive area of the city when no area is decided", () => {
    const rows = [
      row({ area: "الرياضية", shipping_amount: 15 }),
      row({ area: "زناتة", shipping_amount: 22 }),
      row({ area: "تاجوراء", shipping_amount: 18 }),
    ];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: null })?.shipping_amount).toBe(22);
  });

  test("ignores unpriced areas when taking the city maximum", () => {
    const rows = [
      row({ area: "الرياضية", shipping_amount: 15 }),
      row({ area: "زناتة", shipping_amount: null, last_success_at: null }),
    ];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: null })?.shipping_amount).toBe(15);
  });

  test("returns null for an undecided area when the city has no priced rows", () => {
    const rows = [row({ shipping_amount: null, last_success_at: null })];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: null })).toBeNull();
  });

  test("never leaks a different city's rate into the city maximum", () => {
    const rows = [
      row({ city: "طرابلس", area: "الرياضية", shipping_amount: 15 }),
      row({ city: "الكفرة", area: "الكفرة", shipping_amount: 50 }),
    ];
    expect(pickRateForOrder(rows, { city: "طرابلس", area: null })?.shipping_amount).toBe(15);
  });

  test("falls back to the city maximum when the exact area has no row", () => {
    const rows = [
      row({ area: "الرياضية", shipping_amount: 15 }),
      row({ area: "زناتة", shipping_amount: 22 }),
    ];
    // "عين زارة" is a real طرابلس area that simply has not been harvested yet.
    expect(pickRateForOrder(rows, { city: "طرابلس", area: "عين زارة" })?.shipping_amount).toBe(22);
  });

  test("handles an empty row set", () => {
    expect(pickRateForOrder([], { city: "طرابلس", area: "الرياضية" })).toBeNull();
  });

  test("does not mutate the input", () => {
    const rows = [row({ area: "الرياضية" }), row({ area: "زناتة", shipping_amount: 22 })];
    const snapshot = JSON.parse(JSON.stringify(rows));
    pickRateForOrder(rows, { city: "طرابلس", area: null });
    expect(rows).toEqual(snapshot);
  });
});
