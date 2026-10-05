/**
 * The agent search index — one query, results from every tab and the market.
 *
 * The search field used to exist only on the queue tab and could only see the
 * rows already rendered there. It is now in the shell on every tab, so it has
 * to answer for orders, parcels in delivery and prospects alike — and, since
 * 2026-10-01, for every order of the agent's market (lib/agent-search/market).
 *
 * Two speeds. The agent's own lists are matched here, synchronously, over the
 * SWR caches the shell has already warmed (`/api/agent/queue`,
 * `/api/delivery/worklist`, `/api/agent/leads/queue`) — instant. The market
 * arrives ~250 ms later from `/api/agent/search` and is merged by order id: an
 * own order the caches lacked joins the agent's groups, and everyone else's
 * forms the read-only « market » group, in the server's ranking. The server
 * read every phone format and spelling, so its matches are trusted as given.
 *
 * Local matching reuses `lib/queue/search` so the field prefixes ("phone:",
 * "city:", …) and the Arabic/Latin normalisation behave exactly as they do in
 * the queue list — a second matcher here is precisely how two surfaces drift
 * apart.
 */
import type { QueueOrder } from "@/types/queue";
import { parseQuery, normalize, digitsOnly, matchesOrder, type ParsedQuery } from "@/lib/queue/search";
import { parseSearch, toNationalDigits, type SearchField } from "@/lib/orders/search-query";
import type { MarketSearchRow } from "./market";

/** Minimum characters before the dropdown says anything. */
export const MIN_QUERY = 2;
/** Per-group cap, so one busy tab cannot bury the others. */
export const GROUP_LIMIT = 5;

export type SuggestionGroupKey = "orders" | "delivery" | "market" | "leads";

export interface SuggestionRow {
  id: string;
  /** The customer, which is what an agent searches by. */
  title: string;
  /** The subtitle pieces — product · city · phone, plus whatever matched. */
  parts: string[];
  /** `parts` joined, for plain-text uses. */
  subtitle: string;
  /** Status/situation slug, so the row can wear the same tag as its list. */
  status: string | null;
  amount: number | null;
  currency: string | null;
  /** Where choosing the row navigates. Empty on a view-only row, which opens the preview. */
  href: string;
  /** The order reference, when the source carries it. */
  ref?: string | null;
  /** Not the agent's: opens read-only. */
  view?: boolean;
  owner?: "none" | "other";
  /** First name of the colleague who holds it. */
  ownerName?: string | null;
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
  /** The server's market results for this query, already ranked. */
  market?: MarketSearchRow[];
  /** How many orders the server matched in all, mine included. */
  marketTotal?: number;
  /** Locale segment for the hrefs; defaults to the current path's. */
  locale?: string;
}

/** What the box understood, for the chip at the top of the results. */
export type QueryIntent =
  | { kind: "number" }
  | { kind: "field"; field: SearchField }
  | { kind: "text" }
  | null;

export function queryIntent(raw: string): QueryIntent {
  const terms = parseSearch(raw ?? "");
  if (terms.length === 0) return null;
  if (terms[0].field) return { kind: "field", field: terms[0].field };
  if (terms.every((t) => t.phone)) return { kind: "number" };
  return { kind: "text" };
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

type Hit = { row: SuggestionRow; score: number };

function take<T extends { id: string }>(
  rows: { row: T; score: number }[],
): { rows: T[]; total: number } {
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  return { rows: sorted.slice(0, GROUP_LIMIT).map((r) => r.row), total: rows.length };
}

const clean = (...parts: (string | null | undefined)[]): string[] =>
  parts.filter((p): p is string => !!p && !!String(p).trim());

/**
 * The subtitle of a market row, plus the field that explains the match when
 * the row would not otherwise show it: a hit only in the address, the tracking
 * number or the second phone would look like a false positive.
 */
function marketParts(r: MarketSearchRow, q: ParsedQuery, raw: string): string[] {
  const product = r.variant_label ? `${r.product_name ?? ""} · ${r.variant_label}` : r.product_name;
  const parts = clean(product, r.customer_city, r.customer_phone);

  const typed = raw.trim();
  if (/^[+\d][\d\s\-.()]*$/.test(typed) && typed.replace(/\D/g, "").length >= 3) {
    const needle = toNationalDigits(typed);
    const has = (v: string | null) => !!v && v.replace(/\D/g, "").length >= 3 && toNationalDigits(v).includes(needle);
    if (!has(r.customer_phone) && has(r.customer_phone_2)) parts.push(r.customer_phone_2!);
    if (has(r.tracking_number)) parts.push(r.tracking_number!);
    return parts;
  }

  const shown = normalize([r.customer_name, r.product_name, r.variant_label, r.customer_city].join(" "));
  const unseen = q.terms.filter((t) => !shown.includes(t));
  if (unseen.some((t) => normalize(r.customer_address ?? "").includes(t))) parts.push(r.customer_address!);
  if (unseen.some((t) => normalize(r.tracking_number ?? "").includes(t))) parts.push(r.tracking_number!);
  return parts;
}

export function buildSuggestions(
  raw: string,
  sources: SuggestionSources,
): SuggestionGroup[] {
  const q = parseQuery(raw);
  if (q.raw.trim().length < MIN_QUERY || q.terms.length === 0) return [];
  const locale = sources.locale ?? "fr";
  const market = sources.market ?? [];

  // ── Orders: reuse the queue's own matcher, prefixes and all. ──
  const orderHits: Hit[] = sources.orders
    .filter((o) => matchesOrder(o, q))
    .map((o) => {
      const parts = clean(o.product_display_name || o.product_name, o.customer_city, o.customer_phone);
      return {
        row: {
          id: o.id,
          title: o.customer_name ?? "",
          parts,
          subtitle: parts.join(" · "),
          status: o.status,
          amount: o.total_price ?? null,
          currency: o.currency ?? null,
          href: `/${locale}/queue?openOrderId=${o.id}`,
        } satisfies SuggestionRow,
        score: rank(
          { title: o.customer_name ?? "", phones: [o.customer_phone, o.customer_phone_2 ?? ""] },
          q,
        ),
      };
    });

  // ── Delivery: parcels already past the carrier hand-off. ──
  const parcelHits: Hit[] = sources.parcels
    .filter((p) =>
      matchesText(q, {
        text: [p.customer_name, p.customer_city, p.external_id].filter(Boolean).join(" "),
        phones: [p.customer_phone ?? ""],
      }),
    )
    .map((p) => {
      const parts = clean(p.external_id ? `#${p.external_id}` : null, p.customer_city, p.customer_phone);
      return {
        row: {
          id: p.order_id,
          title: p.customer_name ?? "",
          parts,
          subtitle: parts.join(" · "),
          status: p.bucket,
          amount: p.total_price ?? null,
          currency: null,
          href: `/${locale}/delivery?open=${p.order_id}`,
        } satisfies SuggestionRow,
        score: rank({ title: p.customer_name ?? "", phones: [p.customer_phone ?? ""] }, q),
      };
    });

  // ── The agent's own orders the server found but the caches had not. ──
  // A parcel the worklist holds opens on /delivery; anything else on the queue
  // panel, which opens any of the agent's orders by id. They rank after the
  // local hits, in the server's order.
  const parcelIds = new Set(sources.parcels.map((p) => p.order_id));
  const listed = new Set([...orderHits, ...parcelHits].map((h) => h.row.id));
  for (const r of market) {
    if (r.access !== "full" || listed.has(r.id)) continue;
    listed.add(r.id);
    const parts = marketParts(r, q, raw);
    const row: SuggestionRow = {
      id: r.id,
      title: r.customer_name ?? "",
      parts,
      subtitle: parts.join(" · "),
      status: r.status,
      amount: r.total_price,
      currency: r.currency,
      ref: r.external_id,
      href: parcelIds.has(r.id) ? `/${locale}/delivery?open=${r.id}` : `/${locale}/queue?openOrderId=${r.id}`,
    };
    (parcelIds.has(r.id) ? parcelHits : orderHits).push({ row, score: 3 });
  }

  const groups: SuggestionGroup[] = [];
  if (orderHits.length) groups.push({ key: "orders", ...take(orderHits) });
  if (parcelHits.length) groups.push({ key: "delivery", ...take(parcelHits) });

  // ── Everyone else's: read-only, in the server's ranking. ──
  const others = market.filter((r) => r.access === "view");
  if (others.length) {
    const own = market.length - others.length;
    groups.push({
      key: "market",
      rows: others.slice(0, GROUP_LIMIT).map((r) => {
        const parts = marketParts(r, q, raw);
        return {
          id: r.id,
          title: r.customer_name ?? "",
          parts,
          subtitle: parts.join(" · "),
          status: r.status,
          amount: r.total_price,
          currency: r.currency,
          href: "",
          ref: r.external_id,
          view: true,
          owner: r.owner === "other" ? "other" : "none",
          ownerName: r.owner_name,
        } satisfies SuggestionRow;
      }),
      total: Math.max(others.length, (sources.marketTotal ?? market.length) - own),
    });
  }

  // ── Prospects. ──
  const leadHits: Hit[] = sources.leads
    .filter((l) =>
      matchesText(q, {
        text: [l.customer_name, l.customer_city].filter(Boolean).join(" "),
        phones: [l.customer_phone ?? ""],
      }),
    )
    .map((l) => {
      const parts = clean(l.customer_city, l.customer_phone);
      return {
        row: {
          id: l.id,
          title: l.customer_name ?? "",
          parts,
          subtitle: parts.join(" · "),
          status: l.status,
          amount: null,
          currency: null,
          href: `/${locale}/leads?open=${l.id}`,
        } satisfies SuggestionRow,
        score: rank({ title: l.customer_name ?? "", phones: [l.customer_phone ?? ""] }, q),
      };
    });
  if (leadHits.length) groups.push({ key: "leads", ...take(leadHits) });

  return groups;
}
