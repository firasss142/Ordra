import { describe, expect, it } from "vitest";
import {
  REJECTION_GROUPS,
  REJECTION_SUBREASONS,
  ALL_SUBREASONS,
  groupForSubreason,
  isValidPair,
} from "./rejection-taxonomy";

describe("the taxonomy shape", () => {
  it("offers exactly the five groups the picker shows", () => {
    expect([...REJECTION_GROUPS]).toEqual([
      "refus_client",
      "commande_invalide",
      "injoignable",
      "livraison_impossible",
      "autre",
    ]);
  });

  it("gives every group but `autre` at least two sub-reasons", () => {
    for (const g of REJECTION_GROUPS) {
      const subs = REJECTION_SUBREASONS[g];
      if (g === "autre") {
        expect(subs, g).toEqual([]);
      } else {
        expect(subs.length, g).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("never repeats a sub-reason across two groups", () => {
    // A sub-reason that appeared twice would make groupForSubreason ambiguous
    // and the analytics roll-up double-count.
    expect(new Set(ALL_SUBREASONS).size).toBe(ALL_SUBREASONS.length);
  });

  it("keeps every sub-reason key in sync with the database CHECK constraint", () => {
    // Mirrors orders_rejection_subreason_check. If this list and that constraint
    // disagree, the picker offers a value the write will reject.
    expect([...ALL_SUBREASONS].sort()).toEqual(
      [
        "prix_eleve", "frais_livraison", "achete_ailleurs", "changement_avis", "produit_non_voulu",
        "non_commande", "doublon", "simple_info", "non_serieux",
        "pas_de_reponse", "numero_invalide", "numero_hors_service", "mauvais_interlocuteur", "raccroche",
        "hors_couverture", "paiement_impossible", "adresse_invalide", "absent_ville",
      ].sort(),
    );
  });
});

describe("groupForSubreason", () => {
  it("resolves each sub-reason back to the group that owns it", () => {
    expect(groupForSubreason("achete_ailleurs")).toBe("refus_client");
    expect(groupForSubreason("doublon")).toBe("commande_invalide");
    expect(groupForSubreason("raccroche")).toBe("injoignable");
    expect(groupForSubreason("hors_couverture")).toBe("livraison_impossible");
  });

  it("returns null for an unknown key rather than guessing", () => {
    expect(groupForSubreason("not_a_reason")).toBeNull();
    expect(groupForSubreason(null)).toBeNull();
  });
});

describe("isValidPair", () => {
  it("accepts a sub-reason that belongs to its group", () => {
    expect(isValidPair("injoignable", "numero_invalide")).toBe(true);
  });

  it("rejects a sub-reason borrowed from another group", () => {
    expect(isValidPair("injoignable", "hors_couverture")).toBe(false);
  });

  it("requires a sub-reason for every group except autre", () => {
    expect(isValidPair("injoignable", null)).toBe(false);
    expect(isValidPair("autre", null)).toBe(true);
  });

  it("rejects a sub-reason attached to autre", () => {
    // `autre` carries its detail in the free-text note, not in a key.
    expect(isValidPair("autre", "doublon")).toBe(false);
  });
});
