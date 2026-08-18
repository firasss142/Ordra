import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { marketTimezone } from "@/lib/markets";
import { deriveOrderFacts, type BillingMode, type OrderFactRow } from "./order-facts";
import { touchedKeys } from "./daily-facts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

const BATCH = 120; // .in() filters travel in the URL; ~4.5 KB keeps well under proxy limits

interface OrderRow {
  id: string;
  market_id: string;
  status: string;
  product_id: string | null;
  quantity: number;
  total_price: string | number;
  carrier_id: string | null;
  created_at: string;
}
interface ItemRow {
  order_id: string;
  product_id: string | null;
  quantity: number;
  line_total: string | number;
}
interface HistRow {
  order_id: string;
  status_to: string;
  created_at: string;
}
interface ShipRow {
  order_id: string;
  billed_shipping_amount: string | number | null;
}
interface CarrierRow {
  id: string;
  code: string | null;
  delivery_fee: string | number | null;
  return_fee: string | number | null;
  investor_billing_mode: BillingMode | null;
}
interface ProductCostRow {
  id: string;
  unit_cogs: string | number | null;
  packing_cost: string | number | null;
  confirmation_processing_cost: string | number | null;
}
interface ExistingRow {
  order_id: string;
  product_id: string;
  unit_cogs_snapshot: string | number | null;
  packing_cost_snapshot: string | number | null;
  processing_cost_snapshot: string | number | null;
  snapshot_at: string | null;
}

const num = (v: string | number | null | undefined, d = 0): number => (v === null || v === undefined ? d : Number(v));

export interface PersistFactsResult {
  scanned: number;
  changed: number;
  excludedDexpress: number;
  noProduct: number;
  touched: Set<string>; // `${product_id}|${day}`
  productIds: Set<string>;
}

/**
 * Derive and upsert investor_order_facts for a set of order ids.
 * Snapshots are preserved by the DB trigger AND by passing existing rows in,
 * so a replay never rewrites history. Returns which (product, day) keys moved.
 */
export async function loadAndPersistOrderFacts(admin: Supa, orderIds: string[]): Promise<PersistFactsResult> {
  const result: PersistFactsResult = {
    scanned: 0,
    changed: 0,
    excludedDexpress: 0,
    noProduct: 0,
    touched: new Set(),
    productIds: new Set(),
  };
  if (orderIds.length === 0) return result;

  // Reference data once.
  const [carriers, products] = await Promise.all([
    fetchAllRows<CarrierRow>(
      admin.from("carriers").select("id, code, delivery_fee, return_fee, investor_billing_mode"),
    ),
    fetchAllRows<ProductCostRow>(
      admin.from("products").select("id, unit_cogs, packing_cost, confirmation_processing_cost"),
    ),
  ]);
  const carrierById = new Map(carriers.map((c) => [c.id, c]));
  const productCosts = new Map(
    products.map((p) => [
      p.id,
      { unitCogs: num(p.unit_cogs), packingCost: num(p.packing_cost), processingCost: num(p.confirmation_processing_cost) },
    ]),
  );

  const uniq = [...new Set(orderIds)];
  for (let i = 0; i < uniq.length; i += BATCH) {
    const ids = uniq.slice(i, i + BATCH);
    const [orders, items, hist, ships, existing] = await Promise.all([
      fetchAllRows<OrderRow>(
        admin
          .from("orders")
          .select("id, market_id, status, product_id, quantity, total_price, carrier_id, created_at")
          .in("id", ids),
      ),
      fetchAllRows<ItemRow>(admin.from("order_items").select("order_id, product_id, quantity, line_total").in("order_id", ids)),
      fetchAllRows<HistRow>(admin.from("order_history").select("order_id, status_to, created_at").in("order_id", ids)),
      fetchAllRows<ShipRow>(admin.from("darb_shipments").select("order_id, billed_shipping_amount").in("order_id", ids)),
      fetchAllRows<ExistingRow>(
        admin
          .from("investor_order_facts")
          .select("order_id, product_id, unit_cogs_snapshot, packing_cost_snapshot, processing_cost_snapshot, snapshot_at")
          .in("order_id", ids),
      ),
    ]);

    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const it of items) (itemsByOrder.get(it.order_id) ?? itemsByOrder.set(it.order_id, []).get(it.order_id)!).push(it);
    const histByOrder = new Map<string, HistRow[]>();
    for (const h of hist) (histByOrder.get(h.order_id) ?? histByOrder.set(h.order_id, []).get(h.order_id)!).push(h);
    const shipByOrder = new Map<string, ShipRow>();
    for (const s of ships) {
      // Several shipments per order can exist (resend); keep the one with a billed amount, else any.
      const cur = shipByOrder.get(s.order_id);
      if (!cur || (cur.billed_shipping_amount === null && s.billed_shipping_amount !== null)) shipByOrder.set(s.order_id, s);
    }
    const existingByOrder = new Map<string, ExistingRow[]>();
    for (const e of existing) (existingByOrder.get(e.order_id) ?? existingByOrder.set(e.order_id, []).get(e.order_id)!).push(e);

    const rows: OrderFactRow[] = [];
    for (const o of orders) {
      result.scanned++;
      const carrier = o.carrier_id ? carrierById.get(o.carrier_id) : undefined;
      const ex = new Map<string, { unitCogsSnapshot: number | null; packingCostSnapshot: number | null; processingCostSnapshot: number | null; snapshotAt: string | null }>();
      for (const e of existingByOrder.get(o.id) ?? []) {
        ex.set(e.product_id, {
          unitCogsSnapshot: e.unit_cogs_snapshot === null ? null : Number(e.unit_cogs_snapshot),
          packingCostSnapshot: e.packing_cost_snapshot === null ? null : Number(e.packing_cost_snapshot),
          processingCostSnapshot: e.processing_cost_snapshot === null ? null : Number(e.processing_cost_snapshot),
          snapshotAt: e.snapshot_at,
        });
      }
      const facts = deriveOrderFacts({
        order: {
          id: o.id,
          marketId: o.market_id,
          status: o.status,
          productId: o.product_id,
          quantity: o.quantity,
          totalPrice: num(o.total_price),
          carrierId: o.carrier_id,
          createdAt: o.created_at,
        },
        carrier: carrier
          ? {
              code: carrier.code,
              deliveryFee: num(carrier.delivery_fee),
              returnFee: num(carrier.return_fee),
              investorBillingMode: carrier.investor_billing_mode ?? "billed_only",
            }
          : null,
        items: (itemsByOrder.get(o.id) ?? []).map((it) => ({ productId: it.product_id, quantity: it.quantity, lineTotal: num(it.line_total) })),
        history: (histByOrder.get(o.id) ?? []).map((h) => ({ statusTo: h.status_to, createdAt: h.created_at })),
        billedShippingAmount: shipByOrder.get(o.id)?.billed_shipping_amount == null ? null : num(shipByOrder.get(o.id)!.billed_shipping_amount),
        productCosts,
        existing: ex,
        timeZone: marketTimezone(o.market_id),
      });
      for (const f of facts) {
        if (!f.product_id) {
          result.noProduct++;
          continue;
        }
        if (f.excluded_reason === "dexpress") result.excludedDexpress++;
        rows.push(f);
      }
    }

    if (rows.length === 0) continue;

    // Upsert; the BEFORE UPDATE trigger suppresses no-op writes, so RETURNING
    // only lists rows that were inserted or actually changed.
    const { data, error } = await admin
      .from("investor_order_facts")
      .upsert(rows, { onConflict: "order_id,product_id" })
      .select("order_id, product_id");
    if (error) throw new Error(`investor_order_facts upsert: ${error.message}`);
    const changedSet = new Set(((data ?? []) as { order_id: string; product_id: string }[]).map((r) => `${r.order_id}|${r.product_id}`));
    result.changed += changedSet.size;

    // Touched keys: for changed rows, both the new keys and (if we knew them)
    // the old keys. We only know new; a moved delivered_date is rare and the
    // nightly full run heals it.
    for (const f of rows) {
      result.productIds.add(f.product_id);
      if (!changedSet.has(`${f.order_id}|${f.product_id}`)) continue;
      for (const k of touchedKeys(f)) result.touched.add(k);
    }
  }
  return result;
}

/** All facts for a product (bounded by cohort_date >= from). */
export async function loadProductFacts(admin: Supa, productId: string, fromCohortDate: string): Promise<OrderFactRow[]> {
  return fetchAllRows<OrderFactRow>(
    admin.from("investor_order_facts").select("*").eq("product_id", productId).gte("cohort_date", fromCohortDate),
  );
}
