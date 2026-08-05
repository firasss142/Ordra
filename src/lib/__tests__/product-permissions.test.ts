import { describe, it, expect } from "vitest";
import {
  canManageProducts,
  canViewProducts,
  canAdjustStock,
  canToggleProductActive,
  canEditProductContent,
} from "@/lib/product-permissions";

describe("canEditProductContent", () => {
  it("super_admin can edit content cross-market", () => {
    expect(canEditProductContent("super_admin", "market-ly", "market-tn")).toBe(true);
  });

  it("market_manager can edit content in own market", () => {
    expect(canEditProductContent("market_manager", "market-tn", "market-tn")).toBe(true);
  });

  it("market_manager cannot edit content in another market", () => {
    expect(canEditProductContent("market_manager", "market-ly", "market-tn")).toBe(false);
  });

  it("agent cannot edit content even in own market", () => {
    expect(canEditProductContent("agent", "market-tn", "market-tn")).toBe(false);
  });

  it("warehouse_agent cannot edit content (they only toggle is_active)", () => {
    expect(canEditProductContent("warehouse_agent", "market-tn", "market-tn")).toBe(false);
  });

  it("investor cannot edit content", () => {
    expect(canEditProductContent("investor", "market-tn", "market-tn")).toBe(false);
  });

  it("is strictly weaker than canManageProducts for managers (content yes, costs no)", () => {
    expect(canEditProductContent("market_manager", "market-tn", "market-tn")).toBe(true);
    expect(canManageProducts("market_manager", "market-tn", "market-tn")).toBe(false);
  });
});

// Stock integrity lockdown: canManageProducts and canAdjustStock are SA-only.
// canViewProducts stays per-market. canToggleProductActive is carved out for
// super_admin, market_manager and warehouse_agent.

describe("canManageProducts", () => {
  it("super_admin can manage products in any market", () => {
    expect(canManageProducts("super_admin", "market-ly", "market-tn")).toBe(
      true
    );
  });

  it("super_admin can manage products in own market", () => {
    expect(canManageProducts("super_admin", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager cannot manage products even in own market", () => {
    expect(canManageProducts("market_manager", "market-tn", "market-tn")).toBe(
      false
    );
  });

  it("warehouse_agent cannot manage products", () => {
    expect(
      canManageProducts("warehouse_agent", "market-tn", "market-tn"),
    ).toBe(false);
  });

  it("agent cannot manage products", () => {
    expect(canManageProducts("agent", "market-tn", "market-tn")).toBe(false);
  });
});

describe("canViewProducts", () => {
  it("super_admin can view products in any market", () => {
    expect(canViewProducts("super_admin", "market-ly", "market-tn")).toBe(true);
  });

  it("super_admin can view products in own market", () => {
    expect(canViewProducts("super_admin", "market-tn", "market-tn")).toBe(true);
  });

  it("market_manager can view products in own market", () => {
    expect(canViewProducts("market_manager", "market-tn", "market-tn")).toBe(
      true
    );
  });

  it("market_manager cannot view products in another market", () => {
    expect(canViewProducts("market_manager", "market-ly", "market-tn")).toBe(
      false
    );
  });

  it("warehouse_agent can view products in own market", () => {
    expect(
      canViewProducts("warehouse_agent", "market-tn", "market-tn"),
    ).toBe(true);
  });

  it("warehouse_agent cannot view products in another market", () => {
    expect(
      canViewProducts("warehouse_agent", "market-ly", "market-tn"),
    ).toBe(false);
  });

  it("agent cannot view products — no access to catalog or financial data", () => {
    expect(canViewProducts("agent", "market-tn", "market-tn")).toBe(false);
  });
});

describe("canAdjustStock", () => {
  it("super_admin can adjust stock in any market", () => {
    expect(canAdjustStock("super_admin", "market-ly", "market-tn")).toBe(true);
  });

  it("super_admin can adjust stock in own market", () => {
    expect(canAdjustStock("super_admin", "market-tn", "market-tn")).toBe(true);
  });

  it("market_manager cannot adjust stock even in own market", () => {
    expect(canAdjustStock("market_manager", "market-tn", "market-tn")).toBe(
      false
    );
  });

  it("warehouse_agent cannot adjust stock", () => {
    expect(
      canAdjustStock("warehouse_agent", "market-tn", "market-tn"),
    ).toBe(false);
  });

  it("agent cannot adjust stock", () => {
    expect(canAdjustStock("agent", "market-tn", "market-tn")).toBe(false);
  });
});

describe("canToggleProductActive", () => {
  it("super_admin can toggle active", () => {
    expect(canToggleProductActive("super_admin")).toBe(true);
  });

  it("market_manager can toggle active", () => {
    expect(canToggleProductActive("market_manager")).toBe(true);
  });

  it("warehouse_agent can toggle active", () => {
    expect(canToggleProductActive("warehouse_agent")).toBe(true);
  });

  it("agent cannot toggle active", () => {
    expect(canToggleProductActive("agent")).toBe(false);
  });
});
