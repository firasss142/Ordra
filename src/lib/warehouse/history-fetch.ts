import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeWarehouseHistoryCursor,
  encodeWarehouseHistoryCursor,
  type WarehouseHistoryKindCursor,
  type WarehouseHistoryQuery,
} from "./list-filters";

export interface WarehouseHistoryRow {
  kind: "print" | "scan" | "return";
  id: string;
  order_id: string | null;
  at: string;
  detail: string;
  is_damaged?: boolean;
  is_reprint?: boolean;
}

export interface WarehouseHistoryPage {
  rows: WarehouseHistoryRow[];
  nextCursor: string | null;
}

interface PrintRow {
  id: string;
  order_id: string | null;
  is_reprint: boolean | null;
  created_at: string;
  orders: {
    order_number?: string | null;
    customer_name?: string | null;
    customer_city?: string | null;
  } | null;
}

interface InvRow {
  id: string;
  order_id: string | null;
  reason: string;
  created_at: string;
  is_damaged: boolean | null;
  products: { name?: string | null } | null;
  orders: {
    order_number?: string | null;
    customer_name?: string | null;
    customer_city?: string | null;
  } | null;
}

function toKindCursor(kind: "print" | "scan" | "return"): WarehouseHistoryKindCursor {
  return kind === "print" ? "print" : "scan";
}

export async function getWarehouseHistoryPage(
  supabase: SupabaseClient,
  q: WarehouseHistoryQuery,
  scopeMarket: string | null,
): Promise<WarehouseHistoryPage> {
  const cursor = q.cursor ? decodeWarehouseHistoryCursor(q.cursor) : null;
  const includePrints = q.kind === "all" || q.kind === "print";
  const includeScans = q.kind === "all" || q.kind === "scan" || q.kind === "return";
  const bothStreams = includePrints && includeScans;
  const fetchLimit = bothStreams ? q.limit * 2 + 1 : q.limit + 1;

  const printsPromise = (async () => {
    if (!includePrints) return { data: [] as PrintRow[] };
    let qb = supabase
      .from("label_prints")
      .select("id, order_id, is_reprint, created_at, orders(order_number, customer_name, customer_city)")
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (scopeMarket) qb = qb.eq("market_id", scopeMarket);
    if (cursor) qb = qb.lte("created_at", cursor.createdAt);
    if (q.date_from) qb = qb.gte("created_at", q.date_from);
    if (q.date_to) qb = qb.lte("created_at", q.date_to + "T23:59:59.999Z");
    if (q.q) {
      const like = `%${q.q}%`;
      qb = qb.or(`order_number.ilike.${like},customer_name.ilike.${like}`, {
        foreignTable: "orders",
      });
    }
    const { data } = await qb;
    return { data: (data ?? []) as unknown as PrintRow[] };
  })();

  const scansPromise = (async () => {
    if (!includeScans) return { data: [] as InvRow[] };
    const scanReasons =
      q.kind === "scan"
        ? ["scanned"]
        : q.kind === "return"
          ? ["returned", "damaged_writeoff"]
          : ["scanned", "returned", "damaged_writeoff"];
    let qb = supabase
      .from("inventory_log")
      .select("id, order_id, reason, created_at, is_damaged, products!inner(market_id, name), orders(order_number, customer_name, customer_city)")
      .in("reason", scanReasons)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (scopeMarket) qb = qb.eq("products.market_id", scopeMarket);
    if (cursor) qb = qb.lte("created_at", cursor.createdAt);
    if (q.date_from) qb = qb.gte("created_at", q.date_from);
    if (q.date_to) qb = qb.lte("created_at", q.date_to + "T23:59:59.999Z");
    if (q.q) {
      const like = `%${q.q}%`;
      qb = qb.or(`order_number.ilike.${like},customer_name.ilike.${like}`, {
        foreignTable: "orders",
      });
    }
    const { data } = await qb;
    return { data: (data ?? []) as unknown as InvRow[] };
  })();

  const [{ data: prints }, { data: scans }] = await Promise.all([
    printsPromise,
    scansPromise,
  ]);

  const printRows: WarehouseHistoryRow[] = prints.map((p) => ({
    kind: "print" as const,
    id: p.id,
    order_id: p.order_id,
    at: p.created_at,
    detail:
      [
        p.orders?.order_number ? `#${p.orders.order_number}` : null,
        p.orders?.customer_name,
        p.orders?.customer_city,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    is_reprint: !!p.is_reprint,
  }));

  const scanRows: WarehouseHistoryRow[] = scans.map((s) => {
    const isReturn = s.reason === "returned" || s.reason === "damaged_writeoff";
    return {
      kind: isReturn ? ("return" as const) : ("scan" as const),
      id: s.id,
      order_id: s.order_id,
      at: s.created_at,
      detail:
        [
          s.orders?.order_number ? `#${s.orders.order_number}` : null,
          s.products?.name,
          s.orders?.customer_name,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      is_damaged: s.reason === "damaged_writeoff",
    };
  });

  const merged = [...printRows, ...scanRows]
    .filter((r) => {
      if (!cursor) return true;
      if (r.at < cursor.createdAt) return true;
      if (r.at > cursor.createdAt) return false;
      const rowKind = toKindCursor(r.kind);
      if (rowKind > cursor.kind) return false;
      if (rowKind < cursor.kind) return true;
      return r.id < cursor.id;
    })
    .sort((a, b) => {
      if (a.at === b.at) {
        const ak = toKindCursor(a.kind);
        const bk = toKindCursor(b.kind);
        if (ak === bk) return b.id.localeCompare(a.id);
        return ak < bk ? 1 : -1;
      }
      return a.at < b.at ? 1 : -1;
    });

  const pageRows = merged.slice(0, q.limit);
  let nextCursor: string | null = null;
  if (merged.length > q.limit) {
    const last = pageRows[pageRows.length - 1];
    if (last) {
      nextCursor = encodeWarehouseHistoryCursor({
        createdAt: last.at,
        kind: toKindCursor(last.kind),
        id: last.id,
      });
    }
  }

  return { rows: pageRows, nextCursor };
}
