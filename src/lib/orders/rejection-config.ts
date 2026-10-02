/**
 * The rejection taxonomy as *data* — the editable twin of `rejection-taxonomy`.
 *
 * `rejection-taxonomy` holds the shape the system shipped with: five groups and
 * eighteen sub-reasons, compiled in. This module holds the same tree once it has
 * been read out of `rejection_reason_configs`, where a manager can add a
 * sub-reason, rename one, reorder a group or retire a reason that stopped
 * happening — without a migration.
 *
 * The two coexist deliberately. The hardcoded list is the seed, the fallback
 * before the fetch resolves, and the answer for the four legacy group values
 * (`faux_numero`, `prix`, `doublon`, `non_serieux`) that survive in the Postgres
 * enum but are no longer offered anywhere.
 *
 * Nothing here touches Supabase: it takes rows and returns a tree, so a route
 * handler, a client component and a test all use the same code path.
 */

import type { StatusIconName } from "./status-presentation";
import type { RejectionReasonConfig } from "@/types/rejection-config";
import type { RejectionGroup } from "./rejection-taxonomy";

/**
 * The mark each group wears inside a rejected badge, and the fallback whenever
 * the config has not loaded or the key predates it.
 *
 * The group lives in the ICON, not the colour. Every hue in the status palette
 * already names a live state — amber is "still being called", violet is
 * "confirmed", teal is "with the carrier" — so a group painted in one of them
 * made a dead order read as a live one (LY's « Commande non réelle » in teal
 * looked shipped on 707 rows). A rejected order is always the quiet red of an
 * unsuccessful ending; which KIND of ending is the glyph, and the words say
 * the rest.
 */
export const REJECTION_GROUP_ICONS: Record<RejectionGroup, StatusIconName> = {
  refus_client: "rejectedRefused", // heard the offer, said no — the real lost sale
  injoignable: "rejectedUnreachable", // nobody picked up
  livraison_impossible: "rejectedUndeliverable", // willing, but we cannot get there
  commande_invalide: "rejectedInvalid", // there was never an order
  autre: "rejectedOther", // the agent's note is the reason
};

/** Retired top-level values, mapped to the icon of the group that absorbed them. */
const LEGACY_GROUP_ICONS: Record<string, StatusIconName> = {
  faux_numero: "rejectedUnreachable", // became injoignable › numero_invalide
  prix: "rejectedRefused", // became refus_client › prix_eleve
  doublon: "rejectedInvalid", // became commande_invalide › doublon
  non_serieux: "rejectedInvalid", // became commande_invalide › non_serieux
};

/** The group's mark, or the plain rejected cross for a key nobody knows. */
export function rejectionGroupIcon(groupKey: string | null | undefined): StatusIconName {
  if (!groupKey) return "rejected";
  return (
    REJECTION_GROUP_ICONS[groupKey as RejectionGroup] ??
    LEGACY_GROUP_ICONS[groupKey] ??
    "rejected"
  );
}

export interface RejectionGroupNode {
  key: string;
  labelFr: string;
  labelAr: string;
  shortFr: string;
  shortAr: string;
  sortOrder: number;
  isActive: boolean;
  /** `autre`: the free-text note stands in for a sub-reason. */
  requiresNote: boolean;
  /** The group's own row, for surfaces that need the id to PATCH it. */
  config: RejectionReasonConfig;
  subreasons: RejectionReasonConfig[];
}

interface TreeOptions {
  /**
   * Drop retired rows. On for anything that offers a *choice* (the agent's
   * picker, the reject route's validation); off for anything that *renders
   * history*, which must keep resolving a label for a reason since retired.
   */
  activeOnly?: boolean;
}

const bySortOrder = (
  a: { sort_order: number; key: string },
  b: { sort_order: number; key: string },
) => a.sort_order - b.sort_order || a.key.localeCompare(b.key);

/**
 * Rows → the two-level tree, sorted.
 *
 * A sub-reason whose parent is missing is dropped rather than promoted: a stray
 * row is a data fault, and surfacing it as a top-level group would let it be
 * picked, written to an order, and then fail validation forever after.
 */
export function buildRejectionTree(
  rows: RejectionReasonConfig[],
  { activeOnly = false }: TreeOptions = {},
): RejectionGroupNode[] {
  const groups = rows
    .filter((r) => r.parent_key === null)
    .filter((r) => !activeOnly || r.is_active)
    .sort(bySortOrder);

  const known = new Set(groups.map((g) => g.key));

  const children = new Map<string, RejectionReasonConfig[]>();
  for (const r of rows) {
    if (r.parent_key === null) continue;
    if (!known.has(r.parent_key)) continue;
    if (activeOnly && !r.is_active) continue;
    const list = children.get(r.parent_key);
    if (list) list.push(r);
    else children.set(r.parent_key, [r]);
  }

  return groups.map((g) => ({
    key: g.key,
    labelFr: g.label_fr,
    labelAr: g.label_ar,
    shortFr: g.short_fr,
    shortAr: g.short_ar,
    sortOrder: g.sort_order,
    isActive: g.is_active,
    requiresNote: g.requires_note,
    config: g,
    subreasons: (children.get(g.key) ?? []).sort(bySortOrder),
  }));
}

/** The row for a key, at either level. */
export function findRejectionConfig(
  rows: RejectionReasonConfig[],
  key: string | null | undefined,
): RejectionReasonConfig | null {
  if (!key) return null;
  return rows.find((r) => r.key === key) ?? null;
}

/**
 * Is this a complete, self-consistent answer against *this market's* taxonomy?
 *
 * The DB-driven counterpart of `isValidPair`, and it keeps that function's one
 * real rule: a bare group is not an answer while the group still has sub-reasons
 * to offer. That rule is the only thing that stopped 36% of rejections landing
 * on the vaguest option, so it survives the move to configurable data.
 *
 * Two escapes, both narrow:
 *   - a note-only group (`autre`) takes no sub-reason, ever;
 *   - a group whose sub-reasons have all been retired accepts a bare group,
 *     because the alternative is a group nobody can pick.
 *
 * Pass a tree built with `activeOnly: true` — validation is about what may be
 * chosen now, not about what exists.
 */
export function validateRejectionPair(
  tree: RejectionGroupNode[],
  group: string,
  sub: string | null | undefined,
): boolean {
  const node = tree.find((g) => g.key === group);
  if (!node) return false;

  if (node.requiresNote) return !sub;
  if (node.subreasons.length === 0) return !sub;
  if (!sub) return false;

  return node.subreasons.some((s) => s.key === sub);
}
