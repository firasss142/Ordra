import type { Role } from "@/types";

// Route allow-list per role. Every role must appear here — a role missing from
// the map is treated as "no access" rather than crashing (see canAccess).
const PERMISSIONS: Record<Role, string[]> = {
  super_admin: ["/orders", "/unassigned", "/products", "/team", "/users", "/carriers", "/settings", "/queue", "/leads", "/warehouse"],
  market_manager: ["/orders", "/unassigned", "/products", "/team", "/users", "/carriers", "/settings", "/leads", "/warehouse"],
  agent: ["/queue", "/leads"],
  warehouse_agent: ["/warehouse"],
  // Investors are external. Exactly one route, and no staff surface at all.
  investor: ["/investor"],
};

export function canAccess(role: Role, route: string): boolean {
  // Defensive: a DB role not present in the map (e.g. mid-deploy, or a value
  // added by migration before the code ships) previously threw a TypeError
  // here, which crashed middleware for every request by that user. Deny instead.
  return PERMISSIONS[role]?.includes(route) ?? false;
}

export function canEditCosts(role: Role): boolean {
  return role === "super_admin";
}

export function canManageProducts(role: Role): boolean {
  return role === "super_admin";
}

export function canPrintLabels(role: Role): boolean {
  return role === "super_admin" || role === "market_manager" || role === "warehouse_agent";
}

export function canScanWarehouse(role: Role): boolean {
  return role === "warehouse_agent" || role === "super_admin" || role === "market_manager";
}
