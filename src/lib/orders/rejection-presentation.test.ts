import { describe, it, expect } from "vitest";
import { presentRejection } from "./rejection-presentation";
import type { RejectionReasonConfig } from "@/types/rejection-config";

let seq = 0;
function row(over: Partial<RejectionReasonConfig>): RejectionReasonConfig {
  seq += 1;
  return {
    id: `r${seq}`,
    market_id: "m",
    parent_key: null,
    key: `k${seq}`,
    label_fr: "Label long",
    label_ar: "تسمية طويلة",
    short_fr: "Court",
    short_ar: "قصير",
    hue: "red",
    sort_order: 0,
    is_active: true,
    requires_note: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const CONFIG: RejectionReasonConfig[] = [
  row({ key: "injoignable", hue: "amber", short_fr: "Injoignable", short_ar: "تعذر" }),
  row({
    key: "numero_invalide",
    parent_key: "injoignable",
    short_fr: "Faux n°",
    short_ar: "رقم خاطئ",
    label_fr: "Numéro faux ou inexistant",
  }),
  row({ key: "refus_client", hue: "red", short_fr: "Refus" }),
  row({ key: "autre", hue: "neutral", short_fr: "Autre", requires_note: true }),
];

describe("presentRejection — hue", () => {
  it("takes the hue from the sub-reason's own group", () => {
    const { hue } = presentRejection(
      { reason: "injoignable", subreason: "numero_invalide" },
      CONFIG,
    );
    expect(hue).toBe("amber");
  });

  it("resolves the group from the sub-reason when the reason column is empty", () => {
    const { hue } = presentRejection({ subreason: "numero_invalide" }, CONFIG);
    expect(hue).toBe("amber");
  });

  it("honours a group recoloured by a manager", () => {
    const recoloured = CONFIG.map((r) =>
      r.key === "injoignable" ? { ...r, hue: "violet" as const } : r,
    );
    const { hue } = presentRejection(
      { reason: "injoignable", subreason: "numero_invalide" },
      recoloured,
    );
    expect(hue).toBe("violet");
  });

  // Before the SWR fetch resolves, every surface still has to render.
  it("falls back to the seeded hue when the config has not loaded", () => {
    expect(presentRejection({ reason: "injoignable" }, []).hue).toBe("amber");
    expect(presentRejection({ reason: "refus_client" }, []).hue).toBe("red");
    expect(presentRejection({ reason: "commande_invalide" }, []).hue).toBe(
      "neutral",
    );
    expect(presentRejection({ reason: "livraison_impossible" }, []).hue).toBe(
      "violet",
    );
  });

  it("colours the four legacy enum groups like the groups that absorbed them", () => {
    expect(presentRejection({ reason: "faux_numero" }, []).hue).toBe("amber");
    expect(presentRejection({ reason: "prix" }, []).hue).toBe("red");
    expect(presentRejection({ reason: "doublon" }, []).hue).toBe("neutral");
  });

  it("stays red for a rejection carrying no reason at all", () => {
    expect(presentRejection({}, CONFIG).hue).toBe("red");
  });
});

describe("presentRejection — label", () => {
  it("prefers the sub-reason's short label, in the active locale", () => {
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        CONFIG,
        "fr",
      ).label,
    ).toEqual({ kind: "config", text: "Faux n°" });

    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        CONFIG,
        "ar",
      ).label,
    ).toEqual({ kind: "config", text: "رقم خاطئ" });
  });

  it("still labels a sub-reason that has since been retired", () => {
    const retired = CONFIG.map((r) =>
      r.key === "numero_invalide" ? { ...r, is_active: false } : r,
    );
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        retired,
      ).label,
    ).toEqual({ kind: "config", text: "Faux n°" });
  });

  it("uses the agent's own words for `autre`, which is the only reason it exists", () => {
    expect(
      presentRejection(
        { reason: "autre", subreason: null, note: "  livre au voisin  " },
        CONFIG,
      ).label,
    ).toEqual({ kind: "note", text: "livre au voisin" });
  });

  it("falls back to the group's short label when there is no sub-reason", () => {
    expect(presentRejection({ reason: "refus_client" }, CONFIG).label).toEqual({
      kind: "config",
      text: "Refus",
    });
  });

  it("falls back to a translation key when the config has not loaded", () => {
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        [],
      ).label,
    ).toEqual({
      kind: "i18n",
      ns: "orders.rejectionSubreasonsShort",
      key: "numero_invalide",
    });

    expect(presentRejection({ reason: "prix" }, []).label).toEqual({
      kind: "i18n",
      ns: "orders.rejectionReasons",
      key: "prix",
    });
  });

  it("says only 'rejected' when nothing else is known", () => {
    expect(presentRejection({}, CONFIG).label).toEqual({ kind: "status" });
    expect(presentRejection({ reason: "autre", note: "   " }, CONFIG).label).toEqual(
      { kind: "config", text: "Autre" },
    );
  });

  // A note long enough to break the column is the caller's problem to truncate,
  // but the module must not hand back a multi-line string.
  it("collapses whitespace in a free-text note", () => {
    expect(
      presentRejection({ reason: "autre", note: "pas\n  clair" }, CONFIG).label,
    ).toEqual({ kind: "note", text: "pas clair" });
  });
});
