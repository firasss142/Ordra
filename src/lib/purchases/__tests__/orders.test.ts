import { describe, it, expect } from "vitest";
import {
  projectPurchaseOrder,
  outstandingByProduct,
  supplierReliability,
  type PurchaseOrderRow,
} from "../orders";

function order(over: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow {
  return {
    id: "po1",
    reference: "BC-LY-2026-0001",
    market_id: "m-ly",
    warehouse_id: "w-tripoli",
    warehouse_name: "Tripoli",
    supplier_id: "s1",
    supplier_name: "مكتبة الرسالة",
    status: "open",
    wanted_by: "2026-10-14",
    ordered_at: "2026-10-04T08:00:00Z",
    ordered_by_name: "Salma",
    closed_at: null,
    close_reason: null,
    note: null,
    lines: [
      {
        id: "l1",
        product_id: "p1",
        product_name: "مصحف التهجد",
        variant_id: null,
        variant_label: null,
        ordered_qty: 150,
        unit_cost: 85,
        received_qty: 0,
        first_received_at: null,
      },
    ],
    ...over,
  };
}

const TODAY = new Date("2026-10-20T10:00:00Z");

describe("projectPurchaseOrder — ce qui reste à venir", () => {
  it("compte le manque par ligne et pour le document", () => {
    const po = projectPurchaseOrder(order(), TODAY);
    expect(po.ordered_units).toBe(150);
    expect(po.received_units).toBe(0);
    expect(po.outstanding_units).toBe(150);
    expect(po.lines[0].outstanding_qty).toBe(150);
  });

  it("ne descend pas sous zéro sur une sur-livraison", () => {
    // 160 reçues sur 150 commandées n'est pas « −10 en route » : c'est zéro en
    // route et une sur-livraison, deux faits différents.
    const po = projectPurchaseOrder(
      order({ lines: [{ ...order().lines[0], received_qty: 160 }] }),
      TODAY,
    );
    expect(po.outstanding_units).toBe(0);
    expect(po.over_received_units).toBe(10);
  });

  it("dit qu'une commande ouverte a dépassé la date voulue", () => {
    const po = projectPurchaseOrder(order({ wanted_by: "2026-10-14" }), TODAY);
    expect(po.is_late).toBe(true);
    expect(po.days_late).toBe(6);
  });

  it("ne crie pas sur une commande sans date voulue", () => {
    // Inventer un retard contre une date que personne n'a posée ferait crier
    // une ligne saine — la même règle que `due_at` côté paiements.
    const po = projectPurchaseOrder(order({ wanted_by: null }), TODAY);
    expect(po.is_late).toBe(false);
    expect(po.days_late).toBeNull();
  });

  it("ne crie pas sur une commande clôturée en retard", () => {
    const po = projectPurchaseOrder(
      order({ status: "closed", closed_at: "2026-10-12T00:00:00Z" }),
      TODAY,
    );
    expect(po.is_late).toBe(false);
  });

  it("chiffre l'engagement, et se tait quand un prix manque", () => {
    const po = projectPurchaseOrder(order(), TODAY);
    expect(po.committed_value).toBe(12750);

    const unpriced = projectPurchaseOrder(
      order({ lines: [{ ...order().lines[0], unit_cost: null }] }),
      TODAY,
    );
    // `null` ET JAMAIS `0` : « on ne sait pas ce que ça coûte » n'est pas
    // « ça ne coûte rien ».
    expect(unpriced.committed_value).toBeNull();
  });
});

describe("outstandingByProduct — la définition de « en route »", () => {
  it("additionne le manque des commandes ouvertes, par produit", () => {
    const m = outstandingByProduct(
      [
        order({ lines: [{ ...order().lines[0], received_qty: 94 }] }),
        order({ id: "po2", lines: [{ ...order().lines[0], id: "l2", ordered_qty: 40 }] }),
      ],
      TODAY,
    );
    expect(m.get("p1")).toBe(96); // 56 + 40
  });

  it("ignore une commande clôturée ou annulée", () => {
    // Ce qu'on n'attend plus n'est pas en route. Le compter gonflerait la
    // couverture pour toujours — exactement le défaut de l'ancien `expected_qty`.
    const m = outstandingByProduct(
      [
        order({ status: "closed" }),
        order({ id: "po2", status: "cancelled" }),
      ],
      TODAY,
    );
    expect(m.size).toBe(0);
  });

  it("n'inscrit rien pour un produit entièrement servi", () => {
    const m = outstandingByProduct(
      [order({ lines: [{ ...order().lines[0], received_qty: 150 }] })],
      TODAY,
    );
    // Absent de la Map, pas à 0 : l'écran rend « — ».
    expect(m.has("p1")).toBe(false);
  });

  it("sépare les tailles, parce que c'est là que vit le stock", () => {
    const base = order().lines[0];
    const m = outstandingByProduct(
      [
        order({
          lines: [
            { ...base, id: "l1", variant_id: "v-s", ordered_qty: 50 },
            { ...base, id: "l2", variant_id: "v-m", ordered_qty: 70, received_qty: 70 },
          ],
        }),
      ],
      TODAY,
    );
    expect(m.get("p1")).toBe(50);
  });
});

describe("supplierReliability — trois chiffres, ou rien", () => {
  const closed = (over: Partial<PurchaseOrderRow>) =>
    order({ status: "closed", closed_at: "2026-10-15T00:00:00Z", ...over });

  it("mesure le taux de service sur les commandes terminées", () => {
    const r = supplierReliability(
      [
        closed({ lines: [{ ...order().lines[0], received_qty: 141 }] }),
        closed({ id: "po2", lines: [{ ...order().lines[0], id: "l2", received_qty: 150 }] }),
      ],
      TODAY,
    );
    expect(r.service_rate).toBeCloseTo(291 / 300, 5);
    expect(r.sample_orders).toBe(2);
  });

  it("ne note pas un fournisseur sur une commande encore ouverte", () => {
    // Une livraison courte est le cas NORMAL tant que la commande court : la
    // juger maintenant condamnerait tout fournisseur dont le camion roule.
    const r = supplierReliability([order()], TODAY);
    expect(r.service_rate).toBeNull();
    expect(r.sample_orders).toBe(0);
  });

  it("ne compte pas une commande annulée sans rien reçu", () => {
    const r = supplierReliability(
      [order({ status: "cancelled", closed_at: "2026-10-10T00:00:00Z" })],
      TODAY,
    );
    expect(r.service_rate).toBeNull();
  });

  it("mesure le délai de la commande au premier carton", () => {
    const r = supplierReliability(
      [
        closed({
          ordered_at: "2026-10-01T00:00:00Z",
          lines: [
            {
              ...order().lines[0],
              received_qty: 150,
              first_received_at: "2026-10-12T00:00:00Z",
            },
          ],
        }),
      ],
      TODAY,
    );
    expect(r.lead_time_days).toBe(11);
  });

  it("se tait sur le délai quand rien n'est jamais arrivé", () => {
    const r = supplierReliability(
      [closed({ lines: [{ ...order().lines[0], received_qty: 0 }] })],
      TODAY,
    );
    expect(r.lead_time_days).toBeNull();
  });
});
