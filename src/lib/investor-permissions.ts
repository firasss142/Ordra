import type { Role } from "@/types";

/**
 * Investor domain permissions.
 *
 * Mirrors the other per-domain permission modules (finance-, order-,
 * product-permissions). Each helper is an explicit allow-list so an unknown or
 * future role denies by default.
 *
 * These are applied in BOTH the page guard and the API route, matching the
 * deliberate duplication noted in finance-permissions.ts — the page check keeps
 * a role out of the UI, the route check keeps them out of the data.
 */

/** Can read their own portfolio. Investors only — this is the external surface. */
export function canViewOwnPortfolio(role: Role): boolean {
  return role === "investor";
}

/** Can request a withdrawal against their available balance. */
export function canRequestWithdrawal(role: Role): boolean {
  return role === "investor";
}

/**
 * Can create/close capital positions and run settlements.
 * Money movement is super_admin only — a market_manager can see investor data
 * for their market but never change what anyone is owed.
 */
export function canManageInvestments(role: Role): boolean {
  return role === "super_admin";
}

/** Can approve, reject or mark a withdrawal paid. */
export function canDecideWithdrawal(role: Role): boolean {
  return role === "super_admin";
}

/** Can view investor records administratively (read-only for managers). */
export function canViewInvestorAdmin(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
