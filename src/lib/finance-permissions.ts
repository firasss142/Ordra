import type { Role } from "@/types";

/**
 * Gate for the owner-only Finances pages: P&L, Stock & inventaire and Dépenses
 * pub, AND their market-level APIs (/api/finance/pnl, /api/finance/stock,
 * /api/ad-spend*). Super-admin only — matches the sidebar's visibility so the
 * page, sidebar, and API agree. Achats has its own gate (canUsePurchases).
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

/**
 * Gate for Finances › Achats (what the market owes its suppliers, purchase
 * orders, settling arrivals, payments, disputes): the page, its sidebar entry
 * and GET /api/finance/purchases. Owner decision (plans/finances-redesign.md):
 * the owner AND market managers — a manager only ever on their own market,
 * which the route takes from the actor, never from the request.
 */
export function canUsePurchases(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
