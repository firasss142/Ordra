import type { OrderStatus } from "@/types/order-status";

export interface CarrierStatusMapping {
  statusTo: OrderStatus;
  note: string;
  isDamaged: boolean;
}

/**
 * Navex's word → where Ordra moves the parcel (forward only, see
 * promote_navex_status, 20261006140000). Never « returned » nor « cancelled »:
 * a return waits in Entrepôt › Rentrer until the bench scans it (that scan
 * puts stock back), and cancelling is a manager's act. « Supprime » is left
 * out on purpose — unknown, so Journaux shows it rather than Ordra guessing.
 */
const NAVEX_MAP: Record<string, OrderStatus> = {
  "Au magasin": "deposit",
  "Enleve": "deposit",
  "Rtn depot": "deposit",
  "En cours": "in_transit",
  "Livrer": "delivered",
  "Livrer Paye": "delivered",
  "Rtn definitif": "to_be_returned",
  "Rtn client/agence": "to_be_returned",
  "Retour recu": "to_be_returned",
  "Retour paye": "to_be_returned",
  "Retour Expediteur": "to_be_returned",
  "A verifier": "unverified",
};

const NAVEX_IGNORED = new Set([
  "En attente",
  "Echange",
  "A enlever",
  "Non recu",
]);

export function mapNavexStatus(etat: string): CarrierStatusMapping | null {
  if (NAVEX_IGNORED.has(etat)) return null;
  const statusTo = NAVEX_MAP[etat];
  if (!statusTo) return null;
  return {
    statusTo,
    note: `Navex: ${etat}`,
    isDamaged: false,
  };
}

// mapDexpressStatus removed: Dexpress has no status API.
