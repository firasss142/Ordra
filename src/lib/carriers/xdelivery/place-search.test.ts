import { describe, it, expect } from "vitest";
import { searchXDeliveryPlaces, xdeliveryGovernorates } from "./place-search";
import { XDELIVERY_LOCALITIES } from "./localities";

/**
 * The upload sheet's delegation search (prototypes/xdelivery-v1.html, screen 3).
 *
 * The governorate is what must be right; the delegation is optional and its default is
 * the governorate's main town (owner decision 1). The search reaches localities too,
 * because a customer says « Sahloul », not « Sousse Jaouhara ».
 */
describe("xdeliveryGovernorates", () => {
  it("lists their 24 governorates, in their spelling, sorted", () => {
    const all = xdeliveryGovernorates();
    expect(all).toHaveLength(24);
    expect(all).toContain("Mannouba");
    expect(all).toContain("Kef");
    expect([...all].sort((a, b) => a.localeCompare(b, "fr"))).toEqual(all);
  });
});

describe("searchXDeliveryPlaces", () => {
  it("with no query: every delegation, the default first and flagged", () => {
    const out = searchXDeliveryPlaces({ governorate: "Sousse", query: "" });
    expect(out[0]).toMatchObject({ delegation: "Sousse Ville", locality: null, isDefault: true });
    expect(out.filter((o) => o.isDefault)).toHaveLength(1);
    expect(out.map((o) => o.delegation)).toContain("Akouda");
    expect(out).toHaveLength(14);
  });

  it("an unknown governorate gives nothing rather than another one's list", () => {
    expect(searchXDeliveryPlaces({ governorate: "Tripoli", query: "" })).toEqual([]);
  });

  it("matches delegations ignoring case and accents", () => {
    const out = searchXDeliveryPlaces({ governorate: "Sousse", query: "KALÂA" });
    expect(out.map((o) => o.delegation)).toEqual(["Kalaa El Kebira", "Kalaa Essghira"]);
  });

  it("finds a locality and names the delegation it belongs to", () => {
    const out = searchXDeliveryPlaces({ governorate: "Sousse", query: "sahloul", localities: XDELIVERY_LOCALITIES });
    expect(out).toContainEqual(
      expect.objectContaining({ delegation: "Sousse Jaouhara", locality: "Sahloul", isDefault: false }),
    );
  });

  it("puts matching delegations before matching localities", () => {
    const out = searchXDeliveryPlaces({ governorate: "Sousse", query: "sousse", localities: XDELIVERY_LOCALITIES });
    const firstLocality = out.findIndex((o) => o.locality !== null);
    const lastDelegation = out.map((o) => o.locality === null).lastIndexOf(true);
    expect(firstLocality).toBeGreaterThan(lastDelegation);
  });

  it("before the localities have loaded, searches delegations only", () => {
    expect(searchXDeliveryPlaces({ governorate: "Sousse", query: "sahloul" })).toEqual([]);
  });

  it("never offers a place from another governorate", () => {
    const out = searchXDeliveryPlaces({ governorate: "Sousse", query: "ennasr", localities: XDELIVERY_LOCALITIES });
    expect(out).toEqual([]);
  });

  it("caps the list and gives each option a stable unique key", () => {
    const out = searchXDeliveryPlaces({ governorate: "Tunis", query: "cite", localities: XDELIVERY_LOCALITIES, limit: 20 });
    expect(out).toHaveLength(20);
    expect(new Set(out.map((o) => o.key)).size).toBe(20);
  });

  it("every catalogue delegation is a delegation the adapter accepts", async () => {
    const { XDELIVERY_DELEGATIONS } = await import("./catalogue");
    for (const [gov, dels] of Object.entries(XDELIVERY_LOCALITIES)) {
      for (const del of Object.keys(dels)) expect(XDELIVERY_DELEGATIONS[gov]).toContain(del);
    }
  });
});
