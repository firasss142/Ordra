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

const DEXPRESS_KEY_MAP: Record<number, OrderStatus> = {
  1: "in_transit",
  10: "delivered",
};

export function mapDexpressStatus(
  statusKey: number,
  nameStatus: string
): CarrierStatusMapping | null {
  const statusTo = DEXPRESS_KEY_MAP[statusKey];
  if (!statusTo) return null;
  return {
    statusTo,
    note: `Dexpress: ${nameStatus}`,
    isDamaged: false,
  };
}
