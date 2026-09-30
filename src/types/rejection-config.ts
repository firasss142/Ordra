import type { StatusHue } from "@/lib/orders/status-presentation";

/**
 * One row of the rejection taxonomy, as stored per market.
 *
 * `parent_key === null` marks a GROUP — the five fixed top-level values that
 * mirror the `rejection_reason` Postgres enum. Anything else is a sub-reason
 * belonging to that group, and those are fully editable.
 */
export interface RejectionReasonConfig {
  id: string;
  market_id: string;
  /** null on a group row; the owning group's key on a sub-reason. */
  parent_key: string | null;
  key: string;
  label_fr: string;
  label_ar: string;
  /** The badge label — "Faux n°" where `label_fr` is "Numéro faux ou inexistant". */
  short_fr: string;
  short_ar: string;
  /** Meaningful on a group row only; sub-reasons inherit their parent's hue. */
  hue: StatusHue;
  sort_order: number;
  /** false = retired: gone from the picker, still rendered on past orders. */
  is_active: boolean;
  /** True for `autre` only — the free-text note stands in for a sub-reason. */
  requires_note: boolean;
  created_at: string;
  updated_at: string;
}

/** The six named hues a group may wear. Not a free hex — see the migration. */
export const REJECTION_HUES: readonly StatusHue[] = [
  "neutral",
  "amber",
  "violet",
  "teal",
  "green",
  "red",
];

/**
 * Same shape as `STATUS_KEY_REGEX`. A key is an identifier, not a label: it is
 * written into `orders.rejection_subreason` and has to survive a JSON round
 * trip, a URL and an Arabic locale unchanged.
 */
export const REJECTION_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

/** Fields a manager may change on an existing row. */
export interface RejectionConfigPatch {
  label_fr?: string;
  label_ar?: string;
  short_fr?: string;
  short_ar?: string;
  hue?: StatusHue;
  sort_order?: number;
  is_active?: boolean;
}
