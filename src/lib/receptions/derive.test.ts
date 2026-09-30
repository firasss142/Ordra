import { describe, it, expect } from "vitest";
import {
  paymentState,
  lineVariance,
  receptionTotals,
  isLate,
  weightedAverageCost,
} from "./derive";

/**
 * Ce qui se DÉDUIT, et ne se stocke donc jamais.
 *
 * Trois règles de ce projet sont testées ici plutôt que commentées :
 *   · « en retard » est un calcul, pas un statut (un drapeau stocké demanderait
 *     un cron et serait faux le jour où il ne tourne pas) ;
 *   · l'écart n'existe que si les DEUX nombres existent — sinon `null`, jamais
 *     0, pour que l'écran dise « non annoncé » et non un faux « conforme » ;
 *   · « payé » se déduit de la somme des paiements contre la valeur reçue.
 */

describe("paymentState", () => {
  it("dit « sans objet » quand rien n'a encore de valeur", () => {
    // Une réception attendue n'a pas de valeur reçue : elle n'est pas
    // « impayée », la question ne se pose pas encore.
    expect(paymentState({ value: 0, paid: 0 })).toBe("not_applicable");
    expect(paymentState({ value: null, paid: 0 })).toBe("not_applicable");
  });

  it("dit « impayée » quand la valeur existe et rien n'est versé", () => {
    expect(paymentState({ value: 3750, paid: 0 })).toBe("unpaid");
  });

  it("dit « partiellement payée » entre les deux", () => {
    expect(paymentState({ value: 18720, paid: 7488 })).toBe("partial");
  });

  it("dit « payée » au centime près", () => {
    expect(paymentState({ value: 18720, paid: 18720 })).toBe("paid");
  });

  it("considère un trop-payé comme payé, pas comme une erreur", () => {
    // Un arrondi de virement ou un geste commercial ne doit pas faire clignoter
    // l'écran en rouge.
    expect(paymentState({ value: 100, paid: 100.5 })).toBe("paid");
  });

  it("tolère les flottants sans basculer en « partiel »", () => {
    expect(paymentState({ value: 0.3, paid: 0.1 + 0.2 })).toBe("paid");
  });
});

describe("lineVariance", () => {
  it("rend null quand rien n'était annoncé — jamais 0", () => {
    expect(lineVariance({ expected: null, received: 8 })).toBeNull();
  });

  it("rend null quand rien n'a encore été compté", () => {
    expect(lineVariance({ expected: 100, received: null })).toBeNull();
  });

  it("rend 0 quand la livraison est conforme", () => {
    expect(lineVariance({ expected: 150, received: 150 })).toBe(0);
  });

  it("rend un écart négatif pour un manque", () => {
    expect(lineVariance({ expected: 100, received: 94 })).toBe(-6);
  });

  it("rend un écart positif pour un surplus", () => {
    expect(lineVariance({ expected: 50, received: 58 })).toBe(8);
  });
});

describe("receptionTotals", () => {
  const lines = [
    { received_qty: 150, damaged_qty: 0, unit_cost: 40 },
    { received_qty: 94, damaged_qty: 2, unit_cost: 85 },
    { received_qty: 60, damaged_qty: 0, unit_cost: 73.5 },
    { received_qty: 8, damaged_qty: 0, unit_cost: 40 },
  ];

  it("compte les unités reçues", () => {
    expect(receptionTotals(lines).units).toBe(312);
  });

  it("compte les abîmées à part", () => {
    expect(receptionTotals(lines).damaged).toBe(2);
  });

  it("valorise les unités reçues et EXCLUT les abîmées", () => {
    // 150×40 + 94×85 + 60×73,5 + 8×40 = 6000 + 7990 + 4410 + 320
    expect(receptionTotals(lines).value).toBeCloseTo(18720, 3);
  });

  it("ne compte que les lignes qui portent une quantité", () => {
    expect(receptionTotals([{ received_qty: null, damaged_qty: 0, unit_cost: 10 }]).units).toBe(0);
  });

  it("rend une valeur nulle quand aucun coût n'est saisi, pas zéro", () => {
    // Personne n'a dit ce que ça coûtait : « — », pas « 0,000 ».
    expect(receptionTotals([{ received_qty: 10, damaged_qty: 0, unit_cost: null }]).value).toBeNull();
  });

  it("valorise ce qui est chiffré même si une ligne ne l'est pas", () => {
    const mixed = [
      { received_qty: 10, damaged_qty: 0, unit_cost: 5 },
      { received_qty: 10, damaged_qty: 0, unit_cost: null },
    ];
    const t = receptionTotals(mixed);
    expect(t.units).toBe(20);
    expect(t.value).toBeCloseTo(50, 3);
    expect(t.valuedLines).toBe(1);
  });
});

describe("isLate", () => {
  const today = new Date("2026-09-30T10:00:00Z");

  it("est en retard quand la date prévue est passée et rien n'est validé", () => {
    expect(isLate({ expected_at: "2026-09-26", status: "draft" }, today)).toBe(true);
    expect(isLate({ expected_at: "2026-09-26", status: "submitted" }, today)).toBe(true);
  });

  it("n'est jamais en retard une fois validée", () => {
    expect(isLate({ expected_at: "2026-09-26", status: "posted" }, today)).toBe(false);
    expect(isLate({ expected_at: "2026-09-26", status: "reversed" }, today)).toBe(false);
    expect(isLate({ expected_at: "2026-09-26", status: "cancelled" }, today)).toBe(false);
  });

  it("n'est pas en retard le jour même", () => {
    expect(isLate({ expected_at: "2026-09-30", status: "draft" }, today)).toBe(false);
  });

  it("n'est pas en retard sans date prévue — on n'invente pas une échéance", () => {
    expect(isLate({ expected_at: null, status: "draft" }, today)).toBe(false);
  });
});

describe("weightedAverageCost", () => {
  it("calcule la moyenne pondérée sur le stock existant", () => {
    // 110 à 10,000 + 40 à 20,000 → 1900/150
    expect(weightedAverageCost({ stockBefore: 110, cogsBefore: 10, qty: 40, unitCost: 20 }))
      .toBeCloseTo(12.667, 3);
  });

  it("prend le prix d'achat tel quel quand il n'y avait pas de stock", () => {
    expect(weightedAverageCost({ stockBefore: 0, cogsBefore: 99, qty: 10, unitCost: 15 })).toBe(15);
  });

  it("traite un stock négatif comme zéro plutôt que d'inverser la moyenne", () => {
    // Un stock négatif existe dans cette base (survente) ; il ne doit pas
    // produire un coût absurde.
    expect(weightedAverageCost({ stockBefore: -20, cogsBefore: 10, qty: 10, unitCost: 30 })).toBe(30);
  });

  it("rend null quand il n'y a pas de prix d'achat à propager", () => {
    expect(weightedAverageCost({ stockBefore: 10, cogsBefore: 10, qty: 5, unitCost: null })).toBeNull();
  });

  it("rend null pour une quantité nulle — rien n'est arrivé", () => {
    expect(weightedAverageCost({ stockBefore: 10, cogsBefore: 10, qty: 0, unitCost: 20 })).toBeNull();
  });
});
