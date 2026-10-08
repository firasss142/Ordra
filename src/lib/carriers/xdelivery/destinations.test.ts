import { describe, it, expect } from "vitest";
import { XDELIVERY_DELEGATIONS } from "./catalogue";
import {
  XDELIVERY_DEPOT,
  DEFAULT_DELEGATION,
  toXDeliveryGovernorate,
  resolveXDeliveryDestination,
  normalizeTunisianPhone,
} from "./destinations";

describe("catalogue", () => {
  it("holds 24 governorates and 265 delegations", () => {
    expect(Object.keys(XDELIVERY_DELEGATIONS)).toHaveLength(24);
    expect(Object.values(XDELIVERY_DELEGATIONS).flat()).toHaveLength(265);
  });
});

describe("DEFAULT_DELEGATION (owner decision 1)", () => {
  it("names a real delegation of every governorate", () => {
    for (const [gov, dels] of Object.entries(XDELIVERY_DELEGATIONS)) {
      expect(dels, gov).toContain(DEFAULT_DELEGATION[gov]);
    }
  });
});

describe("toXDeliveryGovernorate", () => {
  it.each([
    ["Manouba", "Mannouba"],
    ["Béja", "Beja"],
    ["Le Kef", "Kef"],
    ["Gabès", "Gabes"],
    ["Médenine", "Medenine"],
    ["Kébili", "Kebili"],
    ["Tunis", "Tunis"],
    ["sidi bouzid", "Sidi Bouzid"],
    ["Hammamet", "Nabeul"], // a city Ordra already resolves to its governorate
  ])("%s → %s", (input, want) => {
    expect(toXDeliveryGovernorate(input)).toBe(want);
  });

  it("is null when nothing resolves", () => {
    expect(toXDeliveryGovernorate("Paris")).toBeNull();
    expect(toXDeliveryGovernorate(null)).toBeNull();
  });
});

describe("resolveXDeliveryDestination", () => {
  it("uses the agent's delegation when it belongs to the governorate", () => {
    expect(
      resolveXDeliveryDestination({ customerCity: "Ben Arous", delegation: "El Mourouj" }),
    ).toEqual({ ok: true, governorate: "Ben Arous", delegation: "El Mourouj", defaulted: false });
  });

  it("matches the agent's pick case- and accent-insensitively, sent in their spelling", () => {
    const r = resolveXDeliveryDestination({ customerCity: "Tunis", delegation: "la marsa" });
    expect(r).toEqual({ ok: true, governorate: "Tunis", delegation: "La Marsa", defaulted: false });
  });

  it("an explicit governorate pick wins over the order's city", () => {
    const r = resolveXDeliveryDestination({
      customerCity: "Tunis",
      governorate: "Sousse",
      delegation: "Sousse Ville",
    });
    expect(r).toMatchObject({ ok: true, governorate: "Sousse", delegation: "Sousse Ville" });
  });

  it("falls back to the governorate's main town when no delegation is picked", () => {
    expect(resolveXDeliveryDestination({ customerCity: "Sfax" })).toEqual({
      ok: true,
      governorate: "Sfax",
      delegation: "Sfax Ville",
      defaulted: true,
    });
    expect(resolveXDeliveryDestination({ customerCity: "Le Kef", delegation: "  " })).toMatchObject({
      delegation: "Le Kef Est",
      defaulted: true,
    });
  });

  it("refuses a delegation from another governorate rather than misrouting", () => {
    const r = resolveXDeliveryDestination({ customerCity: "Sfax", delegation: "La Marsa" });
    expect(r).toEqual({ ok: false, reason: "delegation_not_in_governorate" });
  });

  it("refuses an order whose governorate cannot be resolved", () => {
    expect(resolveXDeliveryDestination({ customerCity: "" })).toEqual({
      ok: false,
      reason: "unknown_governorate",
    });
  });
});

describe("normalizeTunisianPhone", () => {
  it.each([
    ["98 123 456", "98123456"],
    ["+216 98123456", "98123456"],
    ["0021698123456", "98123456"],
    ["216-98-123-456", "98123456"],
  ])("%s → %s", (raw, want) => {
    expect(normalizeTunisianPhone(raw)).toBe(want);
  });

  it("is null when it is not 8 digits", () => {
    expect(normalizeTunisianPhone("1234")).toBeNull();
    expect(normalizeTunisianPhone("")).toBeNull();
    expect(normalizeTunisianPhone(null)).toBeNull();
  });
});

describe("XDELIVERY_DEPOT — the big code on our label", () => {
  it("names a depot for each of their 24 governorates", () => {
    expect(Object.keys(XDELIVERY_DEPOT).sort()).toEqual(Object.keys(XDELIVERY_DELEGATIONS).sort());
  });

  it("follows their catalogue: 9 depots, the Sahel together, Grand Tunis together", () => {
    expect(new Set(Object.values(XDELIVERY_DEPOT)).size).toBe(9);
    expect([XDELIVERY_DEPOT.Sousse, XDELIVERY_DEPOT.Monastir, XDELIVERY_DEPOT.Mahdia]).toEqual(["SH", "SH", "SH"]);
    expect([XDELIVERY_DEPOT.Tunis, XDELIVERY_DEPOT.Ariana, XDELIVERY_DEPOT.Mannouba]).toEqual(["CE", "CE", "CE"]);
    expect(XDELIVERY_DEPOT.Sfax).toBe("SF");
    expect(XDELIVERY_DEPOT.Bizerte).toBe("BA");
  });
});
