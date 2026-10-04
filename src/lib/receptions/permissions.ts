import type { Role } from "@/types";

/**
 * Qui fait quoi sur une réception de marchandises.
 *
 * DEUX LIEUX, DEUX NATURES. Le quai enregistre des ARRIVAGES et le stock entre
 * immédiatement ; le bureau SOLDE le groupe et c'est là que l'argent entre.
 *
 * CE N'EST PLUS UNE SÉPARATION DES TÂCHES. Une deuxième signature ne crée pas
 * de preuve : elle crée un deuxième nom sous le même chiffre non vérifié. Le
 * contrôle est devenu un RAPPROCHEMENT contre une pièce externe — la facture du
 * fournisseur — et il vit dans `settle_reception`, pas dans ces droits.
 *
 * LE COÛT N'EST PAS UNE INFORMATION D'ENTREPÔT. Un agent compte des objets ; ce
 * qu'ils ont coûté ne l'aide pas à compter et ne le regarde pas. Le filtre est
 * appliqué CÔTÉ SERVEUR sur la projection, jamais en CSS : en production
 * `products.unit_cogs` est lisible par `authenticated` malgré ce qu'affirme la
 * doc, donc masquer côté client ne serait pas un contrôle.
 */

/** Voir l'onglet Réceptions et son contenu. */
export function canViewReceptions(role: Role): boolean {
  return role === "super_admin" || role === "market_manager" || role === "warehouse_agent";
}

/**
 * Enregistrer un arrivage — le geste du quai, et le seul chemin d'entrée de
 * stock. Deux champs : le produit et la quantité.
 */
export function canRecordArrival(role: Role): boolean {
  return role === "super_admin" || role === "market_manager" || role === "warehouse_agent";
}

/**
 * Solder — fournisseur, prix, frais, rapprochement, référence. C'est le geste
 * du BUREAU : l'agent du quai compte, il ne chiffre pas.
 */
export function canSettleReception(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

/**
 * Contre-passer une réception validée. Le registre est en écriture seule : on
 * corrige en ajoutant l'inverse, et ce geste-là reste au super_admin.
 */
export function canReverseReception(role: Role): boolean {
  return role === "super_admin";
}

/** Voir les prix d'achat, la valeur reçue et les totaux en argent. */
export function canSeeReceptionCosts(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

/**
 * Enregistrer et lire les paiements. Suit exactement le droit de voir les
 * coûts : un paiement EST une information d'argent, et les deux ne doivent
 * jamais pouvoir divorcer.
 */
export function canManageReceptionPayments(role: Role): boolean {
  return canSeeReceptionCosts(role);
}
