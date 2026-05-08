import type { OrderStatus } from "@/types/order-status";

export interface CarrierStatusMapping {
  statusTo: OrderStatus;
  note: string;
  isDamaged: boolean;
}

const NAVEX_MAP: Record<string, OrderStatus> = {
  "Au magasin": "deposit",
  "Enleve": "deposit",
  "Rtn depot": "deposit",
  "En cours": "in_transit",
  "Livrer": "delivered",
  "Rtn definitif": "to_be_returned",
  "Rtn client/agence": "returned",
  "Retour recu": "returned",
  "Retour paye": "returned",
  "Retour Expediteur": "returned",
  "A verifier": "unverified",
  "Supprime": "cancelled",
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
