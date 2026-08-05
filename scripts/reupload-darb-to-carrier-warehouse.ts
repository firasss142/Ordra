/**
 * Re-upload already-uploaded Darb Assabil orders so they are fulfilled from
 * DARB'S OWN WAREHOUSE (مخزن طرابلس) instead of ours.
 *
 * WHY A RE-UPLOAD AND NOT AN EDIT: Darb's `warehouse` is create-only —
 * `PATCH /api/local/shipments/:id` does not accept it. The only way to change
 * the fulfilment source is delete + recreate, which mints a NEW tracking number.
 *
 * Per order:
 *   0. PREFLIGHT (non-destructive): resolve every line to carrier stock and
 *      check availability. Fails here => skipped, nothing destroyed.
 *   1. Cancel the existing shipment (hard delete on Darb's side).
 *      Fails => skipped. We never proceed, so an order is never double-shipped.
 *   2. delete_carrier_barcode: uploaded -> confirmed (clears tracking/extra).
 *   3. performDispatch with fulfil_from_carrier_warehouse — the SAME path the
 *      dispatch modal uses, so the stock check and payload are identical.
 *
 * The preflight runs before the destructive step deliberately: the move-carrier
 * script voids first, which is fine when the re-upload cannot fail validation,
 * but warehouse mode can (unmapped product, carrier out of stock).
 *
 * Reuses the EXACT stored (city, area, service) from carrier_extra rather than
 * re-resolving them, so a destination that Darb already accepted stays accepted.
 *
 * Idempotent: an order already carrying fulfil_from_carrier_warehouse, or no
 * longer `uploaded`, is skipped.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reupload-darb-to-carrier-warehouse.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/reupload-darb-to-carrier-warehouse.ts --one      # first order only
 *   npx tsx --env-file=.env.local scripts/reupload-darb-to-carrier-warehouse.ts --apply    # all
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import { getCarrierAdapter } from "../src/lib/carriers/adapter-registry";
import { performDispatch } from "../src/lib/carriers/perform-dispatch";
import {
  loadCarrierProductMappings,
  resolveWarehouseLines,
  fetchDarbWarehouseStock,
  checkWarehouseStock,
  effectiveOrderLines,
  availableFor,
} from "../src/lib/carriers/carrier-warehouse";
import type { OrderItem } from "../src/types/order-items";

const CARRIER = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69"; // Darb Assabil - Tripoli
const ACTOR = "7c36ad23-330c-4739-b3a7-4c724b84b4e3"; // admin@oms.local
const SINCE = "2026-08-04"; // the batch uploaded in home mode

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const ONE = ARGS.includes("--one");

function env(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env ${n}`);
  return v;
}

const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Row {
  id: string;
  status: string;
  carrier_id: string | null;
  tracking_number: string | null;
  carrier_extra: Record<string, unknown> | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
}

const COLS =
  "id, status, carrier_id, tracking_number, carrier_extra, product_id, product_name, variant_label, quantity, total_price";

async function carrierRow(): Promise<CarrierRow> {
  const { data, error } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", CARRIER)
    .single();
  if (error || !data) throw new Error(`carrier fetch failed: ${error?.message}`);
  return {
    id: data.id,
    code: data.code,
    api_endpoint: data.api_endpoint,
    api_credentials: data.api_credentials,
    delivery_fee: Number(data.delivery_fee),
    return_fee: Number(data.return_fee),
  };
}

async function main() {
  const { data, error } = await admin
    .from("orders")
    .select(COLS)
    .eq("carrier_id", CARRIER)
    .eq("status", "uploaded")
    .gte("created_at", SINCE)
    .order("tracking_number", { ascending: true });
  if (error) throw new Error(`query failed: ${error.message}`);

  let rows = (data ?? []) as unknown as Row[];
  rows = rows.filter(
    (r) => (r.carrier_extra ?? {})["fulfil_from_carrier_warehouse"] !== true
  );
  if (ONE) rows = rows.slice(0, 1);

  console.log(`Candidates: ${rows.length}`);

  const cRow = await carrierRow();
  const config = buildConfig(cRow);
  const adapter = getCarrierAdapter("darb_assabil");

  // ── Preflight every order before touching anything ──────────────────
  const stockAll = await fetchDarbWarehouseStock(config);
  const remaining = new Map<string, number>();
  const ready: { row: Row; lines: OrderItem[]; extra: Record<string, unknown> }[] = [];
  const blocked: { tracking: string; reason: string }[] = [];

  for (const r of rows) {
    const tracking = r.tracking_number ?? "(none)";
    const ce = (r.carrier_extra ?? {}) as Record<string, unknown>;
    const city = typeof ce.city === "string" ? ce.city : null;
    const area = typeof ce.customer_area === "string" ? ce.customer_area : null;
    if (!city || !area) {
      blocked.push({ tracking, reason: "no destination in carrier_extra" });
      continue;
    }

    const { data: itemRows } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", r.id)
      .order("created_at", { ascending: true });
    const lines = effectiveOrderLines((itemRows as OrderItem[] | null) ?? [], {
      product_id: r.product_id,
      product_name: r.product_name,
      variant_label: r.variant_label,
      quantity: Number(r.quantity),
      total_price: Number(r.total_price),
    });

    const productIds = [
      ...new Set(lines.map((l) => l.product_id).filter((x): x is string => Boolean(x))),
    ];
    const mappings = await loadCarrierProductMappings(admin, CARRIER, productIds);
    const resolved = resolveWarehouseLines(mappings, lines);
    if (!resolved.ok) {
      blocked.push({ tracking, reason: resolved.error });
      continue;
    }

    // Availability must account for orders earlier in THIS run, which will have
    // locked units by the time we get here.
    const check = checkWarehouseStock(resolved.lines, lines, stockAll);
    if (!check.ok) {
      blocked.push({ tracking, reason: check.error });
      continue;
    }
    let short = false;
    resolved.lines.forEach((l, i) => {
      const key = `${l.external_product_id}|${l.external_variant_id}`;
      if (!remaining.has(key)) {
        remaining.set(key, availableFor(stockAll, l.external_product_id, l.external_variant_id));
      }
      const need = lines[i]?.quantity ?? 0;
      const have = remaining.get(key)!;
      if (have < need) short = true;
      remaining.set(key, have - need);
    });
    if (short) {
      blocked.push({ tracking, reason: "carrier stock exhausted by earlier orders in this batch" });
      continue;
    }

    ready.push({
      row: r,
      lines,
      extra: {
        city,
        customer_area: area,
        ...(typeof ce.service_id === "string" ? { service_id: ce.service_id } : {}),
        service_fee_on_top: !!ce.service_fee_on_top,
        is_fragile: !!ce.is_fragile,
        allow_inspection: !!ce.allow_inspection,
        allow_testing: !!ce.allow_testing,
        allow_card_payment: !!ce.allow_card_payment,
        fulfil_from_carrier_warehouse: true,
      },
    });
  }

  console.log(`\nPreflight OK: ${ready.length}   blocked: ${blocked.length}`);
  for (const b of blocked) console.log(`  ✗ ${b.tracking} — ${b.reason}`);
  for (const r of ready) {
    const cod = r.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
    console.log(
      `  ✓ ${r.row.tracking_number} → ${r.extra.city} / ${r.extra.customer_area} · COD ${cod}`
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply${ONE ? " --one" : ""}.`);
    return;
  }

  // ── Execute ─────────────────────────────────────────────────────────
  const results: string[] = [];
  for (const { row: r, extra } of ready) {
    const old = r.tracking_number!;

    // 1. Cancel on Darb (hard delete). Never proceed if this is not confirmed.
    const voided = await adapter.voidDispatch(old, config, r.carrier_extra ?? {});
    if (!voided.success) {
      results.push(`SKIP  ${old} — void failed: ${voided.reason ?? "unknown"} (untouched)`);
      continue;
    }

    // 2. uploaded -> confirmed
    const { error: delErr } = await admin.rpc("delete_carrier_barcode", {
      p_order_id: r.id,
      p_actor_id: ACTOR,
      p_void_outcome: "carrier_voided",
    });
    if (delErr) {
      results.push(`FAIL  ${old} — delete_carrier_barcode: ${delErr.message} (shipment ALREADY cancelled — fix manually)`);
      continue;
    }

    // 3. Re-upload through the normal dispatch path (re-checks stock itself).
    const res = await performDispatch({
      orderId: r.id,
      carrierId: CARRIER,
      actorId: ACTOR,
      extra,
    });
    if (!res.ok) {
      results.push(`FAIL  ${old} — re-upload rejected: ${res.error} | order is now CONFIRMED, old shipment cancelled — re-upload manually`);
      continue;
    }
    results.push(`OK    ${old} → ${res.trackingNumber}`);
  }

  console.log("\n── Results ──");
  for (const line of results) console.log(line);
  const ok = results.filter((l) => l.startsWith("OK")).length;
  console.log(`\n${ok}/${ready.length} re-uploaded in carrier-warehouse mode.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
