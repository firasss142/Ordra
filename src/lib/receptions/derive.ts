/**
 * Ce qui se déduit d'une réception — et ne se stocke donc jamais.
 *
 * TROIS RÈGLES DE CE PROJET, EN CODE PLUTÔT QU'EN COMMENTAIRE
 *
 *   1. « En retard » est un CALCUL. Un drapeau stocké demanderait une tâche
 *      planifiée pour le maintenir, et serait faux le jour où elle ne tourne
 *      pas. C'est `expected_at < aujourd'hui` sur une réception non soldée.
 *
 *   2. `null`, jamais `0`, quand on ne sait pas. Un écart n'existe que si les
 *      DEUX nombres existent : sans quantité annoncée, l'écran doit dire
 *      « non annoncé » et non un faux « conforme ». Même discipline que
 *      `last_counted_at` et `days_of_cover` sur l'écran Stock.
 *
 *   3. « Payé » se DÉDUIT de somme(paiements) contre la valeur reçue. Deux
 *      acomptes sur une livraison marchent donc dès le premier jour, et le
 *      reste à payer ne peut pas se désynchroniser de ses lignes.
 */

export type PaymentState = "not_applicable" | "unpaid" | "partial" | "paid";

/**
 * TROIS ÉTATS, PAS CINQ.
 *
 * `open`    — le quai y ajoute des arrivages, et le stock est DÉJÀ entré.
 * `settled` — soldée : fournisseur, prix, frais, référence frappée, dû créé.
 * `reversed`— contre-passée.
 *
 * `draft`, `submitted`, `posted` et `cancelled` ont disparu avec la bascule du
 * quai et du bureau : il n'y a plus de moment où la marchandise est sur
 * l'étagère et où Ordra dit qu'elle n'existe pas.
 */
export type ReceptionStatus = "open" | "settled" | "reversed";

/**
 * Tolérance de comparaison monétaire. `amount` est NUMERIC(12,3) en base, donc
 * le millième est le grain réel ; on compare à la demi-unité de ce grain pour
 * qu'un aller-retour en flottant ne fasse pas basculer une réception soldée en
 * « partiellement payée ».
 */
const MONEY_EPSILON = 0.0005;

export function paymentState(input: { value: number | null; paid: number }): PaymentState {
  const value = input.value ?? 0;
  // Rien n'a de valeur : la question du paiement ne se pose pas encore. Une
  // réception attendue n'est pas « impayée ».
  if (value <= MONEY_EPSILON) return "not_applicable";

  if (input.paid <= MONEY_EPSILON) return "unpaid";
  // Un trop-payé (arrondi de virement, geste commercial) est payé, pas une
  // anomalie à faire clignoter en rouge.
  if (input.paid >= value - MONEY_EPSILON) return "paid";
  return "partial";
}

/** L'écart d'une ligne, ou `null` si l'un des deux nombres manque. */
export function lineVariance(line: {
  expected: number | null;
  received: number | null;
}): number | null {
  if (line.expected === null || line.expected === undefined) return null;
  if (line.received === null || line.received === undefined) return null;
  return line.received - line.expected;
}

export interface ReceptionLineFigures {
  expected_qty?: number | null;
  received_qty: number | null;
  damaged_qty: number | null;
  unit_cost: number | null;
}

export interface ReceptionTotals {
  units: number;
  damaged: number;
  /** `null` quand aucune ligne ne porte de prix — « — », pas « 0,000 ». */
  value: number | null;
  /** Combien de lignes ont pu être valorisées, pour dire « partiel » sans mentir. */
  valuedLines: number;
  lines: number;
  /**
   * La somme des quantités ANNONCÉES, `null` quand aucune ligne n'annonce rien.
   * « Non annoncé » n'est pas « zéro attendu », donc l'absence ne devient pas 0.
   */
  expected: number | null;
  /**
   * Combien de lignes portent un nombre reçu — ZÉRO COMPRIS, parce que « le
   * carton était vide » est une réponse et non une absence de réponse.
   */
  countedLines: number;
}

export function receptionTotals(lines: ReceptionLineFigures[]): ReceptionTotals {
  let units = 0;
  let damaged = 0;
  let value = 0;
  let valuedLines = 0;
  let expected = 0;
  let expectedLines = 0;
  let countedLines = 0;

  for (const line of lines) {
    const received = line.received_qty ?? 0;
    units += received;
    damaged += line.damaged_qty ?? 0;
    if (line.received_qty !== null && line.received_qty !== undefined) countedLines += 1;

    if (line.expected_qty !== null && line.expected_qty !== undefined) {
      expected += line.expected_qty;
      expectedLines += 1;
    }

    // La valeur porte sur ce qui entre en stock. Les abîmées n'entrent pas :
    // elles ne sont pas un actif, elles sont un litige fournisseur.
    if (line.unit_cost !== null && line.unit_cost !== undefined && received > 0) {
      value += line.unit_cost * received;
      valuedLines += 1;
    }
  }

  return {
    units,
    damaged,
    value: valuedLines > 0 ? value : null,
    valuedLines,
    lines: lines.length,
    expected: expectedLines > 0 ? expected : null,
    countedLines,
  };
}

/**
 * Le chiffre de tête d'une ligne de liste, et le MOT qui dit ce qu'il est.
 *
 * La maquette §3 n'affiche jamais un nombre nu : « 300 attendues » est une
 * promesse, « 312 comptées » est une déclaration, « 1 000 unités » est un fait
 * en stock, « 80 annulées » est une écriture retirée. `totals.units` seul ne
 * peut pas porter cette distinction, puisqu'il somme le REÇU : une réception
 * annoncée et pas encore comptée y vaut 0, et un 0 affiché se lit « rien n'est
 * arrivé » — le contraire de ce qu'on veut dire.
 */
export type HeadlineKind = "expected" | "counted" | "units" | "cancelled" | "unknown";

export interface Headline {
  value: number | null;
  kind: HeadlineKind;
}

export function headlineQuantity(reception: {
  status: ReceptionStatus | string;
  totals: Pick<ReceptionTotals, "units" | "expected" | "countedLines">;
}): Headline {
  const { status, totals } = reception;

  // Une contre-passation porte ce qu'elle a retiré, au signe près : le nombre
  // est le même, le mot change tout.
  if (status === "reversed") return { value: totals.units, kind: "cancelled" };
  if (status === "settled") return { value: totals.units, kind: "units" };

  // Sur un groupe ouvert, le fait le plus récent gagne : dès qu'un humain a
  // compté une ligne, c'est son comptage qu'on montre, pas la promesse.
  if (totals.countedLines > 0) return { value: totals.units, kind: "counted" };
  if (totals.expected !== null) return { value: totals.expected, kind: "expected" };
  return { value: null, kind: "unknown" };
}

/**
 * La part versée, en pourcentage entier — « acompte 40 % ».
 *
 * La colonne « paiement » de la liste est étroite : un pourcentage y tient là où
 * un montant et sa devise n'y tiennent pas. Le reste à payer exact, lui, a sa
 * place dans la feuille, où il y a la largeur pour le dire au millième.
 */
export function paidPercent(input: { value: number | null; paid: number }): number | null {
  // Sans valeur reçue, il n'y a pas de dénominateur — et pas de dette établie.
  if (input.value === null || input.value <= MONEY_EPSILON) return null;
  return Math.min(Math.round((input.paid / input.value) * 100), 100);
}

/**
 * En retard = la date annoncée est passée et le groupe n'est toujours pas soldé.
 *
 * `expected_at` ne se remplit que depuis un bon de commande (étape 6) ; sans
 * annonce il n'y a pas de retard possible, et la fonction répond `false` plutôt
 * que d'inventer une échéance.
 */
export function isLate(
  reception: { expected_at: string | null; status: ReceptionStatus | string },
  now: Date = new Date(),
): boolean {
  if (!reception.expected_at) return false;
  if (reception.status !== "open") return false;

  // Comparaison au jour, en UTC : `expected_at` est une DATE en base, sans
  // heure. Comparer à un instant ferait basculer la ligne en « retard » selon
  // l'heure de la journée.
  const expected = new Date(`${reception.expected_at}T00:00:00Z`);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return expected.getTime() < today.getTime();
}

/** De combien de jours, pour l'afficher. `null` si pas en retard. */
export function daysLate(
  reception: { expected_at: string | null; status: ReceptionStatus | string },
  now: Date = new Date(),
): number | null {
  if (!isLate(reception, now)) return null;
  const expected = new Date(`${reception.expected_at}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - expected) / 86_400_000);
}

/**
 * La moyenne pondérée qu'écrira le soldage, si la politique du marché l'allume.
 *
 * Le front la calcule pour MONTRER l'arithmétique avant qu'elle s'applique. Le
 * chiffre qui compte reste celui que
 * la RPC écrit ; celui-ci doit lui être identique, d'où le même arrondi au
 * millième et le même traitement d'un stock négatif.
 */
export function weightedAverageCost(input: {
  stockBefore: number;
  cogsBefore: number;
  qty: number;
  unitCost: number | null;
}): number | null {
  if (input.unitCost === null || input.unitCost === undefined) return null;
  if (!input.qty || input.qty <= 0) return null;

  // Un stock négatif existe dans cette base (survente) et inverserait la
  // moyenne. On le traite comme zéro : le prix d'achat devient le coût.
  const base = Math.max(input.stockBefore, 0);
  const total = base * input.cogsBefore + input.qty * input.unitCost;
  const count = base + input.qty;
  if (count <= 0) return null;

  return Math.round((total / count) * 1000) / 1000;
}
