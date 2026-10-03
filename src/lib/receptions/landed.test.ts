import { describe, test, expect } from "vitest";
import { allocateFees, type AllocatableLine } from "./landed";

/** Les quatre lignes de la maquette §4, aux vrais prix. */
const LINES: AllocatableLine[] = [
  { id: "qr", receivedQty: 150, unitCost: 40 },
  { id: "th", receivedQty: 94, unitCost: 85 },
  { id: "hm", receivedQty: 60, unitCost: 73.5 },
  { id: "box", receivedQty: 8, unitCost: 40 },
];

function shares(r: ReturnType<typeof allocateFees>) {
  return Object.fromEntries(r.allocations.map((a) => [a.lineId, a.share]));
}
function landed(r: ReturnType<typeof allocateFees>) {
  return Object.fromEntries(r.allocations.map((a) => [a.lineId, a.landedUnitCost]));
}

/**
 * LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE.
 *
 * Transport, douane et manutention sont payés pour qu'elle arrive ici ; les
 * ignorer rend tout COGS systématiquement TROP BAS, ce qui gonfle la marge de
 * chaque produit, le seuil de rentabilité et les relevés investisseurs. Une
 * moyenne pondérée bâtie sur un coût incomplet est pire qu'une estimation
 * périmée, parce qu'elle est confiante.
 */
describe("allocateFees — la répartition par valeur", () => {
  const r = allocateFees(LINES, 1500, "value");

  test("chaque ligne porte sa part au prorata de sa valeur", () => {
    expect(shares(r)).toEqual({
      qr: 480.769,
      th: 640.224,
      hm: 353.366,
      box: 25.641,
    });
  });

  /*
   * LA SOMME DOIT ÊTRE EXACTE. Arrondir chaque part séparément perd un millième
   * (1 499,999 au lieu de 1 500,000) — et ce millième manquant rend le
   * rapprochement contre la facture faux pour toujours. La méthode du plus
   * grand reste donne le dernier millième à la part qui le mérite le plus.
   */
  test("la somme des parts est exactement le total des frais", () => {
    const sum = r.allocations.reduce((a, x) => a + x.share, 0);
    expect(Number(sum.toFixed(3))).toBe(1500);
  });

  test("le coût de revient est le prix fournisseur plus la part, par unité", () => {
    expect(landed(r)).toEqual({
      qr: 43.205,
      th: 91.811,
      hm: 79.389,
      box: 43.205,
    });
  });

  test("rien n'est bloqué quand les prix existent", () => {
    expect(r.blocked).toBeNull();
  });
});

describe("allocateFees — la répartition par unité", () => {
  const r = allocateFees(LINES, 1500, "units");

  test("chaque unité porte la même part", () => {
    // 1 500 / 312 = 4,808 par unité.
    for (const a of r.allocations) {
      const perUnit = a.share / LINES.find((l) => l.id === a.lineId)!.receivedQty!;
      expect(Number(perUnit.toFixed(3))).toBe(4.808);
    }
  });

  test("la somme reste exacte", () => {
    const sum = r.allocations.reduce((a, x) => a + x.share, 0);
    expect(Number(sum.toFixed(3))).toBe(1500);
  });

  test("une palette de livres et un carton de jouets ne partagent pas pareil", () => {
    // Par valeur la grosse ligne porte plus ; par unité c'est la plus nombreuse.
    const byValue = shares(allocateFees(LINES, 1500, "value"));
    const byUnits = shares(r);
    expect(byUnits.qr).toBeGreaterThan(byValue.qr);
    expect(byUnits.th).toBeLessThan(byValue.th);
  });
});

describe("allocateFees — ce qu'on refuse de deviner", () => {
  test("par valeur sans aucun prix : bloqué, pas réparti au hasard", () => {
    // Retomber silencieusement sur « par unité » serait exactement le genre de
    // repli qui fabrique un COGS faux sans rien signaler.
    const r = allocateFees(
      [{ id: "a", receivedQty: 10, unitCost: null }],
      500,
      "value",
    );
    expect(r.blocked).toBe("no_value");
    expect(r.allocations).toEqual([]);
  });

  test("par unité sans rien de reçu : bloqué aussi", () => {
    const r = allocateFees([{ id: "a", receivedQty: 0, unitCost: 12 }], 500, "units");
    expect(r.blocked).toBe("no_units");
  });

  test("aucun frais : des parts nulles, et surtout pas un blocage", () => {
    const r = allocateFees(LINES, 0, "value");
    expect(r.blocked).toBeNull();
    expect(r.allocations.every((a) => a.share === 0)).toBe(true);
    // Le coût de revient est alors exactement le prix du fournisseur.
    expect(landed(r).qr).toBe(40);
  });

  test("une ligne non comptée ne porte aucune part", () => {
    const r = allocateFees(
      [...LINES, { id: "vide", receivedQty: null, unitCost: 50 }],
      1500,
      "value",
    );
    expect(shares(r).vide).toBe(0);
    // Et elle n'a pas de coût de revient : rien n'est arrivé.
    expect(landed(r).vide).toBeNull();
  });

  test("un prix manquant sur UNE ligne ne casse pas les autres", () => {
    const r = allocateFees(
      [...LINES, { id: "sansprix", receivedQty: 20, unitCost: null }],
      1500,
      "value",
    );
    expect(r.blocked).toBeNull();
    // Elle ne pèse rien dans une répartition par valeur : elle n'en a pas.
    expect(shares(r).sansprix).toBe(0);
    // Et son coût de revient reste inconnu plutôt qu'inventé.
    expect(landed(r).sansprix).toBeNull();
  });
});
