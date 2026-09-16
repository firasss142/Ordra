/**
 * Les règles qui encadrent la désactivation d'un site d'entrepôt.
 *
 * WHY. `warehouses.is_active` est déjà respecté partout (stock, ramassage,
 * sites, scan) — mais rien ne l'édite, donc personne n'a jamais eu à se
 * demander ce qu'il advient des gens et du stock qui restent derrière.
 *
 * Deux garde-fous, tirés des contraintes du projet :
 *
 * 1. LE SITE PAR DÉFAUT. Chaque marché en a un (Tripoli pour `ly`, Tunis pour
 *    `tn`). Le désactiver laisserait le marché sans site par défaut, donc c'est
 *    refusé tant qu'un autre ne l'a pas remplacé.
 *
 * 2. LES AGENTS ASSIGNÉS. Tripoli et Benghazi ont chacun un warehouse_agent.
 *    La règle du projet est explicite : un warehouse_agent sans site VOIT RIEN
 *    — « non assigné » ne doit jamais vouloir dire « non restreint ». On ne
 *    bloque donc pas la désactivation, mais elle doit être CONFIRMÉE et
 *    l'appelant doit savoir qui il met à l'arrêt.
 *
 * Fonction pure : elle juge un état déjà lu et ne parle pas à Supabase.
 */

export interface SiteDeactivationInput {
  /** Le site visé. */
  site: { id: string; isDefault: boolean; isActive: boolean };
  /** Les warehouse_agents dont `warehouse_id` pointe sur ce site. */
  assignedAgents: Array<{ id: string; name: string }>;
  /** Unités encore en stock sur ce site, tous produits confondus. */
  stockUnits: number;
  /** L'appelant a vu l'avertissement et insiste. */
  confirmed: boolean;
}

export type SiteDeactivationVerdict =
  | { ok: true }
  | { ok: false; code: "is_default"; message: string }
  | {
      ok: false;
      code: "needs_confirmation";
      message: string;
      agents: Array<{ id: string; name: string }>;
      stockUnits: number;
    };

export function checkSiteDeactivation(
  input: SiteDeactivationInput,
): SiteDeactivationVerdict {
  const { site, assignedAgents, stockUnits, confirmed } = input;

  // Le site par défaut n'est jamais désactivable : le refus passe avant tout le
  // reste, car aucune confirmation ne le rend acceptable.
  if (site.isDefault) {
    return {
      ok: false,
      code: "is_default",
      message:
        "Ce site est le site par défaut du marché. Désignez un autre site par défaut avant de le désactiver.",
    };
  }

  const hasImpact = assignedAgents.length > 0 || stockUnits > 0;
  if (hasImpact && !confirmed) {
    return {
      ok: false,
      code: "needs_confirmation",
      message: buildImpactMessage(assignedAgents, stockUnits),
      agents: assignedAgents,
      stockUnits,
    };
  }

  return { ok: true };
}

function buildImpactMessage(
  agents: Array<{ id: string; name: string }>,
  stockUnits: number,
): string {
  const parts: string[] = [];

  if (agents.length > 0) {
    const names = agents.map((a) => a.name).join(", ");
    parts.push(
      agents.length === 1
        ? `${names} est affecté·e à ce site et n'aura plus accès à rien tant qu'un autre site ne lui sera pas assigné.`
        : `${agents.length} agents (${names}) sont affectés à ce site et n'auront plus accès à rien tant qu'un autre site ne leur sera pas assigné.`,
    );
  }

  if (stockUnits > 0) {
    parts.push(
      `${stockUnits} unité(s) restent en stock sur ce site ; elles disparaîtront des écrans d'entrepôt sans quitter le total du marché.`,
    );
  }

  return parts.join(" ");
}
