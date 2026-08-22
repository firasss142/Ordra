import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeWarehouseHistoryCursor,
  encodeWarehouseHistoryCursor,
  type WarehouseHistoryKindCursor,
  type WarehouseHistoryQuery,
} from "./list-filters";

export type WarehouseAnomalyTag =
  | "volume_outlier"
  | "damage_concentration"
  | "post_scan_adjustment";

export interface WarehouseActor {
  id: string;
  full_name: string | null;
  role: "super_admin" | "market_manager" | "warehouse_agent" | "agent" | null;
  avatar_url: string | null;
}

export interface WarehouseHistoryRow {
  kind: "print" | "scan" | "handover" | "return" | "adjust" | "writeoff";
  id: string;
  order_id: string | null;
  order_number: string | null;
  product_id: string | null;
  product_name: string | null;
  qty_change: number | null;
  balance_after: number | null;
  at: string;
  detail: string;
  is_damaged: boolean;
  is_reprint: boolean;
  note: string | null;
  actor: WarehouseActor | null;
  anomalies: WarehouseAnomalyTag[];
}

export interface WarehouseHistoryPage {
  rows: WarehouseHistoryRow[];
  nextCursor: string | null;
}

interface ActorRow {
  id: string;
  full_name: string | null;
  role: string | null;
  avatar_url: string | null;
}

interface PrintRow {
  id: string;
  order_id: string | null;
  is_reprint: boolean | null;
  created_at: string;
  printed_by: string | null;
  orders: {
    order_number?: string | null;
    customer_name?: string | null;
    customer_city?: string | null;
  } | null;
  actor: ActorRow | null;
}

/**
 * A handover is a status change, not a stock movement: the units left the
 * shelf at scan-out. So it comes from order_history, carries no delta, and
 * shows a solde of "—" in the ledger.
 */
interface HandoverRow {
  id: string;
  order_id: string;
  created_at: string;
  actor_id: string | null;
  orders: {
    order_number?: string | null;
    customer_name?: string | null;
    customer_city?: string | null;
    product_name?: string | null;
  } | null;
  actor: ActorRow | null;
}

interface InvRow {
  id: string;
  order_id: string | null;
  reason: string;
  change: number | null;
  balance_after: number | null;
  created_at: string;
  is_damaged: boolean | null;
  note: string | null;
  actor_id: string | null;
  product_id: string | null;
  products: { name?: string | null; market_id?: string | null } | null;
  orders: {
    order_number?: string | null;
    customer_name?: string | null;
    customer_city?: string | null;
  } | null;
  actor: ActorRow | null;
}

function toKindCursor(kind: WarehouseHistoryRow["kind"]): WarehouseHistoryKindCursor {
  if (kind === "print") return "print";
  if (kind === "handover") return "handover";
  return "scan";
}

function safeRole(r: string | null): WarehouseActor["role"] {
  if (r === "super_admin" || r === "market_manager" || r === "warehouse_agent" || r === "agent") return r;
  return null;
}

function mapActor(actorRaw: ActorRow | null): WarehouseActor | null {
  return actorRaw
    ? { id: actorRaw.id, full_name: actorRaw.full_name, role: safeRole(actorRaw.role), avatar_url: actorRaw.avatar_url }
    : null;
}

async function detectAnomalies(
  supabase: SupabaseClient,
  rows: WarehouseHistoryRow[],
  scopeMarket: string | null,
): Promise<WarehouseHistoryRow[]> {
  if (rows.length === 0) return rows;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenStr = fourteenDaysAgo.toISOString();

  // --- Volume outlier: per-actor daily counts for last 14 days ---
  // When scoped by market, pre-fetch actor IDs in this market to filter the volume query
  let scopedActorIds: string[] | null = null;
  if (scopeMarket) {
    const { data: marketActors } = await supabase
      .from("inventory_log")
      .select("actor_id, products!inner(market_id)")
      .eq("products.market_id", scopeMarket)
      .not("actor_id", "is", null)
      .gte("created_at", fourteenStr);
    scopedActorIds = [...new Set((marketActors ?? []).map((r: { actor_id: string | null }) => r.actor_id).filter(Boolean))] as string[];
    if (scopedActorIds.length === 0) {
      return rows.map((row) => ({ ...row, anomalies: [] as WarehouseAnomalyTag[] }));
    }
  }

  let volumeQuery = supabase
    .from("inventory_log")
    .select("actor_id, created_at")
    .gte("created_at", fourteenStr)
    .not("actor_id", "is", null);
  if (scopedActorIds) volumeQuery = volumeQuery.in("actor_id", scopedActorIds);
  const { data: volumeData } = await volumeQuery;

  // Group row counts by actor+day to compute per-day totals
  const actorDayMap = new Map<string, Map<string, number>>();
  const actorTodayCounts = new Map<string, number>();
  for (const v of volumeData ?? []) {
    if (!v.actor_id) continue;
    const d = new Date(v.created_at);
    d.setHours(0, 0, 0, 0);
    const isToday = d >= today;
    if (isToday) {
      actorTodayCounts.set(v.actor_id, (actorTodayCounts.get(v.actor_id) ?? 0) + 1);
    } else {
      const dayKey = d.toISOString().slice(0, 10);
      const dayMap = actorDayMap.get(v.actor_id) ?? new Map<string, number>();
      dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + 1);
      actorDayMap.set(v.actor_id, dayMap);
    }
  }

  const outlierActors = new Set<string>();
  for (const [actorId, todayCount] of actorTodayCounts) {
    const historicalDays = actorDayMap.get(actorId);
    if (!historicalDays || historicalDays.size === 0) continue;
    const dailyCounts = [...historicalDays.values()].sort((a, b) => a - b);
    const median = dailyCounts[Math.floor(dailyCounts.length / 2)];
    if (todayCount > 3 * median) outlierActors.add(actorId);
  }

  // --- Damage concentration: product share of today's damage ---
  const todayDamageRows = rows.filter(
    (r) => (r.kind === "return" || r.kind === "writeoff") && r.is_damaged && r.at >= todayStr,
  );
  const damageConcentrationProducts = new Set<string>();
  if (todayDamageRows.length >= 5) {
    const productCounts = new Map<string, number>();
    for (const r of todayDamageRows) {
      if (r.product_id) productCounts.set(r.product_id, (productCounts.get(r.product_id) ?? 0) + 1);
    }
    for (const [pid, cnt] of productCounts) {
      if (cnt / todayDamageRows.length >= 0.8) damageConcentrationProducts.add(pid);
    }
  }

  // --- Post-scan adjustment: manual_adjustment within 2h of a scan on same product ---
  const adjustRows = rows.filter((r) => r.kind === "adjust" && r.qty_change !== null && r.qty_change < 0);
  const postScanAdjustIds = new Set<string>();
  if (adjustRows.length > 0) {
    const productIds = [...new Set(adjustRows.map((r) => r.product_id).filter(Boolean))] as string[];
    if (productIds.length > 0) {
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
      const { data: recentScans } = await supabase
        .from("inventory_log")
        .select("product_id, created_at")
        .eq("reason", "scanned")
        .in("product_id", productIds)
        .gte("created_at", twoHoursAgo.toISOString());

      const recentScanProductSet = new Set((recentScans ?? []).map((s: { product_id: string | null }) => s.product_id).filter(Boolean));
      for (const r of adjustRows) {
        if (r.product_id && recentScanProductSet.has(r.product_id)) {
          postScanAdjustIds.add(r.id);
        }
      }
    }
  }

  return rows.map((row) => {
    const anomalies: WarehouseAnomalyTag[] = [];
    if (row.actor?.id && outlierActors.has(row.actor.id)) anomalies.push("volume_outlier");
    if (row.product_id && damageConcentrationProducts.has(row.product_id)) anomalies.push("damage_concentration");
    if (postScanAdjustIds.has(row.id)) anomalies.push("post_scan_adjustment");
    return anomalies.length > 0 ? { ...row, anomalies } : row;
  });
}

export async function getWarehouseHistoryPage(
  supabase: SupabaseClient,
  q: WarehouseHistoryQuery,
  scopeMarket: string | null,
): Promise<WarehouseHistoryPage> {
  const cursor = q.cursor ? decodeWarehouseHistoryCursor(q.cursor) : null;

  const kindSet = q.kind;
  const includePrints = kindSet === "all" || kindSet === "print";
  const includeHandovers = kindSet === "all" || kindSet === "handover";
  const includeInventory = kindSet !== "print" && kindSet !== "handover";
  const streams = [includePrints, includeHandovers, includeInventory].filter(Boolean).length;
  const fetchLimit = streams > 1 ? q.limit * streams + 1 : q.limit + 1;

  // Determine which inventory reasons to include
  const scanReasons: string[] = [];
  if (kindSet === "all") {
    scanReasons.push("scanned", "returned", "damaged_writeoff", "manual_adjustment");
  } else if (kindSet === "scan") {
    scanReasons.push("scanned");
  } else if (kindSet === "return") {
    scanReasons.push("returned", "damaged_writeoff");
  } else if (kindSet === "adjust") {
    scanReasons.push("manual_adjustment");
  } else if (kindSet === "writeoff") {
    scanReasons.push("damaged_writeoff");
  }

  const printsPromise = (async () => {
    if (!includePrints) return { data: [] as PrintRow[] };
    let qb = supabase
      .from("label_prints")
      .select("id, order_id, is_reprint, created_at, printed_by, orders(order_number, customer_name, customer_city), actor:users!printed_by(id, full_name, role, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (scopeMarket) qb = qb.eq("market_id", scopeMarket);
    if (cursor) qb = qb.lte("created_at", cursor.createdAt);
    if (q.date_from) qb = qb.gte("created_at", q.date_from);
    if (q.date_to) qb = qb.lte("created_at", q.date_to + "T23:59:59.999Z");
    if (q.actor_id) qb = qb.eq("printed_by", q.actor_id);
    if (q.product_id) return { data: [] as PrintRow[] }; // prints have no product
    if (q.q) {
      const like = `%${q.q}%`;
      qb = qb.or(`order_number.ilike.${like},customer_name.ilike.${like}`, {
        foreignTable: "orders",
      });
    }
    const { data } = await qb;
    return { data: (data ?? []) as unknown as PrintRow[] };
  })();

  const handoversPromise = (async () => {
    // Filters that only make sense for stock rows exclude this stream
    // entirely rather than silently returning unfiltered handovers.
    if (!includeHandovers || q.product_id) return { data: [] as HandoverRow[] };
    let qb = supabase
      .from("order_history")
      .select("id, order_id, created_at, actor_id, orders(order_number, customer_name, customer_city, product_name), actor:users!actor_id(id, full_name, role, avatar_url)")
      .eq("status_to", "dispatched")
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (scopeMarket) qb = qb.eq("market_id", scopeMarket);
    if (cursor) qb = qb.lte("created_at", cursor.createdAt);
    if (q.date_from) qb = qb.gte("created_at", q.date_from);
    if (q.date_to) qb = qb.lte("created_at", q.date_to + "T23:59:59.999Z");
    if (q.actor_id) qb = qb.eq("actor_id", q.actor_id);
    if (q.q) {
      const like = `%${q.q}%`;
      qb = qb.or(`order_number.ilike.${like},customer_name.ilike.${like}`, {
        foreignTable: "orders",
      });
    }
    const { data } = await qb;
    return { data: (data ?? []) as unknown as HandoverRow[] };
  })();

  const scansPromise = (async () => {
    if (!includeInventory || scanReasons.length === 0) return { data: [] as InvRow[] };
    let qb = supabase
      .from("inventory_log")
      .select("id, order_id, reason, change, balance_after, created_at, is_damaged, note, actor_id, product_id, products!inner(market_id, name), orders(order_number, customer_name, customer_city), actor:users!actor_id(id, full_name, role, avatar_url)")
      .in("reason", scanReasons)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (scopeMarket) qb = qb.eq("products.market_id", scopeMarket);
    if (cursor) qb = qb.lte("created_at", cursor.createdAt);
    if (q.date_from) qb = qb.gte("created_at", q.date_from);
    if (q.date_to) qb = qb.lte("created_at", q.date_to + "T23:59:59.999Z");
    if (q.actor_id) qb = qb.eq("actor_id", q.actor_id);
    if (q.product_id) qb = qb.eq("product_id", q.product_id);
    if (q.q) {
      const like = `%${q.q}%`;
      qb = qb.or(
        `order_number.ilike.${like},customer_name.ilike.${like}`,
        { foreignTable: "orders" },
      ).or(
        `name.ilike.${like}`,
        { foreignTable: "products" },
      ).or(`note.ilike.${like}`);
    }
    const { data } = await qb;
    return { data: (data ?? []) as unknown as InvRow[] };
  })();

  const [{ data: prints }, { data: handovers }, { data: scans }] = await Promise.all([
    printsPromise,
    handoversPromise,
    scansPromise,
  ]);

  const printRows: WarehouseHistoryRow[] = prints.map((p) => ({
    kind: "print" as const,
    id: p.id,
    order_id: p.order_id,
    order_number: p.orders?.order_number ?? null,
    product_id: null,
    product_name: null,
    qty_change: null,
    balance_after: null,
    at: p.created_at,
    detail:
      [
        p.orders?.order_number ? `#${p.orders.order_number}` : null,
        p.orders?.customer_name,
        p.orders?.customer_city,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    is_damaged: false,
    is_reprint: !!p.is_reprint,
    note: null,
    actor: mapActor(p.actor),
    anomalies: [],
  }));

  const handoverRows: WarehouseHistoryRow[] = handovers.map((h) => ({
    kind: "handover" as const,
    id: h.id,
    order_id: h.order_id,
    order_number: h.orders?.order_number ?? null,
    product_id: null,
    product_name: h.orders?.product_name ?? null,
    qty_change: null,
    balance_after: null,
    at: h.created_at,
    detail:
      [
        h.orders?.order_number ? `#${h.orders.order_number}` : null,
        h.orders?.customer_name,
        h.orders?.customer_city,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    is_damaged: false,
    is_reprint: false,
    note: null,
    actor: mapActor(h.actor),
    anomalies: [],
  }));

  const scanRows: WarehouseHistoryRow[] = scans.map((s) => {
    const isReturn = s.reason === "returned";
    const isWriteoff = s.reason === "damaged_writeoff";
    const isAdjust = s.reason === "manual_adjustment";
    let kind: WarehouseHistoryRow["kind"];
    if (isAdjust) kind = "adjust";
    else if (isWriteoff) kind = "writeoff";
    else if (isReturn) kind = "return";
    else kind = "scan";

    return {
      kind,
      id: s.id,
      order_id: s.order_id,
      order_number: s.orders?.order_number ?? null,
      product_id: s.product_id,
      product_name: s.products?.name ?? null,
      qty_change: s.change ?? null,
      balance_after: s.balance_after ?? null,
      at: s.created_at,
      detail:
        [
          s.orders?.order_number ? `#${s.orders.order_number}` : null,
          s.products?.name,
          s.orders?.customer_name,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      is_damaged: s.reason === "damaged_writeoff" || s.is_damaged === true,
      is_reprint: false,
      note: s.note ?? null,
      actor: mapActor(s.actor),
      anomalies: [],
    };
  });

  const merged = [...printRows, ...handoverRows, ...scanRows]
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

  // Anomaly detection runs on the page rows
  const rowsWithAnomalies = await detectAnomalies(supabase, pageRows, scopeMarket);

  // Apply onlyAnomalies filter after detection
  const finalRows =
    q.anomalies === "1"
      ? rowsWithAnomalies.filter((r) => r.anomalies.length > 0)
      : rowsWithAnomalies;

  return { rows: finalRows, nextCursor };
}
