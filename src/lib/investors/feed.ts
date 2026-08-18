import type { SupabaseClient } from "@supabase/supabase-js";
import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import { sharePctOn, type TermsVersion } from "./terms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

/**
 * Per-order event feed for a deal (owner decision: date · event · amounts
 * only — no order ref, city, or customer). Keyset-paginated on
 * (event_date desc, order_id desc). Amounts are the product slice; "yours"
 * applies the share % in force on the event day.
 */

export interface FeedEvent {
  id: string; // `${order_id}:${event}`
  at: string; // event date (local day)
  event: "delivered" | "returned" | "pending_billing";
  is_final: boolean;
  amounts: { revenue: number; cogs: number; delivery: number; return: number; packing: number; processing: number; net: number };
  your_share: number;
  share_pct: number;
}

interface FactRowLite {
  order_id: string;
  outcome: "delivered" | "returned" | null;
  is_final: boolean;
  delivered_date: string | null;
  returned_date: string | null;
  revenue: string | number;
  revenue_gross: string | number;
  cogs: string | number;
  delivery_cost: string | number;
  return_cost: string | number;
  packing_cost: string | number;
  processing_cost: string | number;
  net_contribution: string | number;
}

export function encodeCursor(d: string, orderId: string): string {
  return Buffer.from(`${d}|${orderId}`).toString("base64url");
}
export function decodeCursor(c: string | null): { d: string; orderId: string } | null {
  if (!c) return null;
  try {
    const [d, orderId] = Buffer.from(c, "base64url").toString("utf8").split("|");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !orderId) return null;
    return { d, orderId };
  } catch {
    return null;
  }
}

export async function loadDealFeed(
  admin: Supa,
  params: { productId: string; startDate: string; endDate: string; terms: TermsVersion[]; cursor: string | null; limit: number },
): Promise<{ events: FeedEvent[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  // Pull a page of outcome rows by event date. We order on delivered/returned
  // date via a computed key on the client side after fetching a bounded window.
  const cur = decodeCursor(params.cursor);
  let q = admin
    .from("investor_order_facts")
    .select("order_id, outcome, is_final, delivered_date, returned_date, revenue, revenue_gross, cogs, delivery_cost, return_cost, packing_cost, processing_cost, net_contribution")
    .eq("product_id", params.productId)
    .gte("cohort_date", params.startDate)
    .lte("cohort_date", params.endDate)
    .is("excluded_reason", null)
    .not("outcome", "is", null);
  // Coarse cursor: only rows whose event date <= cursor day (fine filter below).
  if (cur) q = q.or(`delivered_date.lte.${cur.d},returned_date.lte.${cur.d}`);
  q = q.order("order_id", { ascending: false }).limit(limit * 3 + 50);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FactRowLite[];

  const events = rows
    .map((r): FeedEvent | null => {
      const day = r.outcome === "delivered" ? r.delivered_date : r.returned_date;
      if (!day || !r.outcome) return null;
      const pct = sharePctOn(params.terms, day);
      const net = toMillimes(Number(r.net_contribution));
      const ev: FeedEvent["event"] = r.is_final ? r.outcome : "pending_billing";
      return {
        id: `${r.order_id}:${r.outcome}`,
        at: day,
        event: ev,
        is_final: r.is_final,
        amounts: {
          revenue: r.is_final ? Number(r.revenue) : Number(r.revenue_gross),
          cogs: Number(r.cogs),
          delivery: Number(r.delivery_cost),
          return: Number(r.return_cost),
          packing: Number(r.packing_cost),
          processing: Number(r.processing_cost),
          net: Number(r.net_contribution),
        },
        your_share: fromMillimes(Math.round((net * pct) / 100)),
        share_pct: pct,
      };
    })
    .filter((e): e is FeedEvent => e !== null)
    .filter((e) => !cur || e.at < cur.d || (e.at === cur.d && e.id.split(":")[0] < cur.orderId))
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));

  const page = events.slice(0, limit);
  const last = page[page.length - 1];
  const next = events.length > limit && last ? encodeCursor(last.at, last.id.split(":")[0]) : null;
  return { events: page, next_cursor: next };
}
