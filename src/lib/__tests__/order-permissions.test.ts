import { describe, it, expect } from "vitest";
import {
  canViewOrders,
  canAssignOrders,
  canCancelOrder,
  canManuallyDeleteOrderStatus,
} from "@/lib/order-permissions";

describe("canViewOrders", () => {
  describe("super_admin", () => {
    it("can view orders in any market", () => {
      expect(canViewOrders("super_admin", "market-tn", "market-ly")).toBe(true);
    });

    it("can view orders in own market", () => {
      expect(canViewOrders("super_admin", "market-tn", "market-tn")).toBe(true);
    });
  });

  describe("market_manager", () => {
    it("can view orders in own market", () => {
      expect(canViewOrders("market_manager", "market-tn", "market-tn")).toBe(true);
    });

    it("cannot view orders in another market", () => {
      expect(canViewOrders("market_manager", "market-ly", "market-tn")).toBe(false);
    });
  });

  describe("agent", () => {
    it("can view orders in own market", () => {
      expect(canViewOrders("agent", "market-tn", "market-tn")).toBe(true);
    });

    it("cannot view orders in another market", () => {
      expect(canViewOrders("agent", "market-ly", "market-tn")).toBe(false);
    });
  });
});

describe("canAssignOrders", () => {
  describe("super_admin", () => {
    it("can assign orders in any market", () => {
      expect(canAssignOrders("super_admin", "market-tn", "market-ly")).toBe(true);
    });

    it("can assign orders in own market", () => {
      expect(canAssignOrders("super_admin", "market-tn", "market-tn")).toBe(true);
    });
  });

  describe("market_manager", () => {
    it("can assign orders in own market", () => {
      expect(canAssignOrders("market_manager", "market-tn", "market-tn")).toBe(true);
    });

    it("cannot assign orders in another market", () => {
      expect(canAssignOrders("market_manager", "market-ly", "market-tn")).toBe(false);
    });
  });

  describe("agent", () => {
    it("cannot assign orders in own market — agents never assign", () => {
      expect(canAssignOrders("agent", "market-tn", "market-tn")).toBe(false);
    });

    it("cannot assign orders in any market", () => {
      expect(canAssignOrders("agent", "market-ly", "market-tn")).toBe(false);
    });
  });
});

describe("canCancelOrder", () => {
  describe("super_admin", () => {
    it("can cancel orders in any market", () => {
      expect(canCancelOrder("super_admin", "market-tn", "market-ly")).toBe(true);
    });

    it("can cancel orders in own market", () => {
      expect(canCancelOrder("super_admin", "market-tn", "market-tn")).toBe(true);
    });
  });

  describe("market_manager", () => {
    it("can cancel orders in own market", () => {
      expect(canCancelOrder("market_manager", "market-tn", "market-tn")).toBe(true);
    });

    it("cannot cancel orders in another market", () => {
      expect(canCancelOrder("market_manager", "market-ly", "market-tn")).toBe(false);
    });
  });

  describe("agent", () => {
    it("cannot cancel orders — agents have no cancel permission", () => {
      expect(canCancelOrder("agent", "market-tn", "market-tn")).toBe(false);
    });

    it("cannot cancel orders in any market", () => {
      expect(canCancelOrder("agent", "market-ly", "market-tn")).toBe(false);
    });
  });
});

describe("canManuallyDeleteOrderStatus", () => {
  it("allows pre-dispatch manual delete statuses and blocks fulfillment/terminal statuses", () => {
    expect(canManuallyDeleteOrderStatus("pending")).toBe(true);
    expect(canManuallyDeleteOrderStatus("dispatch_scheduled")).toBe(true);
    expect(canManuallyDeleteOrderStatus("uploaded")).toBe(true);
    expect(canManuallyDeleteOrderStatus("scanned")).toBe(true);
    expect(canManuallyDeleteOrderStatus("in_transit")).toBe(false);
    expect(canManuallyDeleteOrderStatus("received")).toBe(false);
    expect(canManuallyDeleteOrderStatus("cancelled")).toBe(false);
  });
});

