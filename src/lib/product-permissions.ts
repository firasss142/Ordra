import type { Role } from "../types";

// Stock integrity model: only super_admin can create, edit, or adjust stock on
// products. Market managers and warehouse agents are read-only on everything
// except the is_active toggle (see canToggleProductActive).
export function canManageProducts(
  role: Role,
  _targetMarketId: string,
  _actorMarketId: string,
): boolean {
  return role === "super_admin";
}

export function canAdjustStock(
  role: Role,
  _targetMarketId: string,
  _actorMarketId: string,
): boolean {
  return role === "super_admin";
}

export function canViewProducts(
  role: Role,
  targetMarketId: string,
  actorMarketId: string,
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager" || role === "warehouse_agent") {
    return targetMarketId === actorMarketId;
  }
  return false;
}

export function canToggleProductActive(role: Role): boolean {
  return (
    role === "super_admin" ||
    role === "market_manager" ||
    role === "warehouse_agent"
  );
}
