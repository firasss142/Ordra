/**
 * Pure helpers behind the Libya destination picker: the Darb Assabil (city,
 * area) catalogue as a flat option list, grouped for browsing, searched with
 * Arabic-tolerant matching, and labelled for display.
 *
 * Options come either from `/api/darb/destinations` (with row ids, which an
 * order stores as `darb_destination_id`) or from the bundled JSON catalogue
 * (ids unknown — used before the API answers and in the dispatch step, which
 * ships by name). Both carry the same validated pairs; the JSON is what seeds
 * the table.
 */
import { normalizeCityName } from "@/lib/storefronts/normalize-city";
import { DARB_ASSABIL_CITIES } from "./darb-assabil-areas";

export interface DarbDestinationOption {
  /** `darb_destinations.id`, or null when the source is the bundled catalogue. */
  id: number | null;
  city: string;
  area: string;
}

export interface DestinationCityGroup {
  city: string;
  /** The city's own pair first (when Darb serves the centre), then the rest in catalogue order. */
  areas: DarbDestinationOption[];
}

/**
 * Cities pinned to the top of the browse list. Together they carry ~60% of
 * Libya's volume (90-day count, 2026-09); everything else follows in the
 * catalogue's order. Kept short on purpose — a long "favourites" list is a
 * second alphabet to learn.
 */
export const PINNED_CITIES = ["طرابلس", "بنغازي"];

let staticCache: DarbDestinationOption[] | null = null;

/** The bundled catalogue flattened to options with unknown ids. */
export function staticDestinations(): DarbDestinationOption[] {
  if (!staticCache) {
    staticCache = Object.entries(DARB_ASSABIL_CITIES).flatMap(([city, areas]) =>
      areas.map((area) => ({ id: null, city, area })),
    );
  }
  return staticCache;
}

function isCentre(o: DarbDestinationOption): boolean {
  return normalizeCityName(o.area) === normalizeCityName(o.city);
}

function cityRank(city: string): number {
  const i = PINNED_CITIES.indexOf(city);
  return i === -1 ? PINNED_CITIES.length : i;
}

/**
 * Group options by city for the browse view. Pinned cities first, then the
 * rest in the order the options arrived (catalogue order). Within a city the
 * centre pair leads.
 */
export function groupByCity(
  options: DarbDestinationOption[],
  scopeCity?: string | null,
): DestinationCityGroup[] {
  const scope = normalizeCityName(scopeCity);
  const byCity = new Map<string, DarbDestinationOption[]>();
  for (const o of options) {
    if (scope && normalizeCityName(o.city) !== scope) continue;
    const list = byCity.get(o.city) ?? [];
    list.push(o);
    byCity.set(o.city, list);
  }
  const groups: DestinationCityGroup[] = [];
  for (const [city, list] of byCity) {
    const centre = list.filter(isCentre);
    const rest = list.filter((o) => !isCentre(o));
    groups.push({ city, areas: [...centre, ...rest] });
  }
  // Stable sort: pinned rank first, insertion order otherwise.
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => cityRank(a.g.city) - cityRank(b.g.city) || a.i - b.i)
    .map(({ g }) => g);
}

/**
 * Search cities and areas with the same folding the intake resolver uses, so
 * سوكنه finds سوكنة and الابرق finds الأبرق. Results keep the browse order:
 * a matching city's centre first, then its areas, city by city.
 */
export function searchDestinations(
  options: DarbDestinationOption[],
  query: string,
  scopeCity?: string | null,
): DarbDestinationOption[] {
  const q = normalizeCityName(query);
  if (!q) return [];
  const out: DarbDestinationOption[] = [];
  for (const group of groupByCity(options, scopeCity)) {
    const cityHit = normalizeCityName(group.city).includes(q);
    for (const o of group.areas) {
      if (cityHit || normalizeCityName(o.area).includes(q)) out.push(o);
    }
  }
  return out;
}

/** "اجدابيا" for a centre pair, "طرابلس — جنزور" for a sub-area. */
export function destinationLabel(o: { city: string; area: string; id?: number | null }): string {
  return normalizeCityName(o.area) === normalizeCityName(o.city) ? o.city : `${o.city} — ${o.area}`;
}

export function findDestinationById(
  options: DarbDestinationOption[],
  id: number | null | undefined,
): DarbDestinationOption | null {
  if (id == null) return null;
  return options.find((o) => o.id === id) ?? null;
}

export function findDestination(
  options: DarbDestinationOption[],
  city: string | null | undefined,
  area: string | null | undefined,
): DarbDestinationOption | null {
  const c = normalizeCityName(city);
  const a = normalizeCityName(area);
  if (!c || !a) return null;
  return (
    options.find(
      (o) => normalizeCityName(o.city) === c && normalizeCityName(o.area) === a,
    ) ?? null
  );
}

const FOLD: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي" };
const DROPPED = /[ً-ْـء]/; // harakat, tatweel, bare hamza

/**
 * The [start, end) slice of `text` that `query` matched, under the same folding
 * `searchDestinations` applies — so the highlight lands on the letters the
 * agent typed even when the catalogue spells them differently (الابرق → الأبرق).
 * Null when there is no match.
 */
export function matchRange(text: string, query: string): [number, number] | null {
  const q = normalizeCityName(query);
  if (!q) return null;
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DROPPED.test(ch)) continue;
    const f = (FOLD[ch] ?? ch).toLowerCase();
    if (/\s/.test(f)) {
      if (folded === "" || folded.endsWith(" ")) continue;
      folded += " ";
    } else {
      folded += f;
    }
    origin.push(i);
  }
  const at = folded.indexOf(q);
  if (at < 0) return null;
  return [origin[at], origin[at + q.length - 1] + 1];
}
