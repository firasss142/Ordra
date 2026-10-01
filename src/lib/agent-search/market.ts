/**
 * The agent's search over the WHOLE market — server side.
 *
 * An agent's RLS lets them read only the orders assigned to them, and the
 * search bar used to search only the lists the shell had already loaded. So an
 * order held by a colleague, or not yet distributed, could not be found at all
 * — and in Libya that is the common case: 79 of 128 repeat customers (60 days,
 * measured 2026-10-01) have their orders spread over different agents.
 *
 * This runs with the service-role client, so it — not RLS — is what keeps an
 * agent inside their market: `marketId` comes from the session (getActor),
 * never from the request. What it returns is deliberately narrow: a fixed
 * column list, at most MARKET_SEARCH_LIMIT rows, no pagination. Widening the
 * agent's RLS instead would have let any agent pull the market's whole customer
 * list with one REST call. See plans/agent-market-search.md (D1–D5).
 *
 * Matching is lib/orders/search-query's — the same parser as the manager's
 * Orders page, so phone formats, prefixes and Arabic spellings mean the same
 * thing on both screens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySearch, parseSearch, toNationalDigits } from "@/lib/orders/search-query";

/** Below this the query is too vague to be worth a round trip. */
export const MARKET_SEARCH_MIN = 3;
/** What the dropdown shows. `total` says how many more there were. */
export const MARKET_SEARCH_LIMIT = 8;
/** Rows ranked before cutting to the limit. */
const FETCH_LIMIT = 50;

/**
 * Decision D1 (plans/agent-market-search.md): other agents' orders are found,
 * read-only, with the owner's first name. `false` restricts the search to the
 * agent's own orders and the unassigned ones.
 */
export const SHOW_OTHER_AGENTS_ORDERS = true;

/**
 * Every column the search may hand an agent about an order that is not theirs.
 * No cost, margin or webhook payload — and never `*`.
 */
export const MARKET_SEARCH_SELECT =
  "id, external_id, status, assigned_to, customer_name, customer_phone, customer_phone_2, customer_city, customer_address, product_name, variant_label, total_price, currency, tracking_number, created_at, archived_at";

export type OrderOwner = "me" | "none" | "other";
export type OrderAccess = "full" | "view";

export interface MarketSearchRow {
  id: string;
  external_id: string | null;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  customer_city: string | null;
  customer_address: string | null;
  product_name: string | null;
  variant_label: string | null;
  total_price: number | null;
  currency: string | null;
  tracking_number: string | null;
  created_at: string;
  archived: boolean;
  owner: OrderOwner;
  /** First name of the agent who holds it, when that is someone else. */
  owner_name: string | null;
  /** Only the agent's own orders open with their usual rights. */
  access: OrderAccess;
}

export interface MarketSearchResult {
  rows: MarketSearchRow[];
  total: number;
}

const CLOSED = new Set(["delivered", "returned", "rejected", "cancelled"]);

interface Rankable {
  status: string;
  created_at: string;
  assigned_to: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  external_id: string | null;
  tracking_number: string | null;
}

/**
 * Most likely first: an exact phone, then an exact reference or tracking
 * number, then the agent's own orders, then open before closed, then newest.
 * A deleted order is last whatever it matched — it is the answer to "I ordered
 * and nobody called", not the order to act on.
 */
export function rankMarketRows<T extends Rankable>(rows: T[], raw: string, meId: string): T[] {
  const typed = raw.trim();
  const digits = /^[+\d][\d\s\-.()]*$/.test(typed) && typed.replace(/\D/g, "").length >= 6
    ? toNationalDigits(typed)
    : null;
  const ref = typed.replace(/^#/, "").toLowerCase();

  const key = (r: T): number[] => {
    const exactPhone =
      digits !== null &&
      [r.customer_phone, r.customer_phone_2].some((p) => p && toNationalDigits(p) === digits);
    const exactRef = [r.external_id, r.tracking_number].some((v) => v && v.toLowerCase() === ref);
    return [
      r.status === "deleted" ? 1 : 0,
      exactPhone ? 0 : 1,
      exactRef ? 0 : 1,
      r.assigned_to === meId ? 0 : 1,
      CLOSED.has(r.status) ? 1 : 0,
      -Date.parse(r.created_at),
    ];
  };

  return rows
    .map((row) => ({ row, k: key(row) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
      return 0;
    })
    .map(({ row }) => row);
}

type OrderRow = Omit<MarketSearchRow, "archived" | "owner" | "owner_name" | "access"> & {
  assigned_to: string | null;
  archived_at: string | null;
};

export async function searchMarketOrders(
  client: SupabaseClient,
  opts: { marketId: string; meId: string; raw: string; showOthers?: boolean },
): Promise<MarketSearchResult> {
  const raw = (opts.raw ?? "").trim();
  if (raw.length < MARKET_SEARCH_MIN || parseSearch(raw).length === 0) return { rows: [], total: 0 };

  let query = client
    .from("orders")
    .select(MARKET_SEARCH_SELECT, { count: "exact" })
    .eq("market_id", opts.marketId);
  if (!(opts.showOthers ?? SHOW_OTHER_AGENTS_ORDERS)) {
    query = query.or(`assigned_to.is.null,assigned_to.eq.${opts.meId}`);
  }
  query = applySearch(query, raw);

  const { data, count, error } = await query.order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (error) throw new Error(error.message);

  const ranked = rankMarketRows((data ?? []) as OrderRow[], raw, opts.meId).slice(0, MARKET_SEARCH_LIMIT);

  const holders = [...new Set(ranked.map((r) => r.assigned_to).filter((id): id is string => !!id && id !== opts.meId))];
  const firstNames = new Map<string, string>();
  if (holders.length > 0) {
    const { data: users } = await client.from("users").select("id, full_name").in("id", holders);
    for (const u of (users ?? []) as { id: string; full_name: string | null }[]) {
      const first = (u.full_name ?? "").trim().split(/\s+/)[0];
      if (first) firstNames.set(u.id, first);
    }
  }

  // Field by field, never a spread: what leaves this function is the list
  // below, whatever the query happened to return.
  const rows = ranked.map((o): MarketSearchRow => {
    const { assigned_to } = o;
    const owner: OrderOwner = assigned_to === opts.meId ? "me" : assigned_to ? "other" : "none";
    return {
      id: o.id,
      external_id: o.external_id,
      status: o.status,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      customer_phone_2: o.customer_phone_2,
      customer_city: o.customer_city,
      customer_address: o.customer_address,
      product_name: o.product_name,
      variant_label: o.variant_label,
      total_price: o.total_price,
      currency: o.currency,
      tracking_number: o.tracking_number,
      created_at: o.created_at,
      archived: o.archived_at !== null && o.archived_at !== undefined,
      owner,
      owner_name: owner === "other" ? firstNames.get(assigned_to!) ?? null : null,
      access: owner === "me" ? "full" : "view",
    };
  });

  return { rows, total: count ?? rows.length };
}
