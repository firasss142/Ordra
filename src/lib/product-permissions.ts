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

/**
 * Archiver retire le produit de TOUS les sélecteurs de la console — file agent,
 * création de commande, mappings boutique et transporteur. C'est strictement
 * plus lourd que désactiver, qui est réversible d'un clic et partagé avec les
 * managers et le magasin. L'archivage reste donc avec le rôle qui possède déjà
 * la création, les coûts et le stock.
 *
 * Le vrai gardien est la RPC archive_product (SECURITY DEFINER) : cette
 * fonction ne sert qu'à rendre le refus lisible avant l'aller-retour réseau.
 */
export function canArchiveProduct(role: Role): boolean {
  return role === "super_admin";
}

export function canToggleProductActive(role: Role): boolean {
  return (
    role === "super_admin" ||
    role === "market_manager" ||
    role === "warehouse_agent"
  );
}
