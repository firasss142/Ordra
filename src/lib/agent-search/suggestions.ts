/**
 * The agent search index — one query, results from every tab.
 *
 * The search field used to exist only on the queue tab and could only see the
 * rows already rendered there. It is now in the shell on every tab, so it has
 * to answer for orders, parcels in delivery and prospects alike.
 *
 * Everything here is pure and synchronous: it runs over the SWR caches the
 * shell has already warmed (`/api/agent/queue`, `/api/delivery/worklist`,
 * `/api/agent/leads/queue`). Matching reuses `lib/queue/search` so the field
 * prefixes ("phone:", "city:", …) and the Arabic/Latin normalisation behave
 * exactly as they do in the queue list — a second matcher here is precisely how
 * two surfaces drift apart.
 */
import type { QueueOrder } from "@/types/queue";
import { parseQuery, normalize, digitsOnly, matchesOrder, type ParsedQuery } from "@/lib/queue/search";

/** Minimum characters before the dropdown says anything. */
export const MIN_QUERY = 2;
/** Per-group cap, so one busy tab cannot bury the others. */
export const GROUP_LIMIT = 5;

export type SuggestionGroupKey = "orders" | "delivery" | "leads";

export interface SuggestionRow {
  id: string;
  /** The customer, which is what an agent searches by. */
  title: string;
  /** Reference · city · phone — whatever the source has. */
  subtitle: string;
  /** Status/situation slug, so the row can wear the same tag as its list. */
  status: string | null;
  amount: number | null;
  currency: string | null;
  href: string;
}

export interface SuggestionGroup {
  key: SuggestionGroupKey;
  rows: SuggestionRow[];
  /** How many matched in total, before the cap. */
  total: number;
}

/** The delivery worklist row, narrowed to the fields the dropdown reads. */
export interface ParcelLike {
  order_id: string;
  customer_name: string | null;
  customer_city: string | null;
  customer_phone: string | null;
  external_id: string | null;
  total_price: number | null;
  bucket: string | null;
}

/** The lead row, likewise narrowed. */
export interface LeadLike {
  id: string;
  customer_name: string | null;
  customer_city: string | null;
  customer_phone: string | null;
  status: string | null;
}

export interface SuggestionSources {
  orders: QueueOrder[];
  parcels: ParcelLike[];
  leads: LeadLike[];
  /** Locale segment for the hrefs; defaults to the current path's. */
  locale?: string;
}

/** Does a free-text haystack match every term? Phones compare as bare digits. */
function matchesText(
  q: ParsedQuery,
  fields: { text: string; phones: string[] },
): boolean {
  if (q.terms.length === 0) return false;
  const hay = normalize(fields.text);
  const phoneDigits = fields.phones.filter(Boolean).map(digitsOnly);
  return q.terms.every((term) => {
    if (hay.includes(term)) return true;
    const d = digitsOnly(term);
    // A local number typed with its leading zero still matches a stored one.
    return d.length >= 3 && phoneDigits.some((p) => p.includes(d.replace(/^0/, "")));
  });
}

/**
 * Rank: an exact phone match first, then a name that starts with the query,
 * then everything else. Within a tier the source order is kept, which is
 * already the queue's own priority sort.
 */
function rank(row: { title: string; phones: string[] }, q: ParsedQuery): number {
  const needle = digitsOnly(q.raw);
  if (needle.length >= 6) {
    const bare = needle.replace(/^0/, "");
    if (row.phones.some((p) => digitsOnly(p).replace(/^0/, "") === bare)) return 0;
  }
  const title = normalize(row.title);
  if (q.terms.length > 0 && title.startsWith(q.terms[0])) return 1;
  return 2;
}

function take<T extends { id: string }>(
  rows: { row: T; score: number }[],
): { rows: T[]; total: number } {
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  return { rows: sorted.slice(0, GROUP_LIMIT).map((r) => r.row), total: rows.length };
}

const joinSub = (...parts: (string | null | undefined)[]) =>
  parts.filter((p) => p && String(p).trim()).join(" · ");

export function buildSuggestions(
  raw: string,
  sources: SuggestionSources,
): SuggestionGroup[] {
  const q = parseQuery(raw);
  if (q.raw.trim().length < MIN_QUERY || q.terms.length === 0) return [];
  const locale = sources.locale ?? "fr";
  const groups: SuggestionGroup[] = [];

  // ── Orders: reuse the queue's own matcher, prefixes and all. ──
  const orderHits = sources.orders
    .filter((o) => matchesOrder(o, q))
    .map((o) => ({
      row: {
        id: o.id,
        title: o.customer_name ?? "",
        subtitle: joinSub(
          o.product_display_name || o.product_name,
          o.customer_city,
          o.customer_phone,
        ),
        status: o.status,
        amount: o.total_price ?? null,
        currency: o.currency ?? null,
        href: `/${locale}/queue?openOrderId=${o.id}`,
      } satisfies SuggestionRow,
      score: rank(
        { title: o.customer_name ?? "", phones: [o.customer_phone, o.customer_phone_2 ?? ""] },
        q,
      ),
    }));
  if (orderHits.length) {
    const { rows, total } = take(orderHits);
    groups.push({ key: "orders", rows, total });
  }

  // ── Delivery: parcels already past the carrier hand-off. ──
  const parcelHits = sources.parcels
    .filter((p) =>
      matchesText(q, {
        text: [p.customer_name, p.customer_city, p.external_id].filter(Boolean).join(" "),
        phones: [p.customer_phone ?? ""],
      }),
    )
    .map((p) => ({
      row: {
        id: p.order_id,
        title: p.customer_name ?? "",
        subtitle: joinSub(p.external_id ? `#${p.external_id}` : null, p.customer_city, p.customer_phone),
        status: p.bucket,
        amount: p.total_price ?? null,
        currency: null,
        href: `/${locale}/delivery?open=${p.order_id}`,
      } satisfies SuggestionRow,
      score: rank({ title: p.customer_name ?? "", phones: [p.customer_phone ?? ""] }, q),
    }));
  if (parcelHits.length) {
    const { rows, total } = take(parcelHits);
    groups.push({ key: "delivery", rows, total });
  }

  // ── Prospects. ──
  const leadHits = sources.leads
    .filter((l) =>
      matchesText(q, {
        text: [l.customer_name, l.customer_city].filter(Boolean).join(" "),
        phones: [l.customer_phone ?? ""],
      }),
    )
    .map((l) => ({
      row: {
        id: l.id,
        title: l.customer_name ?? "",
        subtitle: joinSub(l.customer_city, l.customer_phone),
        status: l.status,
        amount: null,
        currency: null,
        href: `/${locale}/leads/${l.id}`,
      } satisfies SuggestionRow,
      score: rank({ title: l.customer_name ?? "", phones: [l.customer_phone ?? ""] }, q),
    }));
  if (leadHits.length) {
    const { rows, total } = take(leadHits);
    groups.push({ key: "leads", rows, total });
  }

  return groups;
}
