type Role = "super_admin" | "market_manager" | "agent" | "warehouse_agent";

const PERMISSIONS: Record<Role, string[]> = {
  super_admin: ["/orders", "/unassigned", "/products", "/team", "/users", "/carriers", "/settings", "/queue", "/leads", "/warehouse"],
  market_manager: ["/orders", "/unassigned", "/products", "/team", "/users", "/carriers", "/settings", "/leads", "/warehouse"],
  agent: ["/queue", "/leads"],
  warehouse_agent: ["/warehouse"],
};

export function canAccess(role: Role, route: string): boolean {
  return PERMISSIONS[role].includes(route);
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
