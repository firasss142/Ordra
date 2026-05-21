import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A duplicate "sibling" is a distinct order (different external_id) that looks
 * like the same physical order: same normalized phone + same product + same
 * quantity, within a 24h window, same market. Dead orders (cancelled, deleted,
 * rejected, returned) are excluded by the RPC — they carry no re-shipping risk.
 *
 * This is a SEPARATE concern from the repeat-buyer signal (see
 * lib/customer-history/enrich.ts): a duplicate is the same order placed twice,
 * not the same customer ordering different things over time.
 */

/** Shape of a sibling row as returned by get_duplicate_orders_batch. */
export interface RawSibling {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  product_name: string | null;
  quantity: number;
  /** True when the sibling is already shipped to the carrier (re-ship risk). */
  already_shipped: boolean;
}

export type SiblingOrder = RawSibling;

export interface DuplicateEnrichment {
  is_potential_duplicate: boolean;
  duplicate_count: number;
  duplicate_siblings: SiblingOrder[];
  /** True when any sibling is already shipped — gates the upload confirm step. */
  has_uploaded_sibling: boolean;
}

interface EnrichableRow {
  id: string;
  customer_phone?: string | null;
  customer_phone_2?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  created_at?: string | null;
}

interface BatchRow {
  source_id: string;
  duplicate_count: number;
  siblings: RawSibling[] | null;
}

const EMPTY: DuplicateEnrichment = {
  is_potential_duplicate: false,
  duplicate_count: 0,
  duplicate_siblings: [],
  has_uploaded_sibling: false,
};

/**
 * Pure derivation of the enrichment from the raw sibling list. Kept separate
 * from the DB call so it can be unit-tested without Supabase.
 */
export function deriveDuplicateEnrichment(
  siblings: RawSibling[],
): DuplicateEnrichment {
  if (!siblings || siblings.length === 0) {
    return { ...EMPTY, duplicate_siblings: [] };
  }
  return {
    is_potential_duplicate: true,
    duplicate_count: siblings.length,
    duplicate_siblings: siblings,
    has_uploaded_sibling: siblings.some((s) => s.already_shipped),
  };
}

/**
 * Calls get_duplicate_orders_batch once for all rows and returns the same rows
 * with duplicate fields attached. Mirrors enrichRowsWithCustomerHistory's
 * defensive contract: no market / no rows / RPC error / throw → every row gets
 * an EMPTY enrichment so the list never breaks.
 */
export async function enrichRowsWithDuplicates<T extends EnrichableRow>(
  supabase: SupabaseClient,
  marketId: string | null,
  rows: T[],
): Promise<(T & DuplicateEnrichment)[]> {
  if (!marketId || rows.length === 0 || typeof supabase.rpc !== "function") {
    return rows.map((r) => ({ ...r, ...EMPTY }));
  }

  const payload = rows.map((r) => ({
    id: r.id,
    phone: r.customer_phone ?? "",
    phone_2: r.customer_phone_2 ?? "",
    product_id: r.product_id ?? "",
    product_name: r.product_name ?? "",
    quantity: r.quantity ?? 0,
    created_at: r.created_at ?? "",
  }));

  let data: BatchRow[] | null = null;
  try {
    const res = await supabase.rpc("get_duplicate_orders_batch", {
      p_market_id: marketId,
      p_rows: payload,
    });
    if (res.error) {
      return rows.map((r) => ({ ...r, ...EMPTY }));
    }
    data = (res.data ?? null) as BatchRow[] | null;
  } catch {
    return rows.map((r) => ({ ...r, ...EMPTY }));
  }

  if (!data) {
    return rows.map((r) => ({ ...r, ...EMPTY }));
  }

  const byId = new Map<string, BatchRow>();
  for (const b of data) {
    byId.set(b.source_id, b);
  }

  return rows.map((r) => {
    const b = byId.get(r.id);
    if (!b) return { ...r, ...EMPTY };
    return { ...r, ...deriveDuplicateEnrichment(b.siblings ?? []) };
  });
}
