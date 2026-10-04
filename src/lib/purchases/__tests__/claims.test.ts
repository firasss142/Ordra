import { describe, it, expect } from "vitest";
import {
  claimEffect,
  disputedTotal,
  withheldTotal,
  summariseClaims,
  type SupplierClaim,
} from "../claims";

function claim(over: Partial<SupplierClaim> = {}): SupplierClaim {
  return {
    id: "c1",
    supplierId: "s1",
    receptionId: "r1",
    kind: "damaged",
    amount: 170,
    units: 2,
    status: "open",
    openedAt: "2026-09-29T10:00:00Z",
    ...over,
  };
}

/**
 * `invoice_total` PORTE CE QUE LE FOURNISSEUR A ÉCRIT, et le litige porte ce
 * qu'on refuse de payer.
 *
 * C'est ce que dit le commentaire de la colonne depuis le premier jour : « total
 * de la facture fournisseur ». Y ranger 18 720 quand le papier dit 18 890
 * stockerait un chiffre qui ne figure sur AUCUN document — et il faudrait
 * ensuite deviner, écran par écran, lequel des deux on lit.
 *
 * Le solde est donc `facture − versements − retenu`, et c'est le STATUT du
 * litige qui dit si le montant est retenu.
 */
describe("claimEffect — trois états, trois conséquences", () => {
  it("ouvert : retenu de la facture, et encore contesté", () => {
    expect(claimEffect(claim())).toEqual({ withheld: 170, disputed: 170 });
  });

  it("crédité : retenu pour toujours, mais plus contesté", () => {
    // L'avoir est arrivé : on ne le paiera jamais, et il n'y a plus de bataille.
    expect(claimEffect(claim({ status: "credited" }))).toEqual({ withheld: 170, disputed: 0 });
  });

  it("concédé : on renonce, donc on le doit — rien n'est retenu", () => {
    /*
     * `receptions` est immuable après soldage, mais il n'y a RIEN à corriger :
     * la facture portait déjà le montant total. Concéder, c'est simplement
     * arrêter de le retenir.
     */
    expect(claimEffect(claim({ status: "conceded" }))).toEqual({ withheld: 0, disputed: 0 });
  });
});

describe("les totaux", () => {
  const rows = [
    claim({ id: "a", amount: 170 }),
    claim({ id: "b", amount: 60, status: "conceded" }),
    claim({ id: "c", amount: 999, status: "credited" }),
    claim({ id: "d", amount: 40, supplierId: "s2" }),
  ];

  it("additionne ce qui reste contesté", () => {
    expect(disputedTotal(rows)).toBe(210);
  });

  it("additionne ce qui est retenu — contesté ou déjà crédité", () => {
    expect(withheldTotal(rows)).toBe(170 + 999 + 40);
  });

  it("répartit par fournisseur", () => {
    const by = summariseClaims(rows);
    expect(by.get("s1")).toEqual({ withheld: 1169, disputed: 170, openCount: 1, conceded: 60 });
    expect(by.get("s2")).toEqual({ withheld: 40, disputed: 40, openCount: 1, conceded: 0 });
    // Absent plutôt qu'à zéro : l'écran rend « — ».
    expect(by.has("s3")).toBe(false);
  });
});

describe("ce qui ne doit jamais arriver silencieusement", () => {
  it("un montant nul ou négatif ne compte pour rien", () => {
    // La base l'interdit (CHECK amount > 0) ; fabriquer un litige de zéro dinar
    // serait pire que d'ignorer la ligne.
    expect(withheldTotal([claim({ amount: 0 }), claim({ amount: -5 })])).toBe(0);
    expect(disputedTotal([claim({ amount: 0 })])).toBe(0);
  });
});
