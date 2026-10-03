import type { Role } from "@/types";

/**
 * Qui touche aux fournisseurs.
 *
 * LIRE UN NOM N'EST PAS LIRE UN PRIX. La feuille de réception affiche déjà
 * « مكتبة الرسالة » en tête pour tous les rôles d'entrepôt — ce sont les
 * montants que la projection retire côté serveur. Un agent peut donc lire la
 * liste des fournisseurs ; il n'y apprend rien qu'il ne voie déjà.
 *
 * ÉCRIRE EST UN GESTE DE BUREAU. Créer ou renommer un fournisseur engage une
 * ardoise comptable, et l'agent du quai n'en rencontre jamais un : sa surface
 * n'affiche ni prix ni fournisseur. Ces droits répliquent exactement la RLS de
 * `20261003160000_suppliers_and_payables.sql` — si l'un des deux change, l'autre
 * doit changer avec lui.
 */

export function canViewSuppliers(role: Role): boolean {
  return role === "super_admin" || role === "market_manager" || role === "warehouse_agent";
}

export function canManageSuppliers(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
