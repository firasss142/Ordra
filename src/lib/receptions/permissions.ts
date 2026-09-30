import type { Role } from "@/types/user";

/**
 * Qui fait quoi sur une réception de marchandises.
 *
 * DEUX PERSONNES, DEUX GESTES. L'agent d'entrepôt qui décharge le camion
 * DÉCLARE ce qu'il a compté ; un manager VALIDE, et la validation seule fait
 * exister le stock. Recevoir est le seul mouvement qui crée des unités à partir
 * de rien sans document en face — une sortie a sa commande, un retour a son
 * colis — donc c'est là que la séparation des tâches paie.
 *
 * C'est un ASSOUPLISSEMENT de l'état actuel, pas un durcissement : aujourd'hui
 * seul un super_admin peut faire monter le stock, et l'agent qui reçoit la
 * marchandise n'a aucun chemin d'écriture.
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

/** Créer un brouillon, saisir les lignes, déclarer ce qui est arrivé. */
export function canDraftReception(role: Role): boolean {
  return role === "super_admin" || role === "market_manager" || role === "warehouse_agent";
}

/** Valider — le seul geste qui écrit le registre et fait exister le stock. */
export function canPostReception(role: Role): boolean {
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
