/**
 * What the orders search box means, resolved once.
 *
 * The bar it replaces sent the raw string straight into four `ilike '%…%'`
 * legs. Two things were wrong with that, and both were measured against the
 * live table (7,036 orders):
 *
 * 1. **It could not find a phone number.** The same customer's number is
 *    written three ways in this data — `925782017`, `0925782017` (461 rows)
 *    and `+21698000001` (1,011 rows) — because it arrives from three
 *    storefronts. Searching the number as the operator writes it,
 *    `0925782017`, matched *nothing*, while five orders had that customer.
 *    A substring search only works if both sides agree on the format, and
 *    nobody agrees on phone formats. So the query is reduced to its national
 *    digits — country code and leading zeros gone — which every stored form
 *    contains as a substring.
 *
 * 2. **It seq-scanned the table.** `product_name` has no trigram index, and a
 *    single unindexed leg collapses the whole `BitmapOr` into a full scan:
 *    39 ms and 692 buffers, against 6.4 ms and 32 for the same search over the
 *    three indexed columns. Every column named here now carries a
 *    `gin_trgm_ops` index (see `20260901000001_orders_search_trgm.sql`) — do
 *    not add a field to `FIELD_COLUMNS` without adding its index.
 *
 * Terms are ANDed and each term is ORed across its columns, so "salima 925"
 * means "an order whose text mentions salima AND whose text mentions 925" —
 * the two need not be the same field. That is the rule the agent queue's
 * client-side search already used (`lib/queue/search.ts`); this is the same
 * contract, evaluated in Postgres so it can see rows that are not on screen.
 */

/** A column group a term can be aimed at with a `tel:`-style prefix. */
export type SearchField =
  | "name"
  | "phone"
  | "city"
  | "address"
  | "product"
  | "ref"
  | "tracking";

export interface SearchTerm {
  /** Null when the term was typed bare and should try every column. */
  field: SearchField | null;
  /** Cleaned text to match. Never empty. */
  value: string;
  /**
   * The term reduced to national phone digits, when it looks like it could be
   * a number. Null for anything that is not mostly digits.
   */
  phone: string | null;
}

/**
 * Prefixes an operator can type. ASCII and locale-independent on purpose: the
 * same keystrokes work on the French and the Arabic interface, and an agent
 * switching between them does not have to relearn the box.
 */
const FIELD_PREFIXES: Record<string, SearchField> = {
  name: "name",
  nom: "name",
  client: "name",
  phone: "phone",
  tel: "phone",
  tél: "phone",
  city: "city",
  ville: "city",
  address: "address",
  adresse: "address",
  product: "product",
  produit: "product",
  ref: "ref",
  order: "ref",
  commande: "ref",
  tracking: "tracking",
  suivi: "tracking",
  bl: "tracking",
};

/** The prefixes to advertise in the UI, in the order they are worth learning. */
export const SEARCH_PREFIX_HINTS = ["tel:", "ville:", "produit:", "ref:", "suivi:"] as const;

/** Which columns a term searches. Every one of these carries a trigram index. */
const FIELD_COLUMNS: Record<SearchField, string[]> = {
  name: ["customer_name"],
  phone: ["customer_phone", "customer_phone_2"],
  city: ["customer_city"],
  address: ["customer_address"],
  product: ["product_name"],
  ref: ["external_id"],
  tracking: ["tracking_number"],
};

/** Columns a bare term tries — everything a dispatcher can see on the row. */
const FREE_COLUMNS = [
  "customer_name",
  "customer_city",
  "customer_address",
  "product_name",
  "external_id",
  "tracking_number",
];

/**
 * More terms than this and the planner is intersecting more bitmaps than the
 * result is worth. Four words is already a very specific search.
 */
const MAX_TERMS = 4;

/**
 * Below two characters a term matches most of the table and cannot use a
 * trigram index either, so it costs a seq scan to return everything.
 */
const MIN_TERM_LENGTH = 2;

/**
 * Reduce a phone number to the digits that identify it locally.
 *
 * Both country codes in play (216 Tunisia, 218 Libya) and the trunk `0` are
 * dropped, so `+216 98 000 001`, `0098000001` and `98000001` all become
 * `98000001`. Every form this data stores contains that string, which is what
 * makes one `ilike '%…%'` enough to find all of them.
 */
export function toNationalDigits(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";

  let v = digits;
  if (v.startsWith("00216") || v.startsWith("00218")) v = v.slice(5);
  // Only when a plausible local number is left. A bare "216" is someone
  // searching for those three digits, not a Tunisian country code.
  else if ((v.startsWith("216") || v.startsWith("218")) && v.length - 3 >= 7) v = v.slice(3);

  return v.replace(/^0+/, "") || digits;
}

/** Could this term be a phone number? Digits and the separators people type. */
function looksNumeric(value: string): boolean {
  return /^[+\d][\d\s\-.()]*$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 3;
}

/**
 * Strip what would otherwise be read as syntax rather than as text.
 *
 * `%` and `_` are ILIKE wildcards; `,` `(` `)` `.` and `"` terminate or nest a
 * PostgREST `or=(…)` list. A customer named `O'Brien (Sfax)` must be
 * searchable without any of that reaching the filter string.
 */
function sanitize(value: string): string {
  return value.replace(/[%_,().":\\*]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split on whitespace, keeping "quoted phrases" whole so a two-word city or
 * product name can be searched as one thing.
 */
function tokenize(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(m[1] ?? m[2] ?? "");
  return out.filter(Boolean);
}

/** Parse the box into the terms to apply. Empty when nothing is searchable. */
export function parseSearch(raw: string): SearchTerm[] {
  if (!raw || !raw.trim()) return [];

  const terms: SearchTerm[] = [];

  for (const token of tokenize(raw)) {
    if (terms.length >= MAX_TERMS) break;

    let field: SearchField | null = null;
    let body = token;

    const colon = token.indexOf(":");
    if (colon > 0) {
      const candidate = FIELD_PREFIXES[token.slice(0, colon).toLowerCase()];
      if (candidate) {
        field = candidate;
        body = token.slice(colon + 1);
      }
    }

    // A phone keeps its separators for the digit reduction, then loses them.
    const numeric = looksNumeric(body);
    const phone = numeric ? toNationalDigits(body) : null;

    const value = numeric ? (phone ?? "") : sanitize(body);
    if (!value) continue;
    // A field-restricted term is deliberate — "ville:s" is a narrow search the
    // operator asked for, not the accident a bare "s" would be.
    if (value.length < MIN_TERM_LENGTH && !field) continue;

    terms.push({ field, value, phone: phone || null });
  }

  return terms;
}

/**
 * One term as a PostgREST `or=(…)` body.
 *
 * A term aimed at no field still prefers the phone columns when it reads as a
 * number, because "the digits 925782017" is almost always a phone and only
 * incidentally a substring of an address.
 */
export function termToOrFilter(term: SearchTerm): string {
  const legs: string[] = [];

  if (term.field) {
    for (const col of FIELD_COLUMNS[term.field]) {
      legs.push(`${col}.ilike.%${term.phone && term.field === "phone" ? term.phone : term.value}%`);
    }
    return legs.join(",");
  }

  for (const col of FREE_COLUMNS) legs.push(`${col}.ilike.%${term.value}%`);
  if (term.phone) {
    for (const col of FIELD_COLUMNS.phone) legs.push(`${col}.ilike.%${term.phone}%`);
  }
  return legs.join(",");
}

/**
 * Apply a parsed search to a PostgREST query builder.
 *
 * One `.or()` per term, which PostgREST ANDs — the two-axis semantics the box
 * promises. Typed structurally rather than against a Supabase generic so the
 * list route and the export route can share it without agreeing on a row type.
 */
export interface OrFilterable {
  or(filter: string): OrFilterable;
}

export function applySearch<T extends OrFilterable>(query: T, raw: string | undefined): T {
  let out = query;
  for (const term of parseSearch(raw ?? "")) {
    out = out.or(termToOrFilter(term)) as T;
  }
  return out;
}
