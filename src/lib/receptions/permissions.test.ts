import { describe, it, expect } from "vitest";
import {
  canViewReceptions,
  canDraftReception,
  canPostReception,
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

describe("canDraftReception", () => {
  it("laisse l'agent d'entrepôt déclarer ce qu'il a compté", () => {
    expect(canDraftReception("warehouse_agent")).toBe(true);
    expect(canDraftReception("market_manager")).toBe(true);
    expect(canDraftReception("super_admin")).toBe(true);
  });

  it("n'ouvre rien à un agent de confirmation ni à un investisseur", () => {
    expect(canDraftReception("agent")).toBe(false);
    expect(canDraftReception("investor")).toBe(false);
  });
});

describe("canPostReception", () => {
  it("réserve la validation à l'encadrement — c'est la séparation des tâches", () => {
    expect(canPostReception("market_manager")).toBe(true);
    expect(canPostReception("super_admin")).toBe(true);
  });

  it("refuse l'agent d'entrepôt, qui a pourtant pu déclarer", () => {
    expect(canDraftReception("warehouse_agent")).toBe(true);
    expect(canPostReception("warehouse_agent")).toBe(false);
  });

  it("refuse tout le reste", () => {
    expect(canPostReception("agent")).toBe(false);
    expect(canPostReception("investor")).toBe(false);
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
