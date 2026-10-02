import { describe, it, expect } from "vitest";
import { incomingByProduct, STALE_DRAFT_DAYS } from "../incoming";

/**
 * « En route » — les unités commandées qui ne sont pas encore sur l'étagère.
 *
 * C'est le chiffre que plans/stock-page-radical-redesign.md décrit comme « la
 * seule chose vraiment non calculable » faute de table de commandes, et sans
 * lequel une date de réapprovisionnement est un vœu : `reorder_by_date` ne
 * pouvait pas soustraire ce qui est déjà commandé.
 *
 * LA DÉCISION QUE CE FICHIER FIGE. Un brouillon que personne n'a annulé
 * gonflerait la couverture pour toujours : l'écran dirait « 300 en route » des
 * mois après que le fournisseur a cessé de répondre, et quelqu'un renoncerait à
 * recommander. On ne compte donc PAS tous les brouillons :
 *
 *   · `submitted` compte toujours — la marchandise est sur le quai, comptée ;
 *   · `draft` compte tant qu'il est plausible, c'est-à-dire jusqu'à
 *     `expected_at + STALE_DRAFT_DAYS` ;
 *   · un brouillon SANS date prévue ne compte pas : rien ne permet de dire s'il
 *     est vivant, et inventer une échéance serait pire que se taire.
 *
 * Le chiffre rendu est `null` et jamais `0` quand rien n'est en route, pour que
 * l'écran dise « — » au lieu d'un faux zéro rassurant.
 */

const TODAY = new Date("2026-10-01T10:00:00Z");

function row(over: Record<string, unknown> = {}) {
  return {
    status: "submitted",
    expected_at: "2026-09-28",
    lines: [{ product_id: "p1", expected_qty: 100, received_qty: null }],
    ...over,
  };
}

describe("incomingByProduct — ce qui compte", () => {
  it("compte une réception déclarée : la marchandise est sur le quai", () => {
    const m = incomingByProduct([row()], TODAY);
    expect(m.get("p1")).toBe(100);
  });

  it("compte un brouillon dont la date prévue est encore plausible", () => {
    const m = incomingByProduct([row({ status: "draft", expected_at: "2026-10-05" })], TODAY);
    expect(m.get("p1")).toBe(100);
  });

  it("additionne plusieurs réceptions du même produit", () => {
    const m = incomingByProduct(
      [row(), row({ lines: [{ product_id: "p1", expected_qty: 50, received_qty: null }] })],
      TODAY,
    );
    expect(m.get("p1")).toBe(150);
  });

  it("sépare les produits", () => {
    const m = incomingByProduct(
      [
        row({
          lines: [
            { product_id: "p1", expected_qty: 100, received_qty: null },
            { product_id: "p2", expected_qty: 7, received_qty: null },
          ],
        }),
      ],
      TODAY,
    );
    expect(m.get("p1")).toBe(100);
    expect(m.get("p2")).toBe(7);
  });
});

describe("incomingByProduct — ce qui ne compte pas", () => {
  it("ignore une réception validée : les unités SONT le stock, les compter deux fois", () => {
    expect(incomingByProduct([row({ status: "posted" })], TODAY).get("p1")).toBeUndefined();
  });

  it("ignore une annulée et une contre-passée", () => {
    expect(incomingByProduct([row({ status: "cancelled" })], TODAY).get("p1")).toBeUndefined();
    expect(incomingByProduct([row({ status: "reversed" })], TODAY).get("p1")).toBeUndefined();
  });

  /*
   * LE CŒUR DE LA DÉCISION. Sans cette règle, « en route » ne redescend jamais.
   */
  it("ignore un brouillon périmé — sinon la couverture mentirait pour toujours", () => {
    const m = incomingByProduct(
      [row({ status: "draft", expected_at: "2026-01-15" })],
      TODAY,
    );
    expect(m.get("p1")).toBeUndefined();
  });

  it("garde un brouillon juste avant la limite et lâche juste après", () => {
    const limit = new Date(TODAY);
    limit.setUTCDate(limit.getUTCDate() - STALE_DRAFT_DAYS);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const justInside = new Date(limit);
    justInside.setUTCDate(justInside.getUTCDate() + 1);
    expect(
      incomingByProduct([row({ status: "draft", expected_at: iso(justInside) })], TODAY).get("p1"),
    ).toBe(100);

    const justOutside = new Date(limit);
    justOutside.setUTCDate(justOutside.getUTCDate() - 1);
    expect(
      incomingByProduct([row({ status: "draft", expected_at: iso(justOutside) })], TODAY).get("p1"),
    ).toBeUndefined();
  });

  it("ignore un brouillon sans date prévue — on n'invente pas une échéance", () => {
    const m = incomingByProduct([row({ status: "draft", expected_at: null })], TODAY);
    expect(m.get("p1")).toBeUndefined();
  });

  it("compte une déclaration même sans date prévue : le quai est un fait", () => {
    // `submitted` veut dire que quelqu'un a vu la marchandise. La date prévue
    // ne décide plus de rien.
    const m = incomingByProduct([row({ status: "submitted", expected_at: null })], TODAY);
    expect(m.get("p1")).toBe(100);
  });

  it("ignore une ligne sans quantité annoncée — null n'est pas zéro", () => {
    const m = incomingByProduct(
      [row({ lines: [{ product_id: "p1", expected_qty: null, received_qty: null }] })],
      TODAY,
    );
    expect(m.get("p1")).toBeUndefined();
  });

  it("rend une Map vide plutôt qu'une Map de zéros", () => {
    expect(incomingByProduct([], TODAY).size).toBe(0);
  });
});

describe("incomingByProduct — ce qui reste à venir sur une ligne partielle", () => {
  /*
   * Une réception déclarée peut avoir des lignes déjà comptées : ces unités-là
   * ne sont plus « en route », elles sont sur le quai et attendent la validation.
   * Ce qui reste en route est le SOLDE attendu moins reçu.
   */
  it("ne compte que le solde non reçu", () => {
    const m = incomingByProduct(
      [row({ lines: [{ product_id: "p1", expected_qty: 100, received_qty: 60 }] })],
      TODAY,
    );
    expect(m.get("p1")).toBe(40);
  });

  it("ne compte rien quand tout est déjà compté", () => {
    const m = incomingByProduct(
      [row({ lines: [{ product_id: "p1", expected_qty: 100, received_qty: 100 }] })],
      TODAY,
    );
    expect(m.get("p1")).toBeUndefined();
  });

  it("ne descend jamais sous zéro sur un surplus", () => {
    const m = incomingByProduct(
      [row({ lines: [{ product_id: "p1", expected_qty: 100, received_qty: 130 }] })],
      TODAY,
    );
    expect(m.get("p1")).toBeUndefined();
  });
});
