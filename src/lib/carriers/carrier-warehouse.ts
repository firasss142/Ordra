/**
 * Carrier-warehouse fulfilment support.
 *
 * Some carriers physically hold our stock and fulfil orders from their own
 * warehouse. Darb Assabil is the first: their `POST /api/local/shipments`
 * accepts a top-level `warehouse` id plus per-line `warehouseProduct` /
 * `warehouseProductVariant`, all of which are THEIR identifiers.
 *
 * This module turns our order lines into those identifiers via the explicit
 * `carrier_product_mappings` table (never by name — our catalogue carries two
 * "دميه ملاكمه حجم كبير" products at different prices), and checks that the
 * carrier actually holds enough stock before we commit.
 *
 * Design rule: a gap is a hard failure, never a silent fallback to home mode.
 * Those goods already left our warehouse for the carrier's, so shipping home
 * mode would ask them to collect a package we no longer hold.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderItem } from "@/types/order-items";
import type { CarrierConfig } from "./types";
import type { DarbWarehouseLine } from "./darb-assabil-adapter";

/** The `extra` key that switches an order into carrier-warehouse mode. */
export const CARRIER_WAREHOUSE_FLAG = "fulfil_from_carrier_warehouse";

export interface CarrierProductMapping {
  product_id: string;
  product_variant_id: string | null;
  external_product_id: string;
  external_variant_id: string;
  external_sku: string | null;
  external_warehouse_id: string;
  external_sale_price: number | null;
}

export type ResolveWarehouseLinesResult =
  | { ok: true; warehouseId: string; lines: DarbWarehouseLine[] }
  | { ok: false; error: string };

/** The header-product fields an order carries when it predates order_items. */
export interface OrderHeaderProduct {
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
}

/**
 * The lines to fulfil, preferring real `order_items`.
 *
 * Most orders in this system predate order_items and describe their goods only
 * on the order header. Home mode copes by sending one aggregated free-text line,
 * but warehouse mode must reference a carrier product per line — so the header
 * is promoted to a single synthetic line here, keeping every downstream step
 * (mapping, stock check, wire body) identical for both shapes.
 *
 * `quantity` is preserved exactly, because the carrier deducts that many units
 * from their shelves; `unit_price` is derived from total_price so the COD the
 * customer pays is unchanged. Returns [] when there is no product to map.
 */
export function effectiveOrderLines(
  orderItems: OrderItem[],
  header: OrderHeaderProduct
): OrderItem[] {
  if (orderItems.length > 0) return orderItems;
  if (!header.product_id) return [];

  const quantity = header.quantity > 0 ? header.quantity : 1;
  // NUMERIC(10,3) in the DB, so 3 decimals is the meaningful precision.
  const unitPrice =
    Math.round((Number(header.total_price) / quantity) * 1000) / 1000;

  return [
    {
      id: `header:${header.product_id}`,
      order_id: "",
      product_id: header.product_id,
      product_name: header.product_name,
      variant_id: null,
      variant_label: header.variant_label,
      quantity,
      unit_price: unitPrice,
      line_total: Number(header.total_price),
      created_at: "",
      updated_at: "",
    },
  ];
}

/**
 * Resolve every order line to its carrier-side identity.
 *
 * Matching prefers an exact (product, variant) mapping and falls back to a
 * product-level mapping (variant NULL) so single-variant products need only
 * one row. Returns lines in order-line order — the adapter zips them
 * positionally against `order_items`.
 */
export function resolveWarehouseLines(
  mappings: CarrierProductMapping[],
  orderItems: OrderItem[]
): ResolveWarehouseLinesResult {
  if (orderItems.length === 0) {
    return { ok: false, error: "La commande n'a aucune ligne de produit" };
  }

  const lines: DarbWarehouseLine[] = [];
  const unmapped: string[] = [];
  const warehouseIds = new Set<string>();

  for (const item of orderItems) {
    const match =
      mappings.find(
        (m) =>
          m.product_id === item.product_id &&
          m.product_variant_id === item.variant_id
      ) ??
      mappings.find(
        (m) => m.product_id === item.product_id && m.product_variant_id === null
      );

    if (!match) {
      unmapped.push(
        item.variant_label
          ? `${item.product_name} - ${item.variant_label}`
          : item.product_name
      );
      continue;
    }

    warehouseIds.add(match.external_warehouse_id);
    lines.push({
      external_product_id: match.external_product_id,
      external_variant_id: match.external_variant_id,
      external_sku: match.external_sku,
      external_sale_price: match.external_sale_price,
    });
  }

  if (unmapped.length > 0) {
    return {
      ok: false,
      error: `Produit(s) sans correspondance dans l'entrepôt transporteur : ${unmapped.join(", ")}`,
    };
  }

  // All lines must live in the SAME carrier warehouse — Darb's `warehouse` is a
  // single top-level id. Fulfilling one shipment across warehouses is their
  // `allowSplitting` feature, which we do not use.
  if (warehouseIds.size !== 1) {
    return {
      ok: false,
      error:
        "Les produits de cette commande sont répartis sur plusieurs entrepôts transporteur",
    };
  }

  return { ok: true, warehouseId: [...warehouseIds][0], lines };
}

export interface CarrierStockRow {
  warehouse: string;
  product: string;
  variant: string;
  quantity: number;
  lockedQuantity: number;
}

/**
 * Read the carrier's live stock for our account.
 * `GET /api/warehouse/products/stock/me` — HTTP 200 always; check body.status.
 */
export async function fetchDarbWarehouseStock(
  config: CarrierConfig,
  warehouseId?: string
): Promise<CarrierStockRow[]> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const qs = new URLSearchParams({ withLockedQuantities: "true" });
  if (warehouseId) qs.set("warehouse", warehouseId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `${base}/api/warehouse/products/stock/me?${qs.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `apikey ${config.apiCredentials.api_key}`,
          "X-API-VERSION": "1.0.0",
          "X-ACCOUNT-ID": config.apiCredentials.account_id,
        },
        signal: controller.signal,
      }
    );
    const body = (await res.json()) as {
      status?: boolean;
      data?: CarrierStockRow[];
    };
    if (body?.status !== true || !Array.isArray(body.data)) return [];
    return body.data;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Available = quantity - lockedQuantity. Locked units are already committed to
 * other shipments, so counting them would oversell.
 */
export function availableFor(
  stock: CarrierStockRow[],
  externalProductId: string,
  externalVariantId: string
): number {
  const row = stock.find(
    (s) => s.product === externalProductId && s.variant === externalVariantId
  );
  if (!row) return 0;
  return Math.max(0, (row.quantity ?? 0) - (row.lockedQuantity ?? 0));
}

/** Verify the carrier holds enough of every line. Aggregates repeated lines. */
export function checkWarehouseStock(
  lines: DarbWarehouseLine[],
  orderItems: OrderItem[],
  stock: CarrierStockRow[]
): { ok: true } | { ok: false; error: string } {
  const needed = new Map<string, number>();
  lines.forEach((line, i) => {
    const key = `${line.external_product_id}|${line.external_variant_id}`;
    needed.set(key, (needed.get(key) ?? 0) + (orderItems[i]?.quantity ?? 0));
  });

  const short: string[] = [];
  for (const [key, qty] of needed) {
    const [productId, variantId] = key.split("|");
    const have = availableFor(stock, productId, variantId);
    if (have < qty) {
      const idx = lines.findIndex(
        (l) =>
          l.external_product_id === productId &&
          l.external_variant_id === variantId
      );
      const label =
        lines[idx]?.external_sku ?? orderItems[idx]?.product_name ?? productId;
      short.push(`${label} (demandé ${qty}, disponible ${have})`);
    }
  }

  if (short.length > 0) {
    return {
      ok: false,
      error: `Stock insuffisant chez le transporteur : ${short.join(", ")}`,
    };
  }
  return { ok: true };
}

/** Load a carrier's product mappings for the given OMS product ids. */
export async function loadCarrierProductMappings(
  admin: SupabaseClient,
  carrierId: string,
  productIds: string[]
): Promise<CarrierProductMapping[]> {
  if (productIds.length === 0) return [];
  const { data } = await admin
    .from("carrier_product_mappings")
    .select(
      "product_id, product_variant_id, external_product_id, external_variant_id, external_sku, external_warehouse_id, external_sale_price"
    )
    .eq("carrier_id", carrierId)
    .eq("is_active", true)
    .in("product_id", productIds);
  return (data as CarrierProductMapping[] | null) ?? [];
}
