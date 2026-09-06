/**
 * The nine Darb Assabil sticker-roll colours.
 *
 * A Darb parcel is routed by a PRE-PRINTED sticker peeled off a coloured roll,
 * and the colour is chosen by destination. Get it wrong and the parcel goes on
 * the wrong truck — so the warehouse has to know the colour before it picks the
 * parcel up, not at the bench.
 *
 * WHERE THE COLOUR COMES FROM. Darb's own branch directory:
 * `GET /api/local/branches/public` returns a `color` hex on every branch
 * record. It is absent from the vendor Postman collection and from
 * INTEGRATION_GUIDE.md — their documented schema is not the whole payload, the
 * same way `toZoneCode` is live but undocumented — which is why it was missed
 * until probed. See `scripts/probe-darb-branches.ts`.
 *
 * The API is the authority on WHICH branch is which colour. This module adds
 * only the human NAME of each colour, which the API does not carry; the names
 * come from Darb's printed poster, and `darb-zones.test.ts` asserts the two
 * still agree against the committed probe output.
 *
 * THE JOIN KEY IS `toBranchGroup`, on every shipment from creation — before
 * booking, before handover. Two other fields look like they would work and do
 * not:
 *   - `toZoneCode` (8 values) merges colours: zone `TR` spans طرابلس (rouge)
 *     AND ترهونة (brun); zone `WA` spans اجدابيا (magenta) AND الكفرة (lime).
 *   - `breakdown.branchToBranch` is a radial distance band from the ORIGIN
 *     branch, so it differs between our Tripoli and Benghazi accounts.
 *
 * Both accounts publish an identical directory, so the colours are
 * company-wide. What differs per account is the PRICE, not the colour.
 */

export interface DarbZone {
  /** Lowercase `#rrggbb`, exactly as Darb publishes it. The identity. */
  hex: string;
  /** What the roll looks like on the shelf. */
  colourFr: string;
  colourAr: string;
  /** The card this colour covers on Darb's printed poster. */
  nameFr: string;
  nameAr: string;
}

/**
 * Keyed by the API's colour, because the API — not this file — decides which
 * destinations belong together. Adding a name here does not create a zone;
 * only Darb repainting a branch does.
 */
export const DARB_ZONES: Record<string, DarbZone> = {
  "#d80a0a": {
    hex: "#d80a0a",
    colourFr: "Rouge",
    colourAr: "أحمر",
    nameFr: "Tripoli et banlieue",
    nameAr: "طرابلس وضواحيها",
  },
  "#fc6401": {
    hex: "#fc6401",
    colourFr: "Orange",
    colourAr: "برتقالي",
    nameFr: "Ouest de Tripoli",
    nameAr: "غرب طرابلس",
  },
  "#f9fc01": {
    hex: "#f9fc01",
    colourFr: "Jaune",
    colourAr: "أصفر",
    nameFr: "Est de Tripoli",
    nameAr: "شرق طرابلس",
  },
  "#5a3001": {
    hex: "#5a3001",
    colourFr: "Brun",
    colourAr: "بني",
    nameFr: "Sud de Tripoli",
    nameAr: "جنوب طرابلس",
  },
  "#091d96": {
    hex: "#091d96",
    colourFr: "Bleu marine",
    colourAr: "أزرق داكن",
    nameFr: "Djebel occidental",
    nameAr: "الجبل الغربي",
  },
  "#ed00ff": {
    hex: "#ed00ff",
    colourFr: "Magenta",
    colourAr: "أرجواني",
    nameFr: "Région centrale",
    nameAr: "المنطقة الوسطى",
  },
  "#339307": {
    hex: "#339307",
    colourFr: "Vert",
    colourAr: "أخضر",
    nameFr: "Région orientale",
    nameAr: "المنطقة الشرقية",
  },
  "#0cbceb": {
    hex: "#0cbceb",
    colourFr: "Cyan",
    colourAr: "سماوي",
    nameFr: "Région méridionale",
    nameAr: "المنطقة الجنوبية",
  },
  "#8fff00": {
    hex: "#8fff00",
    colourFr: "Vert lime",
    colourAr: "أخضر فاتح",
    nameFr: "Sud-Est",
    nameAr: "الجنوب الشرقي",
  },
};

/**
 * Display order, following the poster: Tripoli outward, then the country
 * clockwise. Used wherever zones are listed (roll registry, picking list) so
 * two screens never disagree about the order.
 */
export const DARB_ZONE_ORDER: readonly string[] = [
  "#d80a0a",
  "#fc6401",
  "#f9fc01",
  "#5a3001",
  "#091d96",
  "#ed00ff",
  "#339307",
  "#0cbceb",
  "#8fff00",
];

/**
 * Lowercase and trim a hex the API returned. Darb has been consistent so far,
 * but the colour is the primary key of the whole feature — a stray space or an
 * uppercase digit must not create a tenth zone.
 */
export function normalizeHex(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** The zone for a published colour, or null. Never guesses a nearby colour. */
export function zoneForColor(value: string | null | undefined): DarbZone | null {
  return DARB_ZONES[normalizeHex(value)] ?? null;
}

/** What an operator reads on the strip, in their own language. */
export interface ZoneLabels {
  colour: string | null;
  name: string | null;
}

/**
 * The colour and zone names in the operator's language.
 *
 * The Libyan bench reads Arabic, and the roll colour is the ONE label the
 * whole routing control rests on — "Rouge — Tripoli et banlieue" is not a
 * colour a Libyan agent can reach for. Accepts either the published hex or
 * anything zone-shaped (an `OrderZone`, a `DarbZone`), and never guesses: an
 * unknown colour is a pair of nulls the caller turns into "à confirmer".
 */
export function zoneLabels(
  zone: string | { colorHex?: string | null; hex?: string | null } | null | undefined,
  locale: string,
): ZoneLabels {
  const hex = typeof zone === "string" ? zone : (zone?.colorHex ?? zone?.hex ?? null);
  const z = zoneForColor(hex);
  if (!z) return { colour: null, name: null };
  return locale === "ar"
    ? { colour: z.colourAr, name: z.nameAr }
    : { colour: z.colourFr, name: z.nameFr };
}
