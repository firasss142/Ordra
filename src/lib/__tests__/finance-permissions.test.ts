import { describe, it, expect } from "vitest";
import {
  canViewFinanceSection,
  canViewProductProfitability,
} from "@/lib/finance-permissions";

describe("canViewFinanceSection (market-level finance: P&L, stock, ad-spend)", () => {
  it("allows super_admin only", () => {
    expect(canViewFinanceSection("super_admin")).toBe(true);
    expect(canViewFinanceSection("market_manager")).toBe(false);
    expect(canViewFinanceSection("agent")).toBe(false);
    expect(canViewFinanceSection("warehouse_agent")).toBe(false);
  });
});

describe("canViewProductProfitability (product-level margin analytics)", () => {
  it("allows super_admin and market_manager", () => {
    expect(canViewProductProfitability("super_admin")).toBe(true);
    expect(canViewProductProfitability("market_manager")).toBe(true);
    expect(canViewProductProfitability("agent")).toBe(false);
    expect(canViewProductProfitability("warehouse_agent")).toBe(false);
  });
});
