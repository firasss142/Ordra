import type { Role } from "@/types";

/**
 * Who can see and manage storefront -> OMS mappings.
 *
 * Mirrors product permissions: super_admin everywhere, market_manager within
 * their own market. Agents and warehouse_agents never touch mappings — they
 * only consume the already-resolved order. RLS enforces the market boundary
 * at the data layer; these checks fail fast at the API edge.
 */

export function canViewMappings(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

export function canManageMappings(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
