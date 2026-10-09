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
  getActiveMarketScope: async (u: AuthUser) => ({ marketId: u.market_id }),
}));
vi.mock("@/lib/markets/list", () => ({
  getAllActiveMarkets: async () => [],
  getDefaultMarketId: () => null,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/components/to-ship/ToShipCockpit", () => ({ ToShipCockpit: () => null }));

import DispatchPage from "../page";

const as = (role: AuthUser["role"], market_id: string | null = null): AuthUser => ({
  id: "u", email: "u@oms.local", full_name: "U", avatar_url: null, role, market_id, locale: "fr", direction: "ltr",
});
const run = () => DispatchPage({ params: Promise.resolve({ locale: "fr" }) });

beforeEach(() => {
  user.current = null;
});

describe("Entrepôt › À expédier (bulk upload cockpit) — who opens the page", () => {
  // The cockpit uploads whole batches to a carrier. It is a manager tool: a
  // warehouse agent reached it by URL and could book a market's parcels.
  test("a warehouse agent is sent back to the bench", async () => {
    user.current = as("warehouse_agent", "ly");
    await expect(run()).rejects.toThrow("REDIRECT /fr/warehouse");
  });

  test("an agent goes to their queue", async () => {
    user.current = as("agent", "ly");
    await expect(run()).rejects.toThrow("REDIRECT /fr/queue");
  });

  test("a market manager and the owner do open it", async () => {
    user.current = as("market_manager");
    await expect(run()).resolves.toBeTruthy();
    user.current = as("super_admin");
    await expect(run()).resolves.toBeTruthy();
  });

  test("nobody signed in goes to the login", async () => {
    await expect(run()).rejects.toThrow("REDIRECT /fr/login");
  });
});
