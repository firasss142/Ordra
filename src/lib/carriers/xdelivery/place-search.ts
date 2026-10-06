/**
 * The upload sheet's delegation search (prototypes/xdelivery-v1.html, screen 3).
 *
 * The delegation is optional — without a pick the governorate's main town is sent
 * (DEFAULT_DELEGATION) — so the list opens with that default first and flagged. Typing
 * filters delegations, then localities: the customer names a quartier, and the option
 * says which delegation it belongs to. A locality only ever selects its delegation;
 * X-Delivery's add-parcel has no locality field.
 */

import { XDELIVERY_DELEGATIONS } from "./catalogue";
import { DEFAULT_DELEGATION, fold } from "./destinations";

export type LocalityTree = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

export interface PlaceOption {
  key: string;
  delegation: string;
  /** The quartier that matched, or null for the delegation itself. */
  locality: string | null;
  isDefault: boolean;
}

const GOVERNORATES: readonly string[] = Object.keys(XDELIVERY_DELEGATIONS).sort((a, b) =>
  a.localeCompare(b, "fr"),
);

export function xdeliveryGovernorates(): readonly string[] {
  return GOVERNORATES;
}

export function searchXDeliveryPlaces(input: {
  governorate: string;
  query: string;
  /** XDELIVERY_LOCALITIES once its chunk has loaded; delegations only until then. */
  localities?: LocalityTree | null;
  limit?: number;
}): PlaceOption[] {
  const delegations = XDELIVERY_DELEGATIONS[input.governorate];
  if (!delegations) return [];
  const limit = input.limit ?? 50;
  const fallback = DEFAULT_DELEGATION[input.governorate];
  const wanted = fold(input.query);

  const asOption = (delegation: string): PlaceOption => ({
    key: delegation,
    delegation,
    locality: null,
    isDefault: delegation === fallback,
  });

  const ordered = [fallback, ...delegations.filter((d) => d !== fallback)];
  if (!wanted) return ordered.slice(0, limit).map(asOption);

  const out: PlaceOption[] = ordered.filter((d) => fold(d).includes(wanted)).map(asOption);

  const tree = input.localities?.[input.governorate];
  if (tree) {
    for (const delegation of ordered) {
      for (const locality of tree[delegation] ?? []) {
        if (out.length >= limit) return out;
        if (fold(locality).includes(wanted)) {
          out.push({ key: `${delegation}/${locality}`, delegation, locality, isDefault: false });
        }
      }
    }
  }
  return out.slice(0, limit);
}
