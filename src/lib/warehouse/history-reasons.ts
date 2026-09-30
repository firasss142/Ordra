/**
 * Le vocabulaire du registre, et la famille à laquelle chaque motif appartient.
 *
 * POURQUOI CE FICHIER EXISTE. `getWarehouseHistoryPage` choisissait les motifs
 * en ligne, et pour « Tout » il en listait QUATRE — `scanned`, `returned`,
 * `damaged_writeoff`, `manual_adjustment` — alors que
 * `inventory_log_reason_check` en autorise douze. `stock_count`,
 * `received_back`, `initial_stock`, `scan_reversal` et
 * `manual_delete_reversal` étaient donc invisibles dans le Journal et dans son
 * export CSV : le stock d'ouverture d'un produit n'apparaissait nulle part, et
 * pas un seul comptage physique non plus.
 *
 * Un registre qui affiche « Tout » et en cache la moitié est pire qu'absent :
 * on l'ouvre pour vérifier, et il confirme ce qu'on croyait déjà. C'est pour
 * cela que la réception ne pouvait pas être ajoutée par-dessus sans corriger
 * d'abord.
 *
 * La liste vit donc dans UN endroit, testé, avec un filet qui vérifie que
 * l'union des familles recouvre tout le vocabulaire — sinon un motif ajouté en
 * base redeviendrait invisible dans chaque filtre, exactement comme la
 * première fois.
 */

/** Les douze valeurs de `inventory_log_reason_check`, `deposit` hérité compris. */
export const ALL_LEDGER_REASONS = [
  "scanned",
  "scan_reversal",
  "returned",
  "received_back",
  "damaged_writeoff",
  "manual_adjustment",
  "initial_stock",
  "stock_count",
  "manual_delete_reversal",
  "deposit",
  "reception",
  "reception_reversal",
] as const;

export type LedgerReason = (typeof ALL_LEDGER_REASONS)[number];

/** Les familles du Journal. `print` et `handover` ne lisent pas le registre. */
export type HistoryKind =
  | "all"
  | "print"
  | "handover"
  | "scan"
  | "return"
  | "reception"
  | "count"
  | "adjust"
  | "writeoff";

/**
 * Chaque motif appartient à exactement une famille.
 *
 * `received_back` va avec les retours : le colis revient de chez le
 * transporteur, il est simplement destiné à repartir. `initial_stock` va avec
 * les corrections, parce que c'est une pose de valeur par un humain et non un
 * mouvement physique. `deposit` est hérité et n'est plus écrit, mais quatre
 * lignes existent encore en base et doivent rester lisibles.
 */
const FAMILY: Record<LedgerReason, Exclude<HistoryKind, "all" | "print" | "handover">> = {
  scanned: "scan",
  scan_reversal: "scan",
  returned: "return",
  received_back: "return",
  damaged_writeoff: "writeoff",
  manual_adjustment: "adjust",
  initial_stock: "adjust",
  manual_delete_reversal: "adjust",
  deposit: "adjust",
  stock_count: "count",
  reception: "reception",
  reception_reversal: "reception",
};

/**
 * Les motifs à interroger pour une famille donnée.
 *
 * `writeoff` est un cas à part : `damaged_writeoff` appartient à cette famille
 * ET doit apparaître quand on demande les retours, parce qu'une casse constatée
 * au retour est un retour. C'est le seul chevauchement, et il est délibéré.
 */
export function reasonsForKind(kind: HistoryKind): LedgerReason[] {
  if (kind === "print" || kind === "handover") return [];
  if (kind === "all") return [...ALL_LEDGER_REASONS];

  if (kind === "return") {
    return ["returned", "damaged_writeoff", "received_back"];
  }

  return ALL_LEDGER_REASONS.filter((r) => FAMILY[r] === kind);
}

/** À quelle famille ranger une ligne du registre. */
export function kindForReason(reason: string): Exclude<HistoryKind, "all"> {
  return FAMILY[reason as LedgerReason] ?? "adjust";
}
