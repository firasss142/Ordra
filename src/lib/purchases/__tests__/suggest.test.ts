import { describe, it, expect } from "vitest";
import { suggestOrderQty, TARGET_COVER_DAYS, type SuggestInput } from "../suggest";

function input(over: Partial<SuggestInput> = {}): SuggestInput {
  return {
    demandRatePerDay: 10,
    freeToSell: 122,
    onOrderUnits: 0,
    leadTimeDays: 11,
    ...over,
  };
}

describe("suggestOrderQty — de quoi tenir jusqu'à la prochaine livraison", () => {
  it("couvre le délai plus la cible, moins ce qu'on a", () => {
    // 10/j × (11 + 45) = 560 ; on a 122 ⇒ 438.
    const s = suggestOrderQty(input());
    expect(s.qty).toBe(438);
    expect(s.target_days).toBe(11 + TARGET_COVER_DAYS);
  });

  it("déduit ce qui est déjà en route", () => {
    // Commander deux fois le même manque est l'erreur que « en route » existe
    // précisément pour empêcher.
    expect(suggestOrderQty(input({ onOrderUnits: 200 })).qty).toBe(238);
  });

  it("ne suggère rien quand on en a déjà assez", () => {
    const s = suggestOrderQty(input({ freeToSell: 900 }));
    expect(s.qty).toBeNull();
    expect(s.reason).toBe("covered");
  });

  it("compte un déficit comme un manque, pas comme un stock", () => {
    // free_to_sell négatif = survendu. On doit couvrir le trou EN PLUS.
    expect(suggestOrderQty(input({ freeToSell: -30 })).qty).toBe(590);
  });

  it("se tait quand la demande est inconnue", () => {
    // Proposer un chiffre sans demande mesurée serait une invention présentée
    // comme un calcul. `null` et une raison, pas un nombre rassurant.
    const s = suggestOrderQty(input({ demandRatePerDay: 0 }));
    expect(s.qty).toBeNull();
    expect(s.reason).toBe("no_demand");

    expect(suggestOrderQty(input({ demandRatePerDay: null })).reason).toBe("no_demand");
  });

  it("arrondit vers le haut : une unité manquante est une rupture", () => {
    // 3,2/j × 56 = 179,2 ⇒ 180, pas 179.
    expect(suggestOrderQty(input({ demandRatePerDay: 3.2, freeToSell: 0 })).qty).toBe(180);
  });
});
