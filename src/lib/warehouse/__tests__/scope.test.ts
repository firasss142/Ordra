import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";
import { SCOPE_COOKIE } from "@/lib/auth/market-scope";
import { resolveWarehouseScope } from "../scope";

function req(path: string, cookie?: string) {
  const r = new NextRequest(new URL(path, "http://localhost"));
  if (cookie !== undefined) r.cookies.set(SCOPE_COOKIE, cookie);
  return r;
}
const superAdmin = { role: "super_admin", market_id: null };

/*
 * The warehouse APIs and the warehouse PAGES must name the same market, or a screen paints one
 * market's figures from the server and then swaps in another's from SWR. With no cookie the
 * pages (getActiveMarketScope) and the topbar say Tunisia; the APIs used to say « every market »
 * — Aujourd'hui showed 81 parcels, then 141 and Libya's Darb returns under « Tunisie » (2026-10-08).
 */
describe("resolveWarehouseScope", () => {
  it("a super-admin with no scope cookie gets the topbar's default market, Tunisia — not every market", () => {
    expect(resolveWarehouseScope(req("/api/warehouse/today"), superAdmin)).toMatchObject({ marketId: TN_MARKET_ID, marketCode: "tn" });
  });

  it("a super-admin who chose « all » gets every market", () => {
    expect(resolveWarehouseScope(req("/api/warehouse/today", "all"), superAdmin)).toMatchObject({ marketId: null, marketCode: null });
  });

  it("a super-admin follows the cookie, and an explicit ?market_id beats it", () => {
    expect(resolveWarehouseScope(req("/api/warehouse/today", "ly"), superAdmin).marketId).toBe(LY_MARKET_ID);
    expect(resolveWarehouseScope(req(`/api/warehouse/today?market_id=${TN_MARKET_ID}`, "ly"), superAdmin).marketId).toBe(TN_MARKET_ID);
  });

  it("anyone else stays in their own market whatever the cookie says", () => {
    expect(resolveWarehouseScope(req("/api/warehouse/today", "tn"), { role: "warehouse_agent", market_id: LY_MARKET_ID }).marketId).toBe(LY_MARKET_ID);
  });
});
