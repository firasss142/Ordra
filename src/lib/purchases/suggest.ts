/**
 * COMBIEN COMMANDER — un point de départ, jamais une décision.
 *
 * Le chiffre proposé n'est pas une optimisation : c'est « de quoi tenir jusqu'à
 * la prochaine livraison, plus une marge », et il est MODIFIABLE à l'écran. Son
 * seul travail est d'éviter le formulaire vide, qui est la raison pour laquelle
 * `expected_qty` serait resté NULL pour toujours.
 *
 * ON SE TAIT PLUTÔT QUE DE DEVINER. Sans demande mesurée il n'y a pas de
 * calcul, seulement une invention présentée comme un calcul : on rend `null` et
 * la raison, et l'écran ouvre le champ vide en le disant.
 */
import { COVER_WATCH_DAYS } from "@/lib/inventory/stock-position-types";

/**
 * La couverture visée APRÈS la livraison, en jours.
 *
 * C'est `COVER_WATCH_DAYS` lui-même — la borne que la console de stock utilise
 * déjà pour séparer « à surveiller » de « sain ». Commander pour atterrir juste
 * au-dessus de sa propre borne de surveillance est la seule valeur qui ne
 * contredise pas le reste de l'application, et l'IMPORTER plutôt que de recopier
 * 45 est ce qui garantit que les deux ne divergeront pas.
 *
 * Elle vivra dans `settings` le jour où quelqu'un voudra une politique par
 * marché ou par produit — pas avant, et sûrement pas en double.
 */
export const TARGET_COVER_DAYS = COVER_WATCH_DAYS;

export interface SuggestInput {
  /** Unités/jour sur la fenêtre de demande. `null` ou 0 = on ne sait pas. */
  demandRatePerDay: number | null;
  /** physical − engagé. SIGNÉ : un déficit est un manque de plus, pas un stock. */
  freeToSell: number;
  /** Déjà commandé et pas encore arrivé. Commander deux fois est l'erreur. */
  onOrderUnits: number;
  /** Délai du fournisseur, mesuré ou réglé. */
  leadTimeDays: number;
}

export interface Suggestion {
  /** `null` quand on refuse de proposer — voir `reason`. */
  qty: number | null;
  /** Les jours que la commande vise à couvrir, pour que l'écran l'explique. */
  target_days: number;
  reason: "ok" | "no_demand" | "covered";
}

export function suggestOrderQty(input: SuggestInput): Suggestion {
  const target = Math.max(input.leadTimeDays, 0) + TARGET_COVER_DAYS;

  if (!input.demandRatePerDay || input.demandRatePerDay <= 0) {
    return { qty: null, target_days: target, reason: "no_demand" };
  }

  const need = input.demandRatePerDay * target;
  // `freeToSell` peut être négatif (survendu) : la soustraction le traite alors
  // naturellement comme un besoin supplémentaire, ce qui est exactement juste.
  const have = input.freeToSell + input.onOrderUnits;
  // VERS LE HAUT. Une unité manquante est une rupture ; une unité de trop est
  // du capital immobilisé quelques jours.
  const qty = Math.ceil(need - have);

  if (qty <= 0) return { qty: null, target_days: target, reason: "covered" };
  return { qty, target_days: target, reason: "ok" };
}
