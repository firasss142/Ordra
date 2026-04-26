import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRepeatKind, type RepeatKind } from "./classify";

export type SourceKind = "order" | "lead";

interface EnrichableRow {
  id: string;
  customer_phone?: string | null;
  customer_phone_2?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
}

interface BatchRow {
  source_id: string;
  prior_order_count: number;
  prior_lead_count: number;
  prior_delivered_count: number;
  prior_returned_count: number;
  prior_rejected_count: number;
  phone_matched: boolean;
  last_known_address: string | null;
}

export interface RepeatBuyerEnrichment {
  repeat_kind: RepeatKind;
  prior_order_count: number;
  prior_lead_count: number;
  prior_rejected_count: number;
  last_known_address: string | null;
}

const EMPTY: RepeatBuyerEnrichment = {
  repeat_kind: "none",
  prior_order_count: 0,
  prior_lead_count: 0,
  prior_rejected_count: 0,
  last_known_address: null,
};

/**
 * Calls get_customer_history_batch once for all rows and returns the same
 * rows with repeat-buyer fields attached. Rows from a different market
 * (or with no market) are returned unchanged.
 */
export async function enrichRowsWithCustomerHistory<T extends EnrichableRow>(
  supabase: SupabaseClient,
  marketId: string | null,
  source: SourceKind,
  rows: T[],
): Promise<(T & RepeatBuyerEnrichment)[]> {
  if (!marketId || rows.length === 0 || typeof supabase.rpc !== "function") {
    return rows.map((r) => ({ ...r, ...EMPTY }));
  }

  const payload = rows.map((r) => ({
    id: r.id,
    source,
    phone: r.customer_phone ?? "",
    phone_2: r.customer_phone_2 ?? "",
    name: r.customer_name ?? "",
    address: r.customer_address ?? "",
    city: r.customer_city ?? "",
  }));

  let data: BatchRow[] | null = null;
  try {
    const res = await supabase.rpc("get_customer_history_batch", {
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
  for (const b of data as BatchRow[]) {
    byId.set(b.source_id, b);
  }

  return rows.map((r) => {
    const b = byId.get(r.id);
    if (!b) return { ...r, ...EMPTY };
    const repeat_kind = classifyRepeatKind({
      priorOrderCount: b.prior_order_count,
      priorLeadCount: b.prior_lead_count,
      phoneMatched: b.phone_matched,
      outcomes: {
        delivered: b.prior_delivered_count,
        returned: b.prior_returned_count,
        rejected: b.prior_rejected_count,
      },
    });
    return {
      ...r,
      repeat_kind,
      prior_order_count: b.prior_order_count,
      prior_lead_count: b.prior_lead_count,
      prior_rejected_count: b.prior_rejected_count,
      last_known_address: b.last_known_address,
    };
  });
}
