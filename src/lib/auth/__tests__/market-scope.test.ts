import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthUser } from "@/types";
import { TN_MARKET_ID, LY_MARKET_ID } from "@/lib/markets";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mockGet }),
}));

import { getActiveMarketScope, SCOPE_COOKIE } from "@/lib/auth/market-scope";

const superAdmin: AuthUser = {
  id: "u1",
  email: "admin@oms.local",
  full_name: "Admin",
  avatar_url: null,
  role: "super_admin",
  market_id: null,
  locale: "fr",
  direction: "ltr",
};

const tnManager: AuthUser = {
  ...superAdmin,
  id: "u2",
  email: "manager.tn@oms.local",
  role: "market_manager",
  market_id: TN_MARKET_ID,
};

const lyManager: AuthUser = {
  ...superAdmin,
  id: "u3",
  email: "manager.ly@oms.local",
  role: "market_manager",
  market_id: LY_MARKET_ID,
};

beforeEach(() => {
  mockGet.mockReset();
});

describe("getActiveMarketScope", () => {
  it("super_admin with no cookie defaults to TN", async () => {
    mockGet.mockReturnValue(undefined);
    const scope = await getActiveMarketScope(superAdmin);
    expect(scope.scope).toBe("tn");
    expect(scope.marketId).toBe(TN_MARKET_ID);
  });

  it("super_admin with cookie=ly returns Libya scope", async () => {
    mockGet.mockReturnValue({ value: "ly" });
    const scope = await getActiveMarketScope(superAdmin);
    expect(scope.scope).toBe("ly");
    expect(scope.marketId).toBe(LY_MARKET_ID);
  });

  it("super_admin with cookie=tn returns Tunisia scope", async () => {
    mockGet.mockReturnValue({ value: "tn" });
    const scope = await getActiveMarketScope(superAdmin);
    expect(scope.scope).toBe("tn");
    expect(scope.marketId).toBe(TN_MARKET_ID);
  });

  it("super_admin with cookie=all returns null marketId", async () => {
    mockGet.mockReturnValue({ value: "all" });
    const scope = await getActiveMarketScope(superAdmin);
    expect(scope.scope).toBe("all");
    expect(scope.marketId).toBeNull();
  });

  it("super_admin with invalid cookie value falls back to TN default", async () => {
    mockGet.mockReturnValue({ value: "xx" });
    const scope = await getActiveMarketScope(superAdmin);
    expect(scope.scope).toBe("tn");
    expect(scope.marketId).toBe(TN_MARKET_ID);
  });

  it("market_manager ignores cookie, returns their pinned scope", async () => {
    mockGet.mockReturnValue({ value: "ly" });
    const scope = await getActiveMarketScope(tnManager);
    expect(scope.scope).toBe("tn");
    expect(scope.marketId).toBe(TN_MARKET_ID);
  });

  it("market_manager from LY ignores TN cookie attempt", async () => {
    mockGet.mockReturnValue({ value: "tn" });
    const scope = await getActiveMarketScope(lyManager);
    expect(scope.scope).toBe("ly");
    expect(scope.marketId).toBe(LY_MARKET_ID);
  });

  it("exposes the cookie name as a constant", () => {
    expect(SCOPE_COOKIE).toBe("oms_scope_market");
  });
});
