/**
 * « En route » — les unités commandées qui ne sont pas encore sur l'étagère.
 *
 * POURQUOI CE CHIFFRE COMPTE. `plans/stock-page-radical-redesign.md` le décrit
 * comme « la seule chose vraiment non calculable » : sans table de commandes,
 * `reorder_by_date` ne pouvait pas soustraire ce qui est déjà commandé, et une
 * date de réapprovisionnement sans cela est un vœu. La réception fournit enfin
 * la source.
 *
 * LA DÉCISION DIFFICILE : QUAND UN BROUILLON CESSE DE COMPTER.
 *   Un brouillon que personne n'a annulé gonflerait la couverture pour toujours.
 *   L'écran dirait « 300 en route » des mois après que le fournisseur a cessé de
 *   répondre, et quelqu'un renoncerait à recommander sur la foi d'un chiffre
 *   mort. Trois règles :
 *
 *     · `submitted` compte TOUJOURS, date prévue ou non — quelqu'un a vu la
 *       marchandise sur le quai et l'a comptée, c'est un fait ;
 *     · `draft` compte tant qu'il est plausible, soit jusqu'à
 *       `expected_at + STALE_DRAFT_DAYS` ;
 *     · un `draft` SANS date prévue ne compte pas : rien ne permet de dire s'il
 *       est vivant, et inventer une échéance serait pire que se taire.
 *
 *   L'alternative — ne compter que `submitted` — était plus simple mais perdait
 *   tout l'intérêt : une livraison annoncée pour la semaine prochaine est
 *   exactement ce qu'on veut voir avant de recommander.
 *
 * `null` ET JAMAIS `0`. La Map ne contient que les produits qui ont vraiment
 * quelque chose en route, pour que l'écran rende « — » et non un zéro rassurant.
 */

/**
 * Au-delà de combien de jours après la date prévue un brouillon cesse d'être
 * crédible. Quatorze jours : assez pour absorber un retard de dédouanement,
 * trop peu pour qu'un abandon passe un mois inaperçu.
 */
export const STALE_DRAFT_DAYS = 14;

export interface IncomingLine {
  product_id: string;
  expected_qty: number | null;
  received_qty: number | null;
}

export interface IncomingReception {
  status: string;
  expected_at: string | null;
  lines: IncomingLine[];
}

function isCounting(r: IncomingReception, now: Date): boolean {
  // Validée = les unités SONT le stock. Les compter encore les compterait deux fois.
  if (r.status === "submitted") return true;
  if (r.status !== "draft") return false;
  if (!r.expected_at) return false;

  const expected = new Date(`${r.expected_at}T00:00:00Z`).getTime();
  if (Number.isNaN(expected)) return false;

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return today - expected <= STALE_DRAFT_DAYS * 86_400_000;
}

/**
 * Combien d'unités sont en route par produit.
 *
 * Sur une réception déjà partiellement comptée, ce qui reste en route est le
 * SOLDE (attendu − reçu) : les unités déjà comptées sont sur le quai, plus en
 * transit. Un surplus ne rend jamais un nombre négatif.
 */
export function incomingByProduct(
  receptions: IncomingReception[],
  now: Date = new Date(),
): Map<string, number> {
  const out = new Map<string, number>();

  for (const r of receptions) {
    if (!isCounting(r, now)) continue;

    for (const line of r.lines) {
      if (line.expected_qty === null || line.expected_qty === undefined) continue;
      const remaining = line.expected_qty - (line.received_qty ?? 0);
      if (remaining <= 0) continue;
      out.set(line.product_id, (out.get(line.product_id) ?? 0) + remaining);
    }
  }

  return out;
}
