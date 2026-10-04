import { describe, it, expect } from "vitest";
import { projectReception, projectReceptionList, type RawReception } from "./project";

/**
 * Ce que l'API laisse sortir, selon qui demande.
 *
 * LE POINT CENTRAL : les colonnes de coût sont retirées CÔTÉ SERVEUR pour un
 * agent d'entrepôt, pas masquées en CSS. En production `products.unit_cogs` est
 * accordé à `authenticated` malgré ce qu'affirme la doc, donc un agent qui
 * ouvre l'onglet réseau verrait les prix d'achat si on se contentait de les
 * cacher à l'écran. « Caché » n'est pas « absent ».
 */

const RAW: RawReception = {
  id: "r1",
  market_id: "m-ly",
  warehouse_id: "w-tripoli",
  reference: "REC-LY-2026-0042",
  supplier_name: "مكتبة الرسالة",
  supplier_ref: "BL-4471",
  status: "open",
  expected_at: "2026-09-28",
  note: null,
  photo_url: null,
  arrival_date: "2026-09-28",
  settled_at: "2026-09-28T09:00:00Z",
  settled_by: null,
  supplier_id: null,
  invoice_total: null,
  due_at: null,
  discrepancy_reason: null,
  fee_basis: "value",
  reception_costs: [],
  reverses_reception_id: null,
  created_at: "2026-09-27T08:00:00Z",
  warehouse: { code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" },
  counted_by_user: { full_name: "Adel Ben Salah" },
  settled_by_user: null,
  supplier: null,
  reception_lines: [
    {
      id: "l1",
      product_id: "p1",
      variant_id: null,
      ordered_qty: 150,
      received_qty: 150,
      damaged_qty: 0,
      unit_cost: 40,
      note: null,
      product: { name: "القرآن تدبر وعمل", sku: "qr-01", image_url: null, current_stock: 943, unit_cogs: 40 },
      variant: null,
    },
    {
      id: "l2",
      product_id: "p2",
      variant_id: null,
      ordered_qty: 100,
      received_qty: 94,
      damaged_qty: 2,
      unit_cost: 85,
      note: null,
      product: { name: "مصحف التهجد", sku: "th-01", image_url: null, current_stock: 218, unit_cogs: 85 },
      variant: null,
    },
  ],
  reception_payments: [
    { id: "pay1", paid_at: "2026-09-24", amount: 7488, method: "bank_transfer", note: "acompte" },
  ],
};

describe("projectReception — agent d'entrepôt", () => {
  const out = projectReception(RAW, "warehouse_agent");

  it("ne laisse fuir AUCUN coût unitaire", () => {
    for (const line of out.lines) {
      expect(line).not.toHaveProperty("unit_cost");
      expect(line).not.toHaveProperty("line_value");
    }
    expect(JSON.stringify(out)).not.toContain("40");
  });

  it("ne laisse fuir ni valeur totale ni paiements", () => {
    expect(out.totals.value).toBeNull();
    expect(out.payments).toEqual([]);
    expect(out.payment_state).toBeNull();
    expect(out.paid_total).toBeNull();
    expect(out.outstanding).toBeNull();
  });

  it("garde tout ce dont il a besoin pour compter", () => {
    expect(out.reference).toBe("REC-LY-2026-0042");
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].ordered_qty).toBe(150);
    expect(out.lines[0].received_qty).toBe(150);
    expect(out.lines[1].damaged_qty).toBe(2);
    expect(out.totals.units).toBe(244);
    expect(out.totals.damaged).toBe(2);
  });

  it("garde l'écart, qui est une information d'entrepôt", () => {
    expect(out.lines[0].variance).toBe(0);
    expect(out.lines[1].variance).toBe(-6);
  });

  it("ne peut pas valider", () => {
    expect(out.can.settle).toBe(false);
  });

  it("peut compter tant que le groupe est ouvert", () => {
    expect(out.can.recordArrival).toBe(true);
  });

  /*
   * UNE FOIS SOLDÉE, PLUS RIEN NE BOUGE. Le coût de revient est écrit dans
   * `landed_unit_cost` et a pu nourrir `unit_cogs` : rouvrir le comptage ferait
   * mentir le registre.
   */
  it("ne compte plus sur une réception soldée", () => {
    const settled = projectReception({ ...RAW, status: "settled" }, "warehouse_agent");
    expect(settled.can.recordArrival).toBe(false);
    expect(settled.can.settle).toBe(false);
  });
});

describe("projectReception — manager", () => {
  const out = projectReception(RAW, "market_manager");

  it("voit les coûts et la valeur", () => {
    expect(out.lines[0].unit_cost).toBe(40);
    expect(out.lines[0].line_value).toBeCloseTo(6000, 3);
    // 150×40 + 94×85 = 6000 + 7990
    expect(out.totals.value).toBeCloseTo(13990, 3);
  });

  it("voit les paiements et ce qui reste dû", () => {
    expect(out.payments).toHaveLength(1);
    expect(out.paid_total).toBeCloseTo(7488, 3);
    expect(out.payment_state).toBe("partial");
    expect(out.outstanding).toBeCloseTo(6502, 3);
  });

  it("voit le coût actuel et la moyenne pondérée qu'il adopterait", () => {
    // p1 : 943 unités à 40,000, on reçoit 150 à 40,000 → inchangé
    expect(out.lines[0].cogs_current).toBe(40);
    expect(out.lines[0].cogs_next).toBe(40);
  });

  it("peut valider", () => {
    expect(out.can.settle).toBe(true);
    expect(out.can.reverse).toBe(false);
  });
});

describe("projectReception — super_admin", () => {
  it("peut contre-passer, mais seulement une réception validée", () => {
    expect(projectReception(RAW, "super_admin").can.reverse).toBe(false);
    const posted = { ...RAW, status: "settled" as const };
    expect(projectReception(posted, "super_admin").can.reverse).toBe(true);
  });

  it("ne peut plus valider une réception déjà validée", () => {
    const posted = { ...RAW, status: "settled" as const };
    expect(projectReception(posted, "super_admin").can.settle).toBe(false);
  });
});

describe("projectReception — l'honnêteté des chiffres", () => {
  it("rend une valeur nulle quand aucune ligne n'est chiffrée", () => {
    const noCost = {
      ...RAW,
      reception_lines: RAW.reception_lines.map((l) => ({ ...l, unit_cost: null })),
    };
    expect(projectReception(noCost, "market_manager").totals.value).toBeNull();
  });

  it("rend un écart nul, pas zéro, quand rien n'était commandé", () => {
    /*
     * L'ÉCART SE MESURE CONTRE NOTRE PROPRE PLAN — le bon de commande — et
     * contre rien d'autre. `reception_lines.expected_qty` ne l'a jamais porté
     * et ne le portera jamais : personne n'écrit un attendu dans un formulaire
     * vide. Sans commande il n'y a pas de plan, donc pas d'écart : `null`, et
     * surtout pas « −150 », qui serait un reproche inventé.
     */
    const surprise = {
      ...RAW,
      reception_lines: [{ ...RAW.reception_lines[0], ordered_qty: null }],
    };
    expect(projectReception(surprise, "market_manager").lines[0].variance).toBeNull();
  });

  it("marque « en retard » un groupe ouvert depuis la veille", () => {
    // « En retard » ne se mesure plus contre une date ANNONCÉE — personne
    // n'annonce une réception — mais contre le jour de l'arrivage : de la
    // marchandise vendable dont la marge reste inconnue.
    const late = { ...RAW, status: "open" as const, arrival_date: "2026-09-01" };
    const out = projectReception(late, "market_manager", new Date("2026-09-30T10:00:00Z"));
    expect(out.is_late).toBe(true);
    expect(out.days_late).toBe(29);
  });

  it("ne marque jamais « en retard » une réception soldée", () => {
    const posted = { ...RAW, status: "settled" as const, arrival_date: "2026-09-01" };
    const out = projectReception(posted, "market_manager", new Date("2026-09-30T10:00:00Z"));
    expect(out.is_late).toBe(false);
    expect(out.days_late).toBeNull();
  });
});

describe("projectReceptionList", () => {
  it("projette chaque ligne avec les mêmes règles de rôle", () => {
    const rows = projectReceptionList([RAW], "warehouse_agent");
    expect(rows).toHaveLength(1);
    expect(rows[0].totals.value).toBeNull();
    expect(rows[0].payment_state).toBeNull();
  });

  it("compte les segments sans inventer de total", () => {
    const list = projectReceptionList(
      [RAW, { ...RAW, id: "r2", status: "settled" }, { ...RAW, id: "r3", status: "open" }],
      "market_manager",
    );
    expect(list).toHaveLength(3);
    expect(list.filter((r) => r.status === "open")).toHaveLength(2);
    expect(list.filter((r) => r.status === "settled")).toHaveLength(1);
  });
});
