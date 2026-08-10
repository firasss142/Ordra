/**
 * Why an order died, in two levels.
 *
 * The old list was seven flat values, and `autre` was the most-used of them:
 * 651 of 1798 rejections (36%), of which 68% carried no note at all. Roughly
 * 440 orders have a permanently unknowable reason. That is not a taxonomy
 * problem in the abstract — it is the reason nobody can answer "are we losing
 * these to price, to bad numbers, or to a competitor?".
 *
 * Every sub-reason below was read out of the free-text notes agents actually
 * wrote under `autre` — "اشترى من مكان آخر" (bought elsewhere), "الرقم لشخص آخر"
 * (wrong person answered), "قال اني مش طالب" (never ordered it), "يغلق الخط"
 * (hangs up), "خارج التغطية" (outside coverage) — not invented from a whiteboard.
 *
 * Kept deliberately OUT of this list: "the customer wants it later". That is not
 * a rejection, it is a callback, and the picker offers it as an escape that
 * reschedules instead of killing the order.
 *
 * The keys here mirror `orders_rejection_subreason_check` in
 * 20260827000003_rejection_taxonomy_enum.sql, and a test fails if they drift.
 */

import { REJECTION_REASONS, type RejectionReason } from "@/types/order-status";

/**
 * The groups live in `types/order-status` with the rest of the status
 * vocabulary; this module owns the second level and the rules. Dependencies run
 * lib → types, never the other way.
 */
export const REJECTION_GROUPS = REJECTION_REASONS;

export type RejectionGroup = RejectionReason;

export const REJECTION_SUBREASONS: Record<RejectionGroup, readonly string[]> = {
  // The customer understood the offer and said no.
  refus_client: [
    "prix_eleve",
    "frais_livraison",
    "achete_ailleurs",
    "changement_avis",
    "produit_non_voulu",
  ],
  // There was never a real order behind the row.
  commande_invalide: ["non_commande", "doublon", "simple_info", "non_serieux"],
  // Nobody could be reached, for one of several very different reasons —
  // "wrong number" and "never picks up" need different follow-up.
  injoignable: [
    "pas_de_reponse",
    "numero_invalide",
    "numero_hors_service",
    "mauvais_interlocuteur",
    "raccroche",
  ],
  // Reachable and willing, but the order cannot physically be delivered.
  livraison_impossible: [
    "hors_couverture",
    "paiement_impossible",
    "adresse_invalide",
    "absent_ville",
  ],
  // The escape hatch. No sub-reason — the free-text note is mandatory instead,
  // which is the whole point of keeping it narrow.
  autre: [],
};

export const ALL_SUBREASONS: readonly string[] = REJECTION_GROUPS.flatMap(
  (g) => REJECTION_SUBREASONS[g],
);

const SUBREASON_TO_GROUP = new Map<string, RejectionGroup>(
  REJECTION_GROUPS.flatMap((g) =>
    REJECTION_SUBREASONS[g].map((s) => [s, g] as const),
  ),
);

/** The group that owns a sub-reason, or null if the key is unknown. */
export function groupForSubreason(sub: string | null | undefined): RejectionGroup | null {
  if (!sub) return null;
  return SUBREASON_TO_GROUP.get(sub) ?? null;
}

export function isRejectionGroup(value: string): value is RejectionGroup {
  return (REJECTION_GROUPS as readonly string[]).includes(value);
}

/**
 * Is this a complete, self-consistent answer?
 *
 * Every group except `autre` requires a sub-reason — that requirement is what
 * stops the new model decaying back into the old one, where picking the vaguest
 * option was always the fastest way to close the sheet.
 */
export function isValidPair(group: string, sub: string | null | undefined): boolean {
  if (!isRejectionGroup(group)) return false;
  if (group === "autre") return !sub;
  if (!sub) return false;
  return groupForSubreason(sub) === group;
}
