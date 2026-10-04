import { describe, test, expect } from "vitest";
import { incomingByProduct, type IncomingReception } from "../incoming";

/**
 * « EN ROUTE » EST SUSPENDU, ET C'EST VOULU.
 *
 * Sous le modèle de l'arrivage, le stock entre quand le carton est au sol : un
 * groupe ouvert porte des unités DÉJÀ dans `products.current_stock`. Les
 * compter ici les compterait deux fois, et `reorder_by_date` soustrairait du
 * stock qui est sur l'étagère.
 *
 * Ce qui est vraiment en transit, c'est ce qui est COMMANDÉ et pas encore
 * arrivé — et ça demande les bons de commande de l'étape 6.
 */
describe("incomingByProduct — plus rien n'est en route", () => {
  const open: IncomingReception = {
    status: "open",
    expected_at: "2026-10-10",
    lines: [{ product_id: "p1", expected_qty: 100, received_qty: null }],
  };

  test("un groupe ouvert ne compte pas : ses unités sont déjà en stock", () => {
    expect(incomingByProduct([open]).size).toBe(0);
  });

  test("un groupe soldé non plus", () => {
    expect(incomingByProduct([{ ...open, status: "settled" }]).size).toBe(0);
  });

  test("une contre-passation non plus", () => {
    expect(incomingByProduct([{ ...open, status: "reversed" }]).size).toBe(0);
  });

  test("la Map reste VIDE plutôt que de porter des zéros", () => {
    // L'écran rend « — » sur une absence, et « 0 » sur un zéro. Les deux ne
    // disent pas la même chose : l'un avoue, l'autre rassure.
    const out = incomingByProduct([open, { ...open, status: "settled" }]);
    expect([...out.entries()]).toEqual([]);
    expect(out.get("p1")).toBeUndefined();
  });
});
