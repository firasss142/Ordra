import { describe, it, expect } from "vitest";
import {
  reasonsForKind,
  kindForReason,
  ALL_LEDGER_REASONS,
} from "../history-reasons";

/**
 * Le Journal ne doit pas mentir par omission.
 *
 * LE BUG QUE CE FICHIER FIGE. `getWarehouseHistoryPage` listait quatre motifs
 * pour « Tout » — scanned, returned, damaged_writeoff, manual_adjustment — alors
 * que `inventory_log.reason` en autorise douze. `stock_count`, `received_back`,
 * `initial_stock`, `scan_reversal` et `manual_delete_reversal` étaient donc
 * INVISIBLES dans le Journal et dans son export CSV, y compris le stock
 * d'ouverture d'un produit.
 *
 * Un registre qui affiche « Tout » et en cache la moitié est pire qu'absent :
 * on s'en sert pour vérifier, et il confirme ce qu'on croit déjà.
 */

describe("ALL_LEDGER_REASONS", () => {
  it("couvre exactement le vocabulaire de la contrainte inventory_log_reason_check", () => {
    // Le même douze que la contrainte en base, `deposit` hérité compris.
    expect([...ALL_LEDGER_REASONS].sort()).toEqual(
      [
        "damaged_writeoff",
        "deposit",
        "initial_stock",
        "manual_adjustment",
        "manual_delete_reversal",
        "received_back",
        "reception",
        "reception_reversal",
        "returned",
        "scan_reversal",
        "scanned",
        "stock_count",
      ].sort(),
    );
  });
});

describe("reasonsForKind — « Tout » veut dire tout", () => {
  it("n'omet aucun motif du registre", () => {
    expect(new Set(reasonsForKind("all"))).toEqual(new Set(ALL_LEDGER_REASONS));
  });

  it("montre en particulier ceux qui étaient invisibles", () => {
    const all = reasonsForKind("all");
    for (const hidden of [
      "stock_count",
      "received_back",
      "initial_stock",
      "scan_reversal",
      "manual_delete_reversal",
    ]) {
      expect(all).toContain(hidden);
    }
  });

  it("inclut les deux motifs de réception", () => {
    expect(reasonsForKind("all")).toContain("reception");
    expect(reasonsForKind("all")).toContain("reception_reversal");
  });
});

describe("reasonsForKind — chaque famille", () => {
  it("scan = la sortie et son annulation", () => {
    expect(new Set(reasonsForKind("scan"))).toEqual(new Set(["scanned", "scan_reversal"]));
  });

  it("return = le retour, la casse et le renvoi", () => {
    expect(new Set(reasonsForKind("return"))).toEqual(
      new Set(["returned", "damaged_writeoff", "received_back"]),
    );
  });

  it("reception = la réception et sa contre-passation", () => {
    expect(new Set(reasonsForKind("reception"))).toEqual(
      new Set(["reception", "reception_reversal"]),
    );
  });

  it("count = le comptage physique, qui n'apparaissait nulle part", () => {
    expect(reasonsForKind("count")).toEqual(["stock_count"]);
  });

  it("adjust = la correction manuelle et le stock d'ouverture", () => {
    expect(new Set(reasonsForKind("adjust"))).toEqual(
      new Set(["manual_adjustment", "initial_stock", "manual_delete_reversal", "deposit"]),
    );
  });

  it("writeoff = la casse seule", () => {
    expect(reasonsForKind("writeoff")).toEqual(["damaged_writeoff"]);
  });

  it("ne rend aucun motif pour les familles qui ne lisent pas le registre", () => {
    expect(reasonsForKind("print")).toEqual([]);
    expect(reasonsForKind("handover")).toEqual([]);
  });
});

describe("reasonsForKind — aucune famille n'oublie un motif", () => {
  /*
   * Filet : l'union des familles qui lisent le registre doit recouvrir tout le
   * vocabulaire. Sans cela, ajouter un motif en base le rendrait invisible dans
   * chaque filtre — exactement comment le bug d'origine est né.
   */
  it("l'union des familles couvre tout le vocabulaire", () => {
    const union = new Set([
      ...reasonsForKind("scan"),
      ...reasonsForKind("return"),
      ...reasonsForKind("reception"),
      ...reasonsForKind("count"),
      ...reasonsForKind("adjust"),
    ]);
    expect(union).toEqual(new Set(ALL_LEDGER_REASONS));
  });
});

describe("kindForReason — chaque ligne sait à quelle famille elle appartient", () => {
  it("range les motifs de réception dans « reception »", () => {
    expect(kindForReason("reception")).toBe("reception");
    expect(kindForReason("reception_reversal")).toBe("reception");
  });

  it("range le comptage dans « count »", () => {
    expect(kindForReason("stock_count")).toBe("count");
  });

  it("range le renvoi au client avec les retours", () => {
    expect(kindForReason("received_back")).toBe("return");
  });

  it("range le stock d'ouverture avec les corrections", () => {
    expect(kindForReason("initial_stock")).toBe("adjust");
  });

  it("garde le classement d'origine pour les quatre motifs déjà visibles", () => {
    expect(kindForReason("scanned")).toBe("scan");
    expect(kindForReason("returned")).toBe("return");
    expect(kindForReason("damaged_writeoff")).toBe("writeoff");
    expect(kindForReason("manual_adjustment")).toBe("adjust");
  });

  it("classe tout motif du vocabulaire, sans exception", () => {
    for (const reason of ALL_LEDGER_REASONS) {
      expect(kindForReason(reason)).toBeTruthy();
    }
  });
});
