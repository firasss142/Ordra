import { describe, it, expect } from "vitest";
import {
  paymentState,
  lineVariance,
  receptionTotals,
  isLate,
  daysLate,
  weightedAverageCost,
  headlineQuantity,
  paidPercent,
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

/**
 * « EN RETARD » A CHANGÉ DE SENS AVEC L'INVERSION.
 *
 * Il se mesurait contre `expected_at`, la date ANNONCÉE — et personne n'annonce
 * plus une réception : le quai compte, le bureau solde. Rien n'écrit cette
 * colonne, donc `isLate` répondait `false` pour l'éternité et le liseré rouge de
 * la liste ne pouvait plus s'allumer. Un signal mort est pire qu'absent : on
 * croit qu'il n'y a rien à voir.
 *
 * Ce qui mérite d'être signalé maintenant, c'est un groupe OUVERT DEPUIS LA
 * VEILLE : de la marchandise vendable dont la marge reste inconnue. C'est le
 * coût assumé de l'inversion, et il ne doit pas s'éterniser.
 */
describe("isLate", () => {
  const today = new Date("2026-10-04T10:00:00Z");

  it("signale un groupe ouvert depuis la veille", () => {
    expect(isLate({ arrival_date: "2026-10-03", status: "open" }, today)).toBe(true);
    expect(isLate({ arrival_date: "2026-09-26", status: "open" }, today)).toBe(true);
  });

  it("ne signale pas le groupe du jour — c'est le fonctionnement normal", () => {
    expect(isLate({ arrival_date: "2026-10-04", status: "open" }, today)).toBe(false);
  });

  it("ne signale jamais un groupe soldé ou contre-passé", () => {
    // Le soldage EST la réponse : une fois chiffrée, la marchandise n'attend plus.
    expect(isLate({ arrival_date: "2026-09-26", status: "settled" }, today)).toBe(false);
    expect(isLate({ arrival_date: "2026-09-26", status: "reversed" }, today)).toBe(false);
  });

  it("ne signale jamais un groupe sans date d'arrivage", () => {
    expect(isLate({ arrival_date: null, status: "open" }, today)).toBe(false);
  });

  it("dit de combien de jours", () => {
    expect(daysLate({ arrival_date: "2026-10-01", status: "open" }, today)).toBe(3);
    expect(daysLate({ arrival_date: "2026-10-04", status: "open" }, today)).toBeNull();
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

/**
 * LE CHIFFRE DE TÊTE D'UNE LIGNE DE LISTE.
 *
 * La maquette §3 ne montre jamais un nombre nu : « 300 attendues », « 312
 * comptées », « 1 000 unités », « 80 annulées ». Le mot n'est pas décoratif —
 * c'est lui qui dit si le nombre est une promesse ou un fait, et `totals.units`
 * seul ne peut pas le dire puisqu'il somme le REÇU : une réception annoncée mais
 * pas encore comptée y vaut 0, ce qui se lirait « rien n'est arrivé ».
 */
describe("headlineQuantity", () => {
  const t = (over: Partial<ReturnType<typeof receptionTotals>> = {}) => ({
    units: 0,
    damaged: 0,
    value: null,
    valuedLines: 0,
    lines: 0,
    expected: null,
    countedLines: 0,
    ...over,
  });

  it("annonce l'attendu d'une réception que personne n'a encore comptée", () => {
    const h = headlineQuantity({ status: "open", totals: t({ expected: 300, lines: 3 }) });
    expect(h).toEqual({ value: 300, kind: "expected" });
  });

  it("bascule sur le compté dès qu'une ligne porte un nombre", () => {
    const h = headlineQuantity({
      status: "open",
      totals: t({ units: 150, expected: 300, lines: 3, countedLines: 1 }),
    });
    expect(h).toEqual({ value: 150, kind: "counted" });
  });

  it("dit « comptées » sur une déclaration en attente de manager", () => {
    const h = headlineQuantity({
      status: "open",
      totals: t({ units: 312, expected: 310, lines: 5, countedLines: 5 }),
    });
    expect(h).toEqual({ value: 312, kind: "counted" });
  });

  it("dit « unités » une fois validée — ce n'est plus une promesse", () => {
    const h = headlineQuantity({
      status: "settled",
      totals: t({ units: 602, expected: 600, lines: 14, countedLines: 14 }),
    });
    expect(h).toEqual({ value: 602, kind: "units" });
  });

  it("dit « annulées » sur une contre-passation", () => {
    const h = headlineQuantity({
      status: "reversed",
      totals: t({ units: 80, expected: 80, lines: 1, countedLines: 1 }),
    });
    expect(h).toEqual({ value: 80, kind: "cancelled" });
  });

  /*
   * Une livraison surprise ouverte à vide : rien d'annoncé, rien de compté.
   * Zéro serait un mensonge dans les deux sens — ni « rien n'est attendu », ni
   * « rien n'est arrivé » n'a été établi. Le tiret dit « on ne sait pas encore ».
   */
  it("ne rend aucun nombre quand rien n'est ni annoncé ni compté", () => {
    const h = headlineQuantity({ status: "open", totals: t({ lines: 0 }) });
    expect(h).toEqual({ value: null, kind: "unknown" });
  });
});

describe("receptionTotals — l'attendu et les lignes comptées", () => {
  it("somme l'attendu annoncé", () => {
    const out = receptionTotals([
      { expected_qty: 150, received_qty: null, damaged_qty: 0, unit_cost: null },
      { expected_qty: 100, received_qty: null, damaged_qty: 0, unit_cost: null },
    ]);
    expect(out.expected).toBe(250);
  });

  it("laisse l'attendu à null quand aucune ligne n'annonce rien", () => {
    // « non annoncé » n'est pas « zéro attendu ».
    const out = receptionTotals([
      { expected_qty: null, received_qty: 8, damaged_qty: 0, unit_cost: null },
    ]);
    expect(out.expected).toBeNull();
  });

  it("ignore les lignes non annoncées dans la somme des attendus", () => {
    const out = receptionTotals([
      { expected_qty: 150, received_qty: null, damaged_qty: 0, unit_cost: null },
      { expected_qty: null, received_qty: 8, damaged_qty: 0, unit_cost: null },
    ]);
    expect(out.expected).toBe(150);
  });

  /* Zéro compté EST une réponse — « le carton était vide ». Pas une absence. */
  it("compte une ligne à zéro comme comptée", () => {
    const out = receptionTotals([
      { expected_qty: 10, received_qty: 0, damaged_qty: 0, unit_cost: null },
      { expected_qty: 10, received_qty: null, damaged_qty: 0, unit_cost: null },
    ]);
    expect(out.countedLines).toBe(1);
  });
});

/**
 * « acompte 40 % » dans la liste. La colonne est étroite ; un pourcentage y tient
 * là où un montant et sa devise n'y tiennent pas, et le reste à payer exact a sa
 * place dans la feuille.
 */
describe("paidPercent", () => {
  it("rend le pourcentage versé", () => {
    expect(paidPercent({ value: 18720, paid: 7488 })).toBe(40);
  });

  it("arrondit à l'entier — « acompte 40 % », pas « 40,0038 % »", () => {
    expect(paidPercent({ value: 3, paid: 1 })).toBe(33);
  });

  it("plafonne à 100 sur un trop-payé", () => {
    expect(paidPercent({ value: 100, paid: 120 })).toBe(100);
  });

  it("rend null sans valeur reçue — on ne divise pas par une inconnue", () => {
    expect(paidPercent({ value: null, paid: 50 })).toBeNull();
    expect(paidPercent({ value: 0, paid: 0 })).toBeNull();
  });
});
