import { describe, it, expect } from "vitest";
import type { Role } from "@/types";
import {
  canViewSuppliers,
  canManageSuppliers,
  canViewPurchaseOrders,
  canPlacePurchaseOrder,
} from "../permissions";

const ROLES: Role[] = [
  "super_admin",
  "market_manager",
  "agent",
  "warehouse_agent",
  "investor",
];

describe("les fournisseurs", () => {
  it("se lisent par les trois rôles d'entrepôt", () => {
    expect(ROLES.filter(canViewSuppliers)).toEqual([
      "super_admin",
      "market_manager",
      "warehouse_agent",
    ]);
  });

  it("ne s'écrivent qu'au bureau", () => {
    expect(ROLES.filter(canManageSuppliers)).toEqual(["super_admin", "market_manager"]);
  });
});

describe("les bons de commande", () => {
  /*
   * LE QUAI NE LIT PAS L'ATTENDU. C'est la règle du comptage à l'aveugle, et
   * elle est portée par la RLS de `20261004120000_purchase_orders.sql` :
   * `purchase_orders` n'a AUCUNE politique pour `warehouse_agent`. Ces deux
   * fonctions répliquent cette RLS — si l'une change, l'autre change avec elle.
   */
  it("ne se lisent pas depuis le quai", () => {
    expect(canViewPurchaseOrders("warehouse_agent")).toBe(false);
    expect(ROLES.filter(canViewPurchaseOrders)).toEqual(["super_admin", "market_manager"]);
  });

  it("ne se passent qu'au bureau", () => {
    // Commander engage la trésorerie ; l'agent du quai ne voit même pas les prix.
    expect(ROLES.filter(canPlacePurchaseOrder)).toEqual(["super_admin", "market_manager"]);
  });
});
