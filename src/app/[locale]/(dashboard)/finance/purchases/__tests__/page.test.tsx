import { describe, test, expect, vi, beforeEach } from "vitest";
import type { AuthUser } from "@/types";

const user = vi.hoisted(() => ({ current: null as AuthUser | null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/server-user", () => ({ getServerUser: async () => user.current }));
vi.mock("@/lib/auth/market-scope", () => ({
  getActiveMarketScope: async (u: AuthUser) => ({ marketId: u.role === "super_admin" ? "00000000-0000-0000-0000-000000000001" : u.market_id }),
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/components/finance/purchases/PurchasesPage", () => ({ PurchasesPage: () => null }));

import PurchasesRoute from "../page";

const LY = "00000000-0000-0000-0000-000000000002";
const as = (role: AuthUser["role"], market_id: string | null = LY): AuthUser => ({
  id: "u", email: "u@oms.local", full_name: "U", avatar_url: null, role, market_id, locale: "fr", direction: "ltr",
});
const run = () => PurchasesRoute({ params: { locale: "fr" } });

beforeEach(() => {
  user.current = null;
});

describe("Finances › Achats — who opens the page", () => {
  test("a market manager does, on their own market", async () => {
    user.current = as("market_manager");
    const el = (await run()) as { props: { marketId: string; marketName: string } };
    expect(el.props.marketId).toBe(LY);
    expect(el.props.marketName).toBe("markets.ly");
  });

  test("the owner does, on the market chosen in the switcher", async () => {
    user.current = as("super_admin", null);
    const el = (await run()) as { props: { marketId: string } };
    expect(el.props.marketId).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("a warehouse agent, an agent and an investor do not", async () => {
    user.current = as("warehouse_agent");
    await expect(run()).rejects.toThrow("REDIRECT /fr/queue");
    user.current = as("agent");
    await expect(run()).rejects.toThrow("REDIRECT /fr/queue");
    user.current = as("investor");
    await expect(run()).rejects.toThrow("REDIRECT /fr/dashboard");
  });

  test("nobody signed in goes to the login", async () => {
    await expect(run()).rejects.toThrow("REDIRECT /fr/login");
  });
});
