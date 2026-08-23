/**
 * Free-text destination → Darb branch group → sticker-roll colour.
 *
 * Our `customer_city` is whatever the storefront collected. Of the 66 distinct
 * Libyan values in production, 45 are AREAS filed as cities (جنزور, شحات,
 * اوباري…), several are pseudo-places ("مكتب طرابلس", "ضواحي طرابلس (15)"), and
 * spellings vary by hamza, alef and ta-marbuta. Darb's branch directory holds
 * the canonical names, so this module folds ours onto theirs.
 *
 * PRECEDENCE. This is the LAST resort. An order Darb has already seen carries
 * `toBranchGroup` on the shipment itself, and that always wins — it is what the
 * carrier actually did with the parcel, not what its directory says it should
 * do. The two genuinely disagree: 16 الزاوية shipments are filed under `TR`
 * while the directory puts الزاوية under `ZWY`. `darb-routing.ts` orders the
 * chain; this module only answers "if all we have is an address, then what?".
 *
 * NEVER GUESS. A wrong colour puts the parcel on the wrong truck, which is
 * worse than an operator reading "couleur à confirmer" and asking. Two real
 * destinations (القربوللي, الشقيقة) have no Darb branch and resolve to null on
 * purpose.
 */

import { normalizeHex } from "./darb-zones";

export interface DirectoryRow {
  branchGroup: string;
  /** Darb's published colour for the branch. Null on `EXP` and `RGG` only. */
  color: string | null;
  city: string;
  area: string | null;
}

export interface DestinationHit {
  branchGroup: string;
  color: string | null;
  /** Which input matched. */
  source: "area" | "city";
  /** True when the colour was borrowed from the city, the branch having none. */
  inferred: boolean;
}

interface Entry {
  branchGroup: string;
  color: string | null;
  city: string;
  /** How many areas the branch serves — the tie-break for a shared name. */
  weight: number;
}

export interface DestinationIndex {
  byName: Map<string, Entry>;
  /** Normalised city → the distinct colours its branches publish. */
  cityColors: Map<string, Set<string>>;
}

/** Arabic diacritics and the tatweel elongation, all decorative. */
const DECORATION = /[ً-ْـ]/g;
/** A standalone hamza: customers add and omit it freely (براك الشاطيء / الشاطي). */
const STANDALONE_HAMZA = /ء/g;
/** "(15)" and friends — a storefront artefact, never part of a place name. */
const PARENTHETICAL = /\([^)]*\)/g;
/** Separators some storefronts leave in a compound value. */
const SEPARATORS = /[\\/|،,]+/g;

const FOLD_FROM = "أإآٱىةؤئ";
const FOLD_TO = "اااايهوي";

/**
 * Fold a place name to the form both sides can be compared in: no diacritics,
 * no standalone hamza, one shape per alef / ya / ta-marbuta, single spaces.
 */
export function normalizeDestination(value: string | null | undefined): string {
  let s = (value ?? "").normalize("NFC");
  s = s.replace(PARENTHETICAL, " ");
  s = s.replace(DECORATION, "");
  s = s.replace(STANDALONE_HAMZA, "");
  s = s.replace(SEPARATORS, " ");
  let out = "";
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch);
    out += i === -1 ? ch : FOLD_TO[i];
  }
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Names our storefronts produce that Darb's directory does not carry, mapped to
 * the canonical name that means the same place. Kept explicit rather than
 * inferred by fuzzy matching: a near-miss here is a misrouted parcel, so every
 * entry is a judgement someone can audit.
 */
const ALIASES: Record<string, string> = {
  // Directory writes the compound; customers type either half.
  "جالو": "جالو اوجلة",
  "اوجلة": "جالو اوجلة",
  // Directory omits the leading alef.
  "امساعد": "مساعد",
  // Region names typed into the city field. Each names exactly one zone.
  "الجبل الغربي": "غريان",
  "المنطقة الوسطي تخفيض": "سرت",
  // Pickup pseudo-destinations — always the Tripoli branch.
  "مكتب طرابلس": "طرابلس",
  "ضواحي طرابلس": "طرابلس",
};

const NORMALIZED_ALIASES = new Map<string, string>(
  Object.entries(ALIASES).map(([from, to]) => [
    normalizeDestination(from),
    normalizeDestination(to),
  ]),
);

/**
 * Index the directory by every name it offers — city and area alike, because
 * our data uses them interchangeably.
 *
 * When two branches share a name (طرابلس is a city of `TR` and an area of six
 * one-desk branches; بنغازي belongs to `BN` and `BNN`) the branch serving more
 * areas wins. That is the main office rather than a single counter, which is
 * what an operator means by the name.
 */
export function buildDestinationIndex(rows: DirectoryRow[]): DestinationIndex {
  const weights = new Map<string, number>();
  for (const row of rows) {
    if (row.area) weights.set(row.branchGroup, (weights.get(row.branchGroup) ?? 0) + 1);
  }

  const byName = new Map<string, Entry>();
  const cityColors = new Map<string, Set<string>>();

  const offer = (name: string | null, row: DirectoryRow) => {
    const key = normalizeDestination(name);
    if (!key) return;
    const entry: Entry = {
      branchGroup: row.branchGroup,
      color: row.color ? normalizeHex(row.color) : null,
      city: normalizeDestination(row.city),
      weight: weights.get(row.branchGroup) ?? 0,
    };
    const existing = byName.get(key);
    // A named colour beats an unnamed one; otherwise the bigger branch wins.
    if (
      !existing ||
      (!existing.color && entry.color) ||
      (Boolean(existing.color) === Boolean(entry.color) && entry.weight > existing.weight)
    ) {
      byName.set(key, entry);
    }
  };

  for (const row of rows) {
    const city = normalizeDestination(row.city);
    if (city && row.color) {
      if (!cityColors.has(city)) cityColors.set(city, new Set());
      cityColors.get(city)!.add(normalizeHex(row.color));
    }
    offer(row.city, row);
    offer(row.area, row);
  }

  return { byName, cityColors };
}

function lookup(name: string | null | undefined, index: DestinationIndex): Entry | null {
  const key = normalizeDestination(name);
  if (!key) return null;
  const direct = index.byName.get(key);
  if (direct) return direct;
  const aliased = NORMALIZED_ALIASES.get(key);
  return aliased ? (index.byName.get(aliased) ?? null) : null;
}

function withColor(entry: Entry, source: "area" | "city", index: DestinationIndex): DestinationHit {
  if (entry.color) {
    return { branchGroup: entry.branchGroup, color: entry.color, source, inferred: false };
  }
  // Only `EXP` (زناتة) and `RGG` (الرياضية) reach here, both in طرابلس. Borrow
  // the city's colour when its other branches agree unanimously — and say so,
  // so the bench can show it differently from a colour Darb published.
  const colours = index.cityColors.get(entry.city);
  const only = colours && colours.size === 1 ? [...colours][0] : null;
  return { branchGroup: entry.branchGroup, color: only, source, inferred: only !== null };
}

/**
 * Resolve an address to its branch group and roll colour, or null when Darb's
 * directory does not serve it. The area wins over the city: it is the more
 * specific of the two and the one Darb routes on.
 */
export function resolveDestination(
  city: string | null | undefined,
  area: string | null | undefined,
  index: DestinationIndex,
): DestinationHit | null {
  const byArea = lookup(area, index);
  if (byArea) return withColor(byArea, "area", index);
  const byCity = lookup(city, index);
  if (byCity) return withColor(byCity, "city", index);
  return null;
}
