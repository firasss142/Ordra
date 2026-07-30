import { describe, it, expect } from "vitest";
import {
  canAccess,
  canEditCosts,
  canManageProducts,
  canPrintLabels,
  canScanWarehouse,
} from "@/lib/role-permissions";

// Routes in the system
const DASHBOARD_ROUTES = [
  "/orders",
  "/unassigned",
  "/products",
  "/team",
  "/carriers",
  "/settings",
] as const;

const AGENT_ROUTES = ["/queue"] as const;

describe("canAccess — super_admin", () => {
  it("can access all dashboard routes", () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(canAccess("super_admin", route)).toBe(true);
    }
  });

  it("can access the agent queue route", () => {
    expect(canAccess("super_admin", "/queue")).toBe(true);
  });
});

describe("canAccess — market_manager", () => {
  it("can access /orders", () => {
    expect(canAccess("market_manager", "/orders")).toBe(true);
  });

  it("can access /unassigned", () => {
    expect(canAccess("market_manager", "/unassigned")).toBe(true);
  });

  it("can access /products", () => {
    expect(canAccess("market_manager", "/products")).toBe(true);
  });

  it("can access /team", () => {
    expect(canAccess("market_manager", "/team")).toBe(true);
  });

  it("can access /carriers", () => {
    expect(canAccess("market_manager", "/carriers")).toBe(true);
  });

  it("can access /settings", () => {
    expect(canAccess("market_manager", "/settings")).toBe(true);
  });

  it("cannot access /queue (agent-only)", () => {
    expect(canAccess("market_manager", "/queue")).toBe(false);
  });
});

describe("canAccess — /leads (CRM)", () => {
  it("super_admin can access /leads", () => {
    expect(canAccess("super_admin", "/leads")).toBe(true);
  });
  it("market_manager can access /leads", () => {
    expect(canAccess("market_manager", "/leads")).toBe(true);
  });
  it("agent can access /leads", () => {
    expect(canAccess("agent", "/leads")).toBe(true);
  });
});

describe("canAccess — agent", () => {
  it("can access /queue", () => {
    expect(canAccess("agent", "/queue")).toBe(true);
  });

  it("cannot access /orders", () => {
    expect(canAccess("agent", "/orders")).toBe(false);
  });

  it("cannot access /unassigned", () => {
    expect(canAccess("agent", "/unassigned")).toBe(false);
  });

  it("cannot access /products", () => {
    expect(canAccess("agent", "/products")).toBe(false);
  });

  it("cannot access /team", () => {
    expect(canAccess("agent", "/team")).toBe(false);
  });

  it("cannot access /carriers", () => {
    expect(canAccess("agent", "/carriers")).toBe(false);
  });

  it("cannot access /settings", () => {
    expect(canAccess("agent", "/settings")).toBe(false);
  });
});

describe("canAccess — warehouse_agent", () => {
  it("can access /warehouse", () => {
    expect(canAccess("warehouse_agent", "/warehouse")).toBe(true);
  });

  it("cannot access /orders", () => {
    expect(canAccess("warehouse_agent", "/orders")).toBe(false);
  });

  it("cannot access /queue", () => {
    expect(canAccess("warehouse_agent", "/queue")).toBe(false);
  });

  it("cannot access /dashboard", () => {
    expect(canAccess("warehouse_agent", "/dashboard")).toBe(false);
  });
});

// ─── investor ────────────────────────────────────────────────────────────────
// External users. Their allow-list is exactly one route; everything else in the
// OMS — orders, products, team, settings, the warehouse — must stay closed.

describe("canAccess — investor", () => {
  it("can access /investor", () => {
    expect(canAccess("investor", "/investor")).toBe(true);
  });

  it("cannot access any staff route", () => {
    const STAFF_ROUTES = [
      "/orders",
      "/unassigned",
      "/products",
      "/team",
      "/users",
      "/carriers",
      "/settings",
      "/queue",
      "/leads",
      "/warehouse",
    ] as const;

    for (const route of STAFF_ROUTES) {
      expect(canAccess("investor", route)).toBe(false);
    }
  });

  it("cannot edit costs, manage products, print labels or scan", () => {
    expect(canEditCosts("investor")).toBe(false);
    expect(canManageProducts("investor")).toBe(false);
    expect(canPrintLabels("investor")).toBe(false);
    expect(canScanWarehouse("investor")).toBe(false);
  });
});

describe("canAccess — unknown role", () => {
  it("denies instead of throwing", () => {
    // PERMISSIONS[role].includes() threw a TypeError for any role missing from
    // the map, which crashed middleware for every request by that user.
    expect(() =>
      canAccess("not_a_real_role" as Parameters<typeof canAccess>[0], "/orders")
    ).not.toThrow();
    expect(
      canAccess("not_a_real_role" as Parameters<typeof canAccess>[0], "/orders")
    ).toBe(false);
  });
});
