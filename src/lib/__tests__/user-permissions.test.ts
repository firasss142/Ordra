import { describe, it, expect } from "vitest";
import { getPermissionsForRole } from "../user-permissions";

describe("getPermissionsForRole", () => {
  it("returns exactly 8 items for every role", () => {
    const roles = ["super_admin", "market_manager", "agent", "warehouse_agent"] as const;
    for (const role of roles) {
      expect(getPermissionsForRole(role)).toHaveLength(8);
    }
  });

  it("super_admin has all permissions allowed", () => {
    const items = getPermissionsForRole("super_admin");
    expect(items.every((i) => i.allowed)).toBe(true);
  });

  it("agent: canConfirmOrders=true, canViewFinances=false, canManageAgents=false", () => {
    const items = getPermissionsForRole("agent");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canConfirmOrders").allowed).toBe(true);
    expect(find("canViewFinances").allowed).toBe(false);
    expect(find("canManageAgents").allowed).toBe(false);
  });

  it("agent: canViewAllOrders=false, canManageProducts=false, canInviteUsers=false", () => {
    const items = getPermissionsForRole("agent");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canViewAllOrders").allowed).toBe(false);
    expect(find("canManageProducts").allowed).toBe(false);
    expect(find("canInviteUsers").allowed).toBe(false);
  });

  it("market_manager: canManageAgents=true, canViewFinances=false, canInviteUsers=true", () => {
    const items = getPermissionsForRole("market_manager");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canManageAgents").allowed).toBe(true);
    expect(find("canViewFinances").allowed).toBe(false);
    expect(find("canInviteUsers").allowed).toBe(true);
  });

  it("market_manager: canConfirmOrders=false, canViewAllOrders=true", () => {
    const items = getPermissionsForRole("market_manager");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canConfirmOrders").allowed).toBe(false);
    expect(find("canViewAllOrders").allowed).toBe(true);
  });

  it("warehouse_agent: canScanWarehouse=true, canConfirmOrders=false", () => {
    const items = getPermissionsForRole("warehouse_agent");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canScanWarehouse").allowed).toBe(true);
    expect(find("canConfirmOrders").allowed).toBe(false);
  });

  it("warehouse_agent: canManageAgents=false, canViewFinances=false, canInviteUsers=false", () => {
    const items = getPermissionsForRole("warehouse_agent");
    const find = (key: string) => items.find((i) => i.key === key)!;
    expect(find("canManageAgents").allowed).toBe(false);
    expect(find("canViewFinances").allowed).toBe(false);
    expect(find("canInviteUsers").allowed).toBe(false);
  });

  it("all items have non-empty key strings", () => {
    const roles = ["super_admin", "market_manager", "agent", "warehouse_agent"] as const;
    for (const role of roles) {
      for (const item of getPermissionsForRole(role)) {
        expect(typeof item.key).toBe("string");
        expect(item.key.length).toBeGreaterThan(0);
      }
    }
  });
});
