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

/**
 * "Content" = the selling narrative an agent reads mid-call: description,
 * agent brief/notes, media, and the per-variant pack note. Deliberately
 * weaker than canManageProducts — managers own the pitch for their market,
 * but costs, stock, name, sku and price stay super_admin-only (see
 * 20260422_product_stock_lockdown.sql). Writes route through
 * update_product_agent_content / update_variant_agent_note.
 */
export function canEditProductContent(
  role: Role,
  targetMarketId: string,
  actorMarketId: string,
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canToggleProductActive(role: Role): boolean {
  return (
    role === "super_admin" ||
    role === "market_manager" ||
    role === "warehouse_agent"
  );
}
