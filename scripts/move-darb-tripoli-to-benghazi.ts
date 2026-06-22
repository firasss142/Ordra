/**
 * One-off: move مصحف orders that are uploaded on "Darb Assabil - Tripoli" to the
 * second account "Darb Assabil — Benghazi", matched by QR code = tracking_number
 * against the provided CSV.
 *
 * Per order: cancel the Tripoli shipment (voidDispatch WITH carrier_extra, so the
 * Darb internal id is actually used) → on success, revert uploaded→confirmed via
 * delete_carrier_barcode → re-upload to Benghazi reusing the EXACT stored
 * (city, area, service) from the order's carrier_extra (not re-resolved).
 *
 * SAFETY: if the Tripoli void does not return success, the order is SKIPPED — we
 * never proceed to Benghazi, so no order is ever double-shipped.
 *
 * Idempotent: an order no longer `uploaded` on Tripoli is skipped (already moved).
 *
 * Usage (loads app env for Supabase + ENCRYPTION_KEY):
 *   npx tsx --env-file=.env.local scripts/move-darb-tripoli-to-benghazi.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/move-darb-tripoli-to-benghazi.ts --one
 *   npx tsx --env-file=.env.local scripts/move-darb-tripoli-to-benghazi.ts --one=SH1771593
 *   npx tsx --env-file=.env.local scripts/move-darb-tripoli-to-benghazi.ts --bulk
 */
import { createClient } from "@supabase/supabase-js";
import {
  buildConfig,
  dispatchToCarrier,
  type CarrierRow,
} from "../src/lib/carriers/dispatch";
import { getCarrierAdapter } from "../src/lib/carriers/adapter-registry";
import type { CarrierOrderData } from "../src/lib/carriers/types";
import type { OrderItem } from "../src/types/order-items";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";
const PRODUCT = "مصحف القرآن تدبر وعمل حجم كبير";
const ACTOR = "7c36ad23-330c-4739-b3a7-4c724b84b4e3"; // admin@oms.local — for order_history attribution

// QR codes from the CSV (Darb_Assabil_Orders - Orders_84_quraan.csv).
const CSV_CODES = [
  "SH1773979","SH1776699","SH1776764","SH1776826","SH1776920","SH1776952","SH1777001","SH1777014","SH1777040","SH1777134","SH1777375","SH1777510","SH1777546","SH1777775","SH1777788","SH1777838","SH1777871","SH1778238","SH1778308","SH1778448","SH1778866","SH1778885","SH1779007","SH1779008","SH1779117","SH1779237","SH1779281","SH1779346","SH1779374","SH1779516","SH1779575","SH1779688","SH1779726","SH1779790","SH1779876","SH1779999","SH1780015","SH1780033","SH1780155","SH1780310","SH1780438","SH1780537","SH1781157","SH1781170","SH1781189","SH1781252","SH1781268","SH1783073","SH1783093","SH1783100","SH1783109","SH1783128","SH1783171","SH1783528","SH1783579","SH1783794","SH1783849","SH1783988","SH1784104","SH1784240","SH1784384","SH1784483","SH1784524","SH1784546","SH1784561","SH1784781","SH1784909","SH1784915","SH1785119","SH1785277","SH1785285","SH1785296","SH1785305","SH1785713","SH1785734","SH1785762","SH1785795","SH1785801","SH1785887","SH1785911","SH1785934","SH1785960","SH1785997","SH1786001","SH1786012","SH1786015","SH1786027","SH1786036","SH1786071","SH1786086","SH1786103","SH1786110","SH1786125","SH1786137","SH1786153","SH1786157","SH1786352","SH1786371",
];

interface OrderRow {
  id: string;
  status: string;
  market_id: string;
  carrier_id: string | null;
  tracking_number: string | null;
  carrier_extra: Record<string, unknown> | null;
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_whatsapp: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
}

const ORDER_COLS =
  "id, status, market_id, carrier_id, tracking_number, carrier_extra, customer_name, customer_phone, customer_phone_2, customer_whatsapp, customer_address, customer_city, customer_note, product_name, variant_label, quantity, total_price";

type Outcome =
  | { tracking: string; outcome: "moved"; newTracking: string; dest: string }
  | { tracking: string; outcome: "skipped"; reason: string }
  | { tracking: string; outcome: "failed"; reason: string };

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function getCarrierRow(id: string): Promise<CarrierRow> {
  const { data, error } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`carrier ${id} fetch failed: ${error?.message}`);
  return {
    id: data.id,
    code: data.code,
    api_endpoint: data.api_endpoint,
    api_credentials: data.api_credentials,
    delivery_fee: Number(data.delivery_fee),
    return_fee: Number(data.return_fee),
  };
}

async function fetchMoveSet(): Promise<OrderRow[]> {
  const { data, error } = await admin
    .from("orders")
    .select(ORDER_COLS)
    .eq("carrier_id", TRIPOLI)
    .eq("status", "uploaded")
    .eq("product_name", PRODUCT)
    .in("tracking_number", CSV_CODES)
    .order("tracking_number", { ascending: true });
  if (error) throw new Error(`move-set query failed: ${error.message}`);
  return (data ?? []) as unknown as OrderRow[];
}

function toOrderData(o: OrderRow, items: OrderItem[]): CarrierOrderData {
  return {
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_phone_2: o.customer_phone_2,
    customer_whatsapp: o.customer_whatsapp,
    customer_address: o.customer_address,
    customer_city: o.customer_city,
    customer_note: o.customer_note,
    product_name: o.product_name,
    variant_label: o.variant_label,
    quantity: Number(o.quantity),
    total_price: Number(o.total_price),
    order_items: items,
  };
}

const benghaziRowP = getCarrierRow(BENGHAZI);
const tripoliCfgP = getCarrierRow(TRIPOLI).then(buildConfig);
const adapter = getCarrierAdapter("darb_assabil");

async function processOrder(o: OrderRow): Promise<Outcome> {
  const oldTracking = o.tracking_number ?? "(none)";

  // Defensive guard (idempotency + race): only move orders still uploaded on Tripoli.
  if (o.status !== "uploaded" || o.carrier_id !== TRIPOLI || !o.tracking_number) {
    return { tracking: oldTracking, outcome: "skipped", reason: "not_uploaded_on_tripoli" };
  }

  const ce = (o.carrier_extra ?? {}) as Record<string, unknown>;
  const city = typeof ce.city === "string" ? ce.city : null;
  const area = typeof ce.customer_area === "string" ? ce.customer_area : null;
  if (!city || !area) {
    return { tracking: oldTracking, outcome: "skipped", reason: "no_destination_in_carrier_extra" };
  }

  // Re-upload payload: reuse the EXACT proven destination + options from Tripoli.
  const extra: Record<string, unknown> = {
    city,
    customer_area: area,
    ...(typeof ce.service_id === "string" ? { service_id: ce.service_id } : {}),
    service_fee_on_top: false,
    is_fragile: !!ce.is_fragile,
    allow_inspection: !!ce.allow_inspection,
    allow_testing: !!ce.allow_testing,
    allow_card_payment: !!ce.allow_card_payment,
  };

  // 1) Cancel the Tripoli shipment — MUST succeed (passes carrier_extra so the
  //    Darb internal id is used). On any non-success, skip (never double-ship).
  const tripoliCfg = await tripoliCfgP;
  const voidRes = await adapter.voidDispatch(o.tracking_number, tripoliCfg, ce);
  if (!voidRes.success) {
    return { tracking: oldTracking, outcome: "skipped", reason: `void_failed: ${voidRes.reason ?? "unknown"}` };
  }

  // 2) Revert uploaded -> confirmed (clears tracking/carrier/carrier_extra).
  const { error: delErr } = await admin.rpc("delete_carrier_barcode", {
    p_order_id: o.id,
    p_actor_id: ACTOR,
    p_void_outcome: "carrier_voided",
  });
  if (delErr) {
    return { tracking: oldTracking, outcome: "failed", reason: `delete_carrier_barcode_rpc: ${delErr.message} (Tripoli shipment already cancelled)` };
  }

  // 3) Re-upload to Benghazi (creates the new shipment).
  const { data: itemRows } = await admin
    .from("order_items")
    .select("*")
    .eq("order_id", o.id)
    .order("created_at", { ascending: true });
  const orderData = toOrderData(o, (itemRows as OrderItem[] | null) ?? []);
  const benghaziRow = await benghaziRowP;

  let disp;
  try {
    disp = await dispatchToCarrier(orderData, benghaziRow, extra);
  } catch (e) {
    return { tracking: oldTracking, outcome: "failed", reason: `benghazi_dispatch_threw: ${(e as Error)?.message ?? e} | order is now CONFIRMED (Tripoli cancelled) — re-upload manually` };
  }
  if (!disp.success) {
    return { tracking: oldTracking, outcome: "failed", reason: `benghazi_rejected: ${disp.errorMessage} | order is now CONFIRMED — re-upload manually` };
  }

  // 4) Persist the Benghazi dispatch (confirmed -> uploaded, new tracking).
  const mergedExtra = { ...extra, ...(disp.extra ?? {}) };
  const { error: dispErr } = await admin.rpc("dispatch_order", {
    p_order_id: o.id,
    p_carrier_id: BENGHAZI,
    p_tracking_number: disp.trackingNumber,
    p_carrier_extra: Object.keys(mergedExtra).length ? mergedExtra : null,
    p_actor_id: ACTOR,
  });
  if (dispErr) {
    return { tracking: oldTracking, outcome: "failed", reason: `dispatch_order_rpc: ${dispErr.message} | Benghazi shipment ${disp.trackingNumber} WAS created but not recorded — fix manually` };
  }

  return { tracking: oldTracking, outcome: "moved", newTracking: disp.trackingNumber, dest: `${city} / ${area}` };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const bulk = args.includes("--bulk");
  const oneArg = args.find((a) => a === "--one" || a.startsWith("--one="));
  const oneTarget = oneArg ? (oneArg.includes("=") ? oneArg.split("=")[1] : "FIRST") : null;

  if (!dryRun && !bulk && oneTarget === null) {
    console.error("Specify a mode: --dry-run | --one[=SHxxxx] | --bulk");
    process.exit(2);
  }

  const set = await fetchMoveSet();
  console.log(`Move set (مصحف, uploaded on Tripoli, tracking ∈ CSV): ${set.length} orders\n`);

  if (dryRun) {
    for (const o of set) {
      const ce = (o.carrier_extra ?? {}) as Record<string, unknown>;
      console.log(`  ${o.tracking_number}  ->  Benghazi   dest=${ce.city ?? "?"} / ${ce.customer_area ?? "?"}   svc=${ce.service_id ?? "?"}`);
    }
    console.log(`\nDRY RUN — no changes made. ${set.length} order(s) would move.`);
    return;
  }

  let targets: OrderRow[];
  if (oneTarget !== null) {
    targets = oneTarget === "FIRST"
      ? set.slice(0, 1)
      : set.filter((o) => o.tracking_number === oneTarget);
    if (targets.length === 0) {
      console.error(`--one target ${oneTarget} is not in the move set.`);
      process.exit(2);
    }
  } else {
    targets = set; // --bulk
  }

  console.log(`Processing ${targets.length} order(s)...\n`);
  const results: Outcome[] = [];
  for (const o of targets) {
    const r = await processOrder(o);
    results.push(r);
    const line =
      r.outcome === "moved"
        ? `✅ MOVED   ${r.tracking} -> ${r.newTracking}  (${r.dest})`
        : r.outcome === "skipped"
          ? `⏭️  SKIP    ${r.tracking}  — ${r.reason}`
          : `❌ FAIL    ${r.tracking}  — ${r.reason}`;
    console.log(line);
  }

  const moved = results.filter((r) => r.outcome === "moved").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  console.log(`\n── Summary ──  moved=${moved}  skipped=${skipped}  failed=${failed}  (of ${targets.length})`);
  if (failed > 0) console.log("FAILED orders may need manual attention (see reasons above).");
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  process.exit(1);
});
