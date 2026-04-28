/**
 * One-time historical import: Converty orders → OMS.
 * Reads converty-orders-full.json from project root and bulk-inserts.
 *
 * Usage:
 *   node scripts/import-converty-orders.cjs --dry-run        # print first 5 mapped rows, no insert
 *   node scripts/import-converty-orders.cjs --limit=100      # import first 100 only
 *   node scripts/import-converty-orders.cjs                  # full import
 *
 * Decisions encoded:
 *   - 17 orders without SKU/product name → SKIP
 *   - 43 orders without customer.name → IMPORT with customer_name='Unknown'
 *   - rejected → rejection_reason='autre'
 *   - status mapping per plan (Converty 'confirmed' → OMS 'dispatch_scheduled')
 *   - test orders + duplicate _id → SKIP
 *   - writes to orders, order_items, order_history (one row each per order)
 */

const fs = require("fs");
const path = require("path");

// Tiny .env.local loader (avoids dotenv dep)
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const { createClient } = require("@supabase/supabase-js");

// ===== Constants pinned to the OMS DB (from pre-flight) =====
const TN_MARKET_ID = "00000000-0000-0000-0000-000000000001";
const CONVERTY_STOREFRONT_ID = "4770ef08-91c2-401c-8356-03fc01c02ac8";
const BIOVERA_PRODUCT_ID = "1b28b393-1c64-4aa2-9008-a9c847e04094";
const BIOVERA_SKU = "bv-01";
const NAVEX_CARRIER_ID = "f0ec43a3-692e-4189-9a49-b708335894d4";
const COSMOS_CARRIER_ID = "1318702c-c900-41c2-be9f-b6f96cf476f5";

// ===== Status mapping: Converty → OMS =====
const STATUS_MAP = {
  delivered: "delivered",
  rejected: "rejected",
  returned: "returned",
  deleted: "deleted",
  deposit: "deposit",
  "to be returned": "to_be_returned",
  uploaded: "dispatched",
  attempt: "attempt_1",
  pending: "pending",
  unverified: "unverified",
  "in transit": "in_transit",
  cancelled: "cancelled",
  confirmed: "dispatch_scheduled",
  abandoned: "deleted",
  received: "received",
};

const CARRIER_MAP = {
  navex: NAVEX_CARRIER_ID,
  "cosmos-v2": COSMOS_CARRIER_ID,
};

// ===== CLI =====
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

// ===== Supabase client =====
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// ===== Mapping =====
function mapOrder(c) {
  const item = (c.cart || [])[0];
  if (!item || !item.product) return { skip: "no_cart_item", row: null };

  const sku = item.product.sku;
  const productName = item.product.name;
  if (!sku || !productName) return { skip: "no_sku_or_name", row: null };
  if (sku !== BIOVERA_SKU) return { skip: "unknown_sku:" + sku, row: null };

  const omsStatus = STATUS_MAP[c.status];
  if (!omsStatus) return { skip: "unmapped_status:" + c.status, row: null };

  const carrierId = CARRIER_MAP[c.deliveryCompany] ?? null;

  const customerName = (c.customer && c.customer.name && c.customer.name.trim()) || "Unknown";
  const customerPhone = (c.customer && c.customer.phone) || null;
  if (!customerPhone) return { skip: "no_phone", row: null };

  const quantity = item.quantity || 1;
  const unitPrice = Number(item.pricePerUnit ?? c.total?.basePrice ?? 0);
  const totalPrice = Number(c.total?.totalPrice ?? unitPrice * quantity);
  const deliveryFee = Number(c.total?.deliveryCost ?? 0);

  const order = {
    market_id: TN_MARKET_ID,
    storefront_id: CONVERTY_STOREFRONT_ID,
    external_id: c._id,
    external_platform: "converty",
    status: omsStatus,
    rejection_reason: omsStatus === "rejected" ? "autre" : null,
    rejection_note: null,
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: c.customer?.address ?? null,
    customer_city: c.customer?.city ?? null,
    customer_note: c.note ?? null,
    product_id: BIOVERA_PRODUCT_ID,
    product_name: productName,
    variant_label: null,
    quantity,
    unit_price: unitPrice,
    total_price: totalPrice,
    delivery_fee: deliveryFee,
    carrier_id: carrierId,
    tracking_number: c.barcode ?? null,
    raw_payload: c,
    created_at: c.createdAt ?? null,
    updated_at: c.updatedAt ?? null,
  };

  return { skip: null, row: order };
}

async function main() {
  const inputPath = path.join(__dirname, "..", "converty-orders-full.json");
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const all = Array.isArray(raw.data) ? raw.data : [];
  console.log("Loaded", all.length, "rows from", inputPath);

  // Drop test orders + duplicate _id
  const seen = new Set();
  const candidates = [];
  let dupes = 0;
  let testRows = 0;
  for (const c of all) {
    if (c.isTest === true) { testRows += 1; continue; }
    if (!c._id) continue;
    if (seen.has(c._id)) { dupes += 1; continue; }
    seen.add(c._id);
    candidates.push(c);
  }
  console.log("After dedupe + test filter:", candidates.length, "(skipped", dupes, "dupes,", testRows, "test rows)");

  // Map all
  const mapped = [];
  const skipReasons = new Map();
  for (const c of candidates) {
    const { skip, row } = mapOrder(c);
    if (skip) {
      skipReasons.set(skip, (skipReasons.get(skip) || 0) + 1);
    } else {
      mapped.push(row);
    }
  }
  console.log("Mapped:", mapped.length, "Skipped:", candidates.length - mapped.length);
  if (skipReasons.size) {
    console.log("Skip reasons:", Object.fromEntries(skipReasons));
  }

  if (DRY_RUN) {
    console.log("\n=== DRY RUN: first 5 mapped rows ===");
    for (const r of mapped.slice(0, 5)) {
      const display = { ...r };
      delete display.raw_payload; // too noisy
      console.log(JSON.stringify(display, null, 2));
      console.log("---");
    }
    console.log("\n[DRY RUN] Would import", Math.min(mapped.length, LIMIT), "orders. Exiting without insert.");
    return;
  }

  // Idempotency: skip external_ids already in the DB for this storefront.
  console.log("\nFetching already-imported external_ids…");
  const existingIds = new Set();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select("external_id")
      .eq("storefront_id", CONVERTY_STOREFRONT_ID)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) existingIds.add(r.external_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log("Already imported:", existingIds.size);

  const fresh = mapped.filter((r) => !existingIds.has(r.external_id));
  const toImport = fresh.slice(0, LIMIT);
  console.log("Net new to import:", toImport.length);

  const BATCH = 100;
  let inserted = 0;
  let failed = 0;
  const failedDetails = [];

  for (let i = 0; i < toImport.length; i += BATCH) {
    const batch = toImport.slice(i, i + BATCH);
    const { data: insertedOrders, error: orderErr } = await supabase
      .from("orders")
      .insert(batch)
      .select("id, external_id, status, product_id, product_name, quantity, unit_price, total_price, updated_at");

    if (orderErr) {
      console.error("  batch", i / BATCH, "failed:", orderErr.message);
      failed += batch.length;
      failedDetails.push({ start: i, error: orderErr.message });
      continue;
    }

    // Backfill order_items + order_history from the inserted rows
    const items = insertedOrders.map((o) => ({
      order_id: o.id,
      product_id: o.product_id,
      product_name: o.product_name,
      variant_label: null,
      quantity: o.quantity,
      unit_price: o.unit_price,
      line_total: Number(o.unit_price) * Number(o.quantity),
    }));
    const history = insertedOrders.map((o) => ({
      order_id: o.id,
      status_from: null,
      status_to: o.status,
      actor_id: null,
      actor_type: "system",
      note: "Imported from Converty (historical bulk)",
      // Anchor the history transition at the order's last Converty update so
      // dashboard period filters (which key off order_history.created_at) bucket
      // imported orders into the day they actually happened, not import day.
      created_at: o.updated_at,
    }));

    const [itemsRes, histRes] = await Promise.all([
      supabase.from("order_items").insert(items),
      supabase.from("order_history").insert(history),
    ]);
    if (itemsRes.error) console.error("  order_items insert failed:", itemsRes.error.message);
    if (histRes.error) console.error("  order_history insert failed:", histRes.error.message);

    inserted += insertedOrders.length;
    if (((i / BATCH) | 0) % 5 === 0) {
      console.log("  …", inserted, "/", toImport.length);
    }
  }

  console.log("\nDone.");
  console.log("Inserted:", inserted);
  console.log("Failed:", failed);
  if (failedDetails.length) console.log("First failures:", failedDetails.slice(0, 5));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
