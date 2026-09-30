/**
 * The rejection taxonomy as *data* — the editable twin of `rejection-taxonomy`.
 *
 * `rejection-taxonomy` holds the shape the system shipped with: five groups and
 * eighteen sub-reasons, compiled in. This module holds the same tree once it has
 * been read out of `rejection_reason_configs`, where a manager can add a
 * sub-reason, rename one, recolour a group or retire a reason that stopped
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

import type { StatusHue } from "./status-presentation";
import type { RejectionReasonConfig } from "@/types/rejection-config";
import { REJECTION_GROUPS, type RejectionGroup } from "./rejection-taxonomy";

/**
 * The hue each seeded group wears, and the fallback whenever the config has not
 * loaded or the key predates it.
 *
 * Not five shades of red. A rejection is one of four *different* business
 * problems, and reading which one off a column of a thousand rows is the whole
 * point of colouring them apart:
 *
 *   red     — the customer heard the offer and said no. The real lost sale.
 *   amber   — nobody could be reached. Still actionable; a better number may fix it.
 *   violet  — reachable and willing, but undeliverable. A coverage problem, not a
 *             sales one, and it belongs to logistics rather than to the agent.
 *   neutral — there was never an order there. Counting these as losses overstates
 *             every rejection rate in the system.
 */
export const SEED_GROUP_HUES: Record<RejectionGroup, StatusHue> = {
  refus_client: "red",
  injoignable: "amber",
  livraison_impossible: "violet",
  commande_invalide: "neutral",
  autre: "neutral",
};

/** Retired top-level values, mapped to the hue of the group that absorbed them. */
export const LEGACY_GROUP_HUES: Record<string, StatusHue> = {
  faux_numero: "amber", // became injoignable › numero_invalide
  prix: "red", // became refus_client › prix_eleve
  doublon: "neutral", // became commande_invalide › doublon
  non_serieux: "neutral", // became commande_invalide › non_serieux
};

export interface RejectionGroupNode {
  key: string;
  labelFr: string;
  labelAr: string;
  shortFr: string;
  shortAr: string;
  hue: StatusHue;
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
    hue: g.hue,
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

/**
 * Seed rows for a market that has none — the same tree the migration inserts.
 * Used as the client-side fallback so a surface renders something sane while
 * the fetch is in flight, rather than flashing bare "Rejeté".
 */
export function seedGroupHue(groupKey: string | null | undefined): StatusHue {
  if (!groupKey) return "red";
  if (groupKey in SEED_GROUP_HUES) {
    return SEED_GROUP_HUES[groupKey as RejectionGroup];
  }
  return LEGACY_GROUP_HUES[groupKey] ?? "red";
}

/** Every group key the system knows how to colour, seeded or legacy. */
export const ALL_KNOWN_GROUP_KEYS: readonly string[] = [
  ...REJECTION_GROUPS,
  ...Object.keys(LEGACY_GROUP_HUES),
];
