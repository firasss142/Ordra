import { describe, it, expect } from "vitest";
import {
  canViewReceptions,
  canRecordArrival,
  canSettleReception,
  canReverseReception,
  canSeeReceptionCosts,
  canManageReceptionPayments,
} from "./permissions";

/**
 * Qui fait quoi sur une réception.
 *
 * Le partage n'est pas décoratif : recevoir est le seul mouvement qui crée des
 * unités à partir de rien sans document en face, donc l'agent qui décharge
 * DÉCLARE et le manager VALIDE. Et le coût d'achat n'est pas une information
 * d'entrepôt : un agent compte des objets, il ne voit pas ce qu'ils ont coûté.
 */

const ROLES = [
  "super_admin",
  "market_manager",
  "agent",
  "warehouse_agent",
  "investor",
] as const;

describe("canViewReceptions", () => {
  it("ouvre l'écran à l'entrepôt et à l'encadrement, à personne d'autre", () => {
    expect(canViewReceptions("super_admin")).toBe(true);
    expect(canViewReceptions("market_manager")).toBe(true);
    expect(canViewReceptions("warehouse_agent")).toBe(true);
    expect(canViewReceptions("agent")).toBe(false);
    expect(canViewReceptions("investor")).toBe(false);
  });
});

describe("canRecordArrival", () => {
  it("laisse l'agent d'entrepôt enregistrer un arrivage — c'est le geste du quai", () => {
    expect(canRecordArrival("warehouse_agent")).toBe(true);
    expect(canRecordArrival("market_manager")).toBe(true);
    expect(canRecordArrival("super_admin")).toBe(true);
  });

  it("n'ouvre rien à un agent de confirmation ni à un investisseur", () => {
    expect(canRecordArrival("agent")).toBe(false);
    expect(canRecordArrival("investor")).toBe(false);
  });
});

describe("canSettleReception", () => {
  it("réserve le soldage au bureau : l'agent compte, il ne chiffre pas", () => {
    expect(canSettleReception("market_manager")).toBe(true);
    expect(canSettleReception("super_admin")).toBe(true);
  });

  it("refuse l'agent d'entrepôt, qui a pourtant pu compter", () => {
    expect(canRecordArrival("warehouse_agent")).toBe(true);
    expect(canSettleReception("warehouse_agent")).toBe(false);
  });

  it("refuse tout le reste", () => {
    expect(canSettleReception("agent")).toBe(false);
    expect(canSettleReception("investor")).toBe(false);
  });
});

describe("canReverseReception", () => {
  it("n'est ouvert qu'au super_admin : c'est une réécriture de l'histoire", () => {
    expect(canReverseReception("super_admin")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "super_admin")) {
      expect(canReverseReception(role)).toBe(false);
    }
  });
});

describe("canSeeReceptionCosts", () => {
  it("cache le prix d'achat à l'agent d'entrepôt", () => {
    expect(canSeeReceptionCosts("warehouse_agent")).toBe(false);
  });

  it("le montre à ceux qui arbitrent l'argent", () => {
    expect(canSeeReceptionCosts("market_manager")).toBe(true);
    expect(canSeeReceptionCosts("super_admin")).toBe(true);
  });

  it("ne le montre à personne d'autre", () => {
    expect(canSeeReceptionCosts("agent")).toBe(false);
    expect(canSeeReceptionCosts("investor")).toBe(false);
  });
});

describe("canManageReceptionPayments", () => {
  it("suit le droit de voir les coûts — un paiement EST une information d'argent", () => {
    for (const role of ROLES) {
      expect(canManageReceptionPayments(role)).toBe(canSeeReceptionCosts(role));
    }
  });
});
