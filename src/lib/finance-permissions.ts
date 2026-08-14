import type { Role } from "@/types";

/**
 * Gate for the FINANCES section: the P&L, stock-inventory, and ad-spend pages
 * AND their market-level APIs (/api/profitability, /api/ad-spend*,
 * /api/inventory/position). Super-admin only — matches the sidebar's
 * canViewFinances visibility so the page, sidebar, and API agree.
 */
export function canViewFinanceSection(role: Role): boolean {
  return role === "super_admin";
}

/**
 * Gate for PRODUCT-level profitability analytics (/api/products/profitability-bulk,
 * /api/profitability/product/[id], the products page Performance mode).
 * Market managers see their own market's product margins; the market-wide
 * P&L stays super-admin only via canViewFinanceSection.
 */
export function canViewProductProfitability(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
