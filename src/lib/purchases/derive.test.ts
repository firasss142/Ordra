import { describe, test, expect } from "vitest";
import { payable, type PayableRow } from "./derive";

const TODAY = new Date("2026-10-03T09:00:00Z");

function row(over: Partial<PayableRow> = {}): PayableRow {
  return {
    receptionId: "r-1",
    supplierId: "s-1",
    invoiceTotal: 18720,
    paid: 0,
    dueAt: "2026-10-15",
    ...over,
  };
}

/**
 * CE QU'ON DOIT N'EST PAS CE QUE ÇA A COÛTÉ.
 *
 * `invoice_total` est la facture du fournisseur ; le coût de revient ajoute le
 * transport et la douane, qui sont dus à d'autres. Les confondre ferait payer
 * deux fois dans la tête du lecteur, donc le solde se calcule sur la facture
 * seule et rien d'autre ne rentre ici.
 */
describe("payable — le solde d'une réception", () => {
  test("facture non chiffrée : solde null, jamais 0", () => {
    // Une réception dont le bureau n'a pas encore saisi la facture : on doit
    // quelque chose, on ne sait pas combien. `0` dirait « rien à payer ».
    const p = payable(row({ invoiceTotal: null }), TODAY);
    expect(p.balance).toBeNull();
    expect(p.state).toBe("unknown");
    expect(p.daysLate).toBeNull();
  });

  test("rien versé : le solde est la facture entière", () => {
    expect(payable(row(), TODAY).balance).toBe(18720);
    expect(payable(row(), TODAY).state).toBe("due");
  });

  test("acompte : le solde est le reste", () => {
    expect(payable(row({ paid: 7488 }), TODAY).balance).toBe(11232);
    expect(payable(row({ paid: 7488 }), TODAY).state).toBe("due");
  });

  test("soldée : état payé, solde 0", () => {
    const p = payable(row({ paid: 18720 }), TODAY);
    expect(p.balance).toBe(0);
    expect(p.state).toBe("paid");
  });

  test("trop versé : le solde ne descend pas sous 0", () => {
    // Un virement en trop est une créance sur le fournisseur, pas une dette
    // négative. On ne l'invente pas ici.
    expect(payable(row({ paid: 19000 }), TODAY).balance).toBe(0);
    expect(payable(row({ paid: 19000 }), TODAY).state).toBe("paid");
  });

  test("échéance dépassée : en retard, avec le nombre de jours", () => {
    const p = payable(row({ dueAt: "2026-09-24" }), TODAY);
    expect(p.state).toBe("overdue");
    expect(p.daysLate).toBe(9);
  });

  test("échue aujourd'hui : pas encore en retard", () => {
    const p = payable(row({ dueAt: "2026-10-03" }), TODAY);
    expect(p.state).toBe("due");
    expect(p.daysLate).toBeNull();
  });

  test("sans échéance : on doit, on ne sait pas quand", () => {
    const p = payable(row({ dueAt: null }), TODAY);
    expect(p.state).toBe("due");
    expect(p.daysLate).toBeNull();
  });

  test("payée en retard : l'état reste payé — un solde nul n'est jamais en retard", () => {
    const p = payable(row({ dueAt: "2026-09-24", paid: 18720 }), TODAY);
    expect(p.state).toBe("paid");
    expect(p.daysLate).toBeNull();
  });
});

/**
 * CE QU'ON RETIENT N'EST PAS DÛ.
 *
 * `invoice_total` porte ce que le fournisseur a écrit ; un litige dit ce qu'on
 * refuse de payer. Sans cette soustraction, l'échéancier réclamerait des unités
 * arrivées cassées — et pire, il les réclamerait APRÈS que le fournisseur a
 * émis son avoir.
 */
describe("payable — les montants retenus", () => {
  test("retire le litige du solde", () => {
    const p = payable(
      { invoiceTotal: 12920, paid: 0, dueAt: "2026-10-30", withheld: 170 },
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(p.balance).toBe(12750);
    expect(p.state).toBe("due");
  });

  test("solde à zéro quand le versement couvre ce qui reste après retenue", () => {
    // 12 750 payés sur 12 920 facturés, 170 retenus : il ne reste rien, et la
    // ligne doit QUITTER l'échéancier au lieu de crier 170 pour toujours.
    const p = payable(
      { invoiceTotal: 12920, paid: 12750, dueAt: "2026-09-01", withheld: 170 },
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(p.balance).toBe(0);
    expect(p.state).toBe("paid");
  });

  test("ne descend jamais sous zéro", () => {
    const p = payable(
      { invoiceTotal: 100, paid: 0, dueAt: null, withheld: 500 },
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(p.balance).toBe(0);
  });

  test("reste inconnu quand la facture n'est pas chiffrée, retenue ou pas", () => {
    // Retirer 170 de « on ne sait pas » donne « on ne sait pas », jamais −170.
    const p = payable(
      { invoiceTotal: null, paid: 0, dueAt: null, withheld: 170 },
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(p.balance).toBeNull();
    expect(p.state).toBe("unknown");
  });
});
