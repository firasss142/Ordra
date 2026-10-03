import type { SupabaseClient } from "@supabase/supabase-js";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { attachProductImages } from "@/lib/warehouse/product-images";

/**
 * The reads behind « Rentrer », for one building (or every building of the
 * market when the desk has not chosen one).
 *
 *   - Chez Darb pour nous: `to_be_returned` — the ONLY receivable status. Read
 *     through `get_to_be_returned_orders`, which carries `returned_at` (when the
 *     parcel became `to_be_returned`, from order_history) — the « depuis » clock.
 *   - En route: `returning` — on the road back, never receivable, shown greyed.
 *   - Traités: the desk's last seven days of decisions.
 *
 * The RPC has no building parameter, so the rows are narrowed here with the
 * same rule as `get_warehouse_queue_stats` (the building's own parcels plus the
 * ones fulfilled from the carrier's warehouse) — otherwise « Aujourd'hui » and
 * this screen would print two different counts for the same job.
 */

export type ReturnOutcome = "restocked" | "damaged" | "redelivered";

export interface ReturnRow extends WarehouseOrderRow {
  warehouse_id: string | null;
  /** The building's name in the market's language; null without a building. */
  warehouse_name: string | null;
  /**
   * Why Darb sent it back: the courier's classified remark
   * (`darb_shipments.remark_class`) of the most recent shipment. Null when no
   * shipment carries a class that explains a return — the screen then omits it
   * rather than guess.
   */
  darb_reason: string | null;
}

export interface OnTheWayRow {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  customer_city: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  product_image_url: string | null;
}

export interface ProcessedRow {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  customer_name: string;
  customer_city: string | null;
  tracking_number: string | null;
  carrier_sticker_ref: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  outcome: ReturnOutcome;
  /** The damage cause when `outcome` is damaged. */
  return_reason: string | null;
  processed_at: string;
}

export interface ReturnsPayload {
  orders: ReturnRow[];
  nextCursor: string | null;
  onTheWay: OnTheWayRow[];
  processed: ProcessedRow[];
  /** A warehouse agent nobody assigned to a building: they see nothing. */
  siteUnassigned?: boolean;
}

/**
 * Remark classes that say why a delivery did not happen. Delivery-side notes
 * (« coordinated », « in_progress », « office_pickup ») and the honest
 * « other » / « none » explain nothing about a return.
 */
export const DARB_RETURN_REASONS = [
  "refused",
  "no_answer",
  "customer_cancelled",
  "store_cancelled",
  "not_needed",
  "not_serious",
  "no_cash",
  "wrong_item",
  "payment_method",
  "out_of_coverage",
  "wrong_address",
  "duplicate",
] as const;

const REASONS = new Set<string>(DARB_RETURN_REASONS);
const PROCESSED_DAYS = 7;
const ON_THE_WAY_LIMIT = 100;
const PROCESSED_LIMIT = 50;

type Site = string | null;

/** Same membership rule as get_warehouse_queue_stats(market, site). */
function atSite(site: Site, warehouseId: string | null, carrierExtra: unknown): boolean {
  if (site === null) return true;
  if (warehouseId === site) return true;
  const flag = (carrierExtra as { fulfil_from_carrier_warehouse?: unknown } | null)?.fulfil_from_carrier_warehouse;
  return String(flag) === "true";
}

export async function warehouseNames(
  supabase: SupabaseClient,
  marketId: string | null,
  arabic: boolean,
): Promise<Map<string, string>> {
  let q = supabase.from("warehouses").select("id, name_fr, name_ar");
  if (marketId) q = q.eq("market_id", marketId);
  const { data } = await q;
  return new Map(
    ((data ?? []) as Array<{ id: string; name_fr: string; name_ar: string }>).map((w) => [
      w.id,
      arabic ? w.name_ar : w.name_fr,
    ]),
  );
}

/** The most recent shipment's class, when it is a reason. */
async function darbReasons(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("darb_shipments")
    .select("order_id, remark_class, last_synced_at")
    .in("order_id", ids);
  const latest = new Map<string, { cls: string | null; at: string }>();
  for (const s of (data ?? []) as Array<{ order_id: string; remark_class: string | null; last_synced_at: string | null }>) {
    const at = s.last_synced_at ?? "";
    const prev = latest.get(s.order_id);
    if (!prev || at > prev.at) latest.set(s.order_id, { cls: s.remark_class, at });
  }
  const out = new Map<string, string>();
  latest.forEach((v, id) => {
    if (v.cls && REASONS.has(v.cls)) out.set(id, v.cls);
  });
  return out;
}

export async function narrowAtDarb(
  supabase: SupabaseClient,
  rows: WarehouseOrderRow[],
  input: { site: Site; names: Map<string, string> },
): Promise<ReturnRow[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [{ data: places }, reasons] = await Promise.all([
    supabase.from("orders").select("id, warehouse_id, carrier_extra").in("id", ids),
    darbReasons(supabase, ids),
  ]);
  const where = new Map(
    ((places ?? []) as Array<{ id: string; warehouse_id: string | null; carrier_extra: unknown }>).map((p) => [p.id, p]),
  );
  const kept = rows.filter((r) => {
    const p = where.get(r.id);
    return atSite(input.site, p?.warehouse_id ?? null, p?.carrier_extra ?? null);
  });
  const pictured = await attachProductImages(supabase, kept);
  return pictured.map((r) => {
    const wid = where.get(r.id)?.warehouse_id ?? null;
    return {
      ...r,
      warehouse_id: wid,
      warehouse_name: wid ? (input.names.get(wid) ?? null) : null,
      darb_reason: reasons.get(r.id) ?? null,
    };
  });
}

export async function readOnTheWay(
  supabase: SupabaseClient,
  input: { marketId: string | null; site: Site; names: Map<string, string> },
): Promise<OnTheWayRow[]> {
  let q = supabase
    .from("orders")
    .select("id, product_id, product_name, variant_label, quantity, customer_city, warehouse_id, created_at")
    .eq("status", "returning")
    .is("archived_at", null);
  if (input.marketId) q = q.eq("market_id", input.marketId);
  if (input.site) q = q.eq("warehouse_id", input.site);
  const { data } = await q.order("created_at", { ascending: true }).limit(ON_THE_WAY_LIMIT);
  const rows = (data ?? []) as Array<Omit<OnTheWayRow, "warehouse_name" | "product_image_url"> & { created_at: string }>;
  const pictured = await attachProductImages(supabase, rows);
  return pictured.map(({ created_at: _created, ...r }) => ({
    ...r,
    warehouse_name: r.warehouse_id ? (input.names.get(r.warehouse_id) ?? null) : null,
  }));
}

/**
 * What the warehouse decided in the last seven days. A decision is a
 * `to_be_returned` order that left that status by a scan: `received`
 * (redelivered) or `returned` WITH its stock row (intact or damaged). A
 * `returned` without a stock row was not decided by the warehouse.
 */
export async function readProcessed(
  supabase: SupabaseClient,
  input: { marketId: string | null; site: Site; names: Map<string, string>; now?: Date },
): Promise<ProcessedRow[]> {
  const since = new Date((input.now ?? new Date()).getTime() - PROCESSED_DAYS * 86_400_000).toISOString();
  let hq = supabase
    .from("order_history")
    .select("order_id, status_to, created_at")
    .eq("status_from", "to_be_returned")
    .in("status_to", ["returned", "received"])
    .gte("created_at", since);
  if (input.marketId) hq = hq.eq("market_id", input.marketId);
  const { data: hist } = await hq.order("created_at", { ascending: false }).limit(PROCESSED_LIMIT);
  const events = (hist ?? []) as Array<{ order_id: string; status_to: string; created_at: string }>;
  const ids = Array.from(new Set(events.map((e) => e.order_id)));
  if (ids.length === 0) return [];

  const [{ data: orders }, { data: logs }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, product_id, product_name, variant_label, quantity, customer_name, customer_city, tracking_number, carrier_sticker_ref, warehouse_id",
      )
      .in("id", ids),
    supabase
      .from("inventory_log")
      .select("order_id, reason, is_damaged, return_reason")
      .in("order_id", ids)
      .in("reason", ["returned", "damaged_writeoff"]),
  ]);
  const byId = new Map(
    ((orders ?? []) as Array<Omit<ProcessedRow, "outcome" | "return_reason" | "processed_at" | "warehouse_name">>).map((o) => [o.id, o]),
  );
  const stock = new Map<string, { damaged: boolean; reason: string | null }>();
  for (const l of (logs ?? []) as Array<{ order_id: string; reason: string; is_damaged: boolean | null; return_reason: string | null }>) {
    const damaged = l.reason === "damaged_writeoff" || l.is_damaged === true;
    const prev = stock.get(l.order_id);
    stock.set(l.order_id, { damaged: damaged || !!prev?.damaged, reason: l.return_reason ?? prev?.reason ?? null });
  }

  const out: ProcessedRow[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.order_id)) continue;
    const o = byId.get(e.order_id);
    if (!o || !atSite(input.site, o.warehouse_id, null)) continue;
    let outcome: ReturnOutcome;
    let reason: string | null = null;
    if (e.status_to === "received") outcome = "redelivered";
    else {
      const s = stock.get(e.order_id);
      if (!s) continue;
      outcome = s.damaged ? "damaged" : "restocked";
      reason = s.damaged ? s.reason : null;
    }
    seen.add(e.order_id);
    out.push({
      ...o,
      warehouse_name: o.warehouse_id ? (input.names.get(o.warehouse_id) ?? null) : null,
      outcome,
      return_reason: reason,
      processed_at: e.created_at,
    });
  }
  return out;
}

