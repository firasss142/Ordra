/**
 * Libya warehouse E2E fixture — seed, inspect, and remove test data in the
 * PRODUCTION project, leaving no trace.
 *
 * There is no local Supabase; `npm run dev` talks to the hosted project. So
 * every row this creates is tagged (fixed uuids, `WH-TEST-` external ids,
 * `[TEST]` names) and `teardown` removes rows ONLY by those ids — never by a
 * name pattern that could catch a real customer.
 *
 * Test orders point at a SANDBOX carrier row (code darb_assabil, is_active
 * false, api_endpoint 127.0.0.1:4545) so the scan-out route binds stickers
 * against scripts/darb-sandbox.mjs instead of the real carrier. The row is
 * inactive, which is what keeps the pg_cron sync and the rate harvest away.
 *
 * What the scenarios mean: scripts/wh-test-scenarios.mjs and
 * plans/warehouse-ly-e2e-test-fixture.md.
 *
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts seed              # dry-run
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts seed --apply
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts status
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts teardown          # dry-run
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts teardown --apply [--archive-products]
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts session [--email=adel@oms.local]
 *   node_modules/.bin/vite-node scripts/wh-test-fixture.ts report-returns
 *
 * inventory_log is append-only by TRIGGER (not just RLS), so a service-role
 * DELETE is refused. `teardown` prints the one owner-level transaction to run
 * through the Supabase MCP / SQL editor, then deletes the rest; or, with
 * --archive-products, leaves the log rows and soft-archives the test products.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "../src/lib/crypto";
import {
  ACTORS, IDS, MARKETS, NAME_MARK, ORDER_IDS, PRODUCTS, SANDBOX, SCENARIOS, STOREFRONTS,
  TAG, TRIPOLI_CARRIER,
} from "./wh-test-scenarios.mjs";

// minimal .env.local loader (no dotenv dependency) — same as verify-market-metrics.ts
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const STATE_FILE = "scripts/.wh-test-state.json";
const APPLY = process.argv.includes("--apply");
const ARCHIVE_PRODUCTS = process.argv.includes("--archive-products");
const cmd = process.argv[2] ?? "status";
const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PRODUCT_IDS = PRODUCTS.map((p) => p.id);
const EXT_PREFIX = `${TAG}-`;

type Db = SupabaseClient;
type Snapshot = {
  takenAt: string;
  products: Record<string, { current_stock: number; damaged_return_count: number; is_active: boolean }>;
  ordersByMarketStatus: Record<string, number>;
  inventoryLogRealCount: number;
  orderHistoryRealCount: number;
  carriers: Record<string, boolean>;
};
type State = { seededAt: string; snapshot: Snapshot };

function admin(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
  return createClient(url, key, { auth: { persistSession: false } });
}

function loadState(): State | null {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : null;
}
function saveState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) fail(`${what}: ${r.error.message}`);
  return r.data as T;
}
const inList = (ids: readonly string[]) => `(${ids.join(",")})`;
const hoursAgo = (h: number, from = Date.now()) => new Date(from - h * 3_600_000).toISOString();

/* ── snapshot of REAL rows, so status can prove none moved ─────────────── */

async function takeSnapshot(db: Db): Promise<Snapshot> {
  const products = must(
    await db.from("products").select("id, current_stock, damaged_return_count, is_active").not("id", "in", inList(PRODUCT_IDS)),
    "snapshot products",
  ) as Array<{ id: string; current_stock: number; damaged_return_count: number; is_active: boolean }>;

  const orders = must(
    await db.from("orders").select("market_id, status").not("external_id", "like", `${EXT_PREFIX}%`),
    "snapshot orders",
  ) as Array<{ market_id: string; status: string }>;
  const byMs: Record<string, number> = {};
  for (const o of orders) {
    const k = `${o.market_id === MARKETS.ly ? "ly" : o.market_id === MARKETS.tn ? "tn" : o.market_id}:${o.status}`;
    byMs[k] = (byMs[k] ?? 0) + 1;
  }

  const il = await db.from("inventory_log").select("id", { count: "exact", head: true }).not("product_id", "in", inList(PRODUCT_IDS));
  if (il.error) fail(`snapshot inventory_log: ${il.error.message}`);
  const oh = await db.from("order_history").select("id", { count: "exact", head: true }).not("order_id", "in", inList(ORDER_IDS));
  if (oh.error) fail(`snapshot order_history: ${oh.error.message}`);

  const carriers = must(await db.from("carriers").select("id, is_active").neq("id", IDS.carrier), "snapshot carriers") as Array<{ id: string; is_active: boolean }>;

  return {
    takenAt: new Date().toISOString(),
    products: Object.fromEntries(products.map((p) => [p.id, { current_stock: p.current_stock, damaged_return_count: p.damaged_return_count, is_active: p.is_active }])),
    ordersByMarketStatus: byMs,
    inventoryLogRealCount: il.count ?? 0,
    orderHistoryRealCount: oh.count ?? 0,
    carriers: Object.fromEntries(carriers.map((c) => [c.id, c.is_active])),
  };
}

function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const [id, b] of Object.entries(before.products)) {
    const a = after.products[id];
    if (!a) { out.push(`product ${id} disappeared`); continue; }
    if (a.current_stock !== b.current_stock) out.push(`product ${id} current_stock ${b.current_stock} → ${a.current_stock}`);
    if (a.damaged_return_count !== b.damaged_return_count) out.push(`product ${id} damaged ${b.damaged_return_count} → ${a.damaged_return_count}`);
    if (a.is_active !== b.is_active) out.push(`product ${id} is_active ${b.is_active} → ${a.is_active}`);
  }
  for (const id of Object.keys(after.products)) if (!before.products[id]) out.push(`product ${id} appeared`);
  const keys = new Set([...Object.keys(before.ordersByMarketStatus), ...Object.keys(after.ordersByMarketStatus)]);
  for (const k of keys) {
    const b = before.ordersByMarketStatus[k] ?? 0, a = after.ordersByMarketStatus[k] ?? 0;
    if (a !== b) out.push(`real orders ${k}: ${b} → ${a}`);
  }
  if (before.inventoryLogRealCount !== after.inventoryLogRealCount) out.push(`real inventory_log rows ${before.inventoryLogRealCount} → ${after.inventoryLogRealCount}`);
  if (before.orderHistoryRealCount !== after.orderHistoryRealCount) out.push(`real order_history rows ${before.orderHistoryRealCount} → ${after.orderHistoryRealCount}`);
  for (const [id, b] of Object.entries(before.carriers)) {
    const a = after.carriers[id];
    if (a === undefined) out.push(`carrier ${id} disappeared`);
    else if (a !== b) out.push(`carrier ${id} is_active ${b} → ${a}`);
  }
  return out;
}

/* ── what exists right now, by tag ──────────────────────────────────────── */

async function findTagged(db: Db) {
  const carriers = must(await db.from("carriers").select("id, name, is_active, api_endpoint").eq("id", IDS.carrier), "tagged carriers") as Array<{ id: string; name: string; is_active: boolean; api_endpoint: string }>;
  const products = must(await db.from("products").select("id, name, current_stock, damaged_return_count, is_active, deleted_at").in("id", PRODUCT_IDS), "tagged products") as Array<{ id: string; name: string; current_stock: number; damaged_return_count: number; is_active: boolean; deleted_at: string | null }>;
  const orders = must(
    await db.from("orders").select("id, external_id, status, tracking_number, carrier_sticker_ref, carrier_status_slug, carrier_extra, quantity, product_id, terminal_at").or(`id.in.${inList(ORDER_IDS)},external_id.like.${EXT_PREFIX}%`),
    "tagged orders",
  ) as Array<{ id: string; external_id: string; status: string; tracking_number: string | null; carrier_sticker_ref: string | null; carrier_status_slug: string | null; carrier_extra: Record<string, unknown> | null; quantity: number; product_id: string; terminal_at: string | null }>;
  const orderIds = Array.from(new Set([...ORDER_IDS, ...orders.map((o) => o.id)]));
  const history = must(await db.from("order_history").select("id, order_id, status_from, status_to, actor_type, created_at").in("order_id", orderIds), "tagged order_history") as Array<{ id: string; order_id: string; status_from: string | null; status_to: string; actor_type: string; created_at: string }>;
  const logs = must(
    await db.from("inventory_log").select("id, product_id, order_id, change, reason, balance_after, is_damaged, actor_id, created_at").or(`product_id.in.${inList(PRODUCT_IDS)},order_id.in.${inList(orderIds)}`).order("created_at", { ascending: true }),
    "tagged inventory_log",
  ) as Array<{ id: string; product_id: string; order_id: string | null; change: number; reason: string; balance_after: number; is_damaged: boolean; actor_id: string | null; created_at: string }>;
  return { carriers, products, orders, orderIds, history, logs };
}

/* ── seed ───────────────────────────────────────────────────────────────── */

function buildRows(now: number, tripoli: { delivery_fee: number; return_fee: number }) {
  const carrier = {
    id: IDS.carrier,
    market_id: MARKETS.ly,
    name: `Darb Assabil — Sandbox ${NAME_MARK}`,
    code: "darb_assabil",
    carrier_type: "navex",
    investor_billing_mode: "billed_only",
    supplies_own_labels: true,
    is_active: false,
    api_endpoint: SANDBOX.base,
    api_credentials: encrypt(JSON.stringify({ api_key: SANDBOX.apiKey, account_id: SANDBOX.accountId, default_service_id: SANDBOX.serviceId })),
    delivery_fee: tripoli.delivery_fee,
    return_fee: tripoli.return_fee,
  };

  const products = PRODUCTS.map((p) => ({
    id: p.id,
    market_id: MARKETS[p.market as "ly" | "tn"],
    name: p.name,
    sku: p.sku,
    description: `[${TAG}] fixture product — safe to delete`,
    unit_cogs: p.unit_cogs,
    packing_cost: 0,
    confirmation_processing_cost: 0,
    initial_stock: p.stock,
    current_stock: p.stock,
    low_stock_threshold: p.threshold,
    default_price: p.default_price,
    is_active: true,
    created_at: hoursAgo(24 * 30, now),
  }));

  const inventoryLog = PRODUCTS.map((p) => ({
    product_id: p.id,
    order_id: null,
    change: p.stock,
    reason: "initial_stock",
    balance_after: p.stock,
    is_damaged: false,
    actor_id: ACTORS.admin,
    note: `[${TAG}] initial stock`,
    created_at: hoursAgo(24 * 30, now),
  }));

  const orders: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  for (const s of SCENARIOS) {
    const product = PRODUCTS.find((p) => p.key === s.product)!;
    const marketId = MARKETS[s.market as "ly" | "tn"];
    const bench = s.benchHoursAgo === null ? null : hoursAgo(s.benchHoursAgo, now);
    const createdAt = hoursAgo((s.benchHoursAgo ?? 12) + 24, now);
    const confirmedAt = hoursAgo((s.benchHoursAgo ?? 12) + 23, now);
    const carrierExtra = s.market === "ly"
      ? { city: s.city, customer_area: s.area, service_id: SANDBOX.serviceId, ...s.extra }
      : null;

    orders.push({
      id: s.id,
      market_id: marketId,
      storefront_id: STOREFRONTS[s.market as "ly" | "tn"],
      external_id: s.external_id,
      external_platform: "manual",
      status: s.status,
      customer_name: s.customer,
      customer_phone: s.phone,
      customer_address: `[TEST] ${s.city}${s.area ? " · " + s.area : ""}`,
      customer_city: s.city,
      product_id: product.id,
      product_name: product.name,
      quantity: s.qty,
      unit_price: product.default_price,
      total_price: product.default_price * s.qty,
      currency: s.market === "ly" ? "LYD" : "TND",
      carrier_id: s.carrier === "sandbox" ? IDS.carrier : null,
      tracking_number: s.tracking,
      carrier_sticker_ref: s.sticker,
      carrier_status_slug: s.slug,
      carrier_extra: carrierExtra,
      raw_payload: { wh_test: true, scenario: s.key, purpose: s.purpose },
      created_at: createdAt,
    });

    const note = (t: string) => `[${TAG}] ${t}`;
    history.push({ order_id: s.id, market_id: marketId, status_from: null, status_to: "pending", actor_id: null, actor_type: "system", note: note("webhook intake"), created_at: createdAt });
    history.push({ order_id: s.id, market_id: marketId, status_from: "pending", status_to: "confirmed", actor_id: ACTORS.admin, actor_type: "manager", note: note("confirmed by phone"), created_at: confirmedAt });
    if (s.status === "confirmed") continue;
    history.push({ order_id: s.id, market_id: marketId, status_from: "confirmed", status_to: "uploaded", actor_id: ACTORS.admin, actor_type: "manager", note: note(`uploaded to carrier · ${s.tracking ?? "-"}`), created_at: bench });
    if (s.status === "to_be_returned") {
      history.push({ order_id: s.id, market_id: marketId, status_from: "uploaded", status_to: "to_be_returned", actor_id: null, actor_type: "system", note: note("Darb Assabil carrier status: returned"), created_at: hoursAgo(s.benchHoursAgo! - 48, now) });
    }
  }
  return { carrier, products, inventoryLog, orders, history };
}

async function seed(db: Db) {
  const existing = await findTagged(db);
  const already = existing.carriers.length + existing.products.length + existing.orders.length;
  if (already > 0) fail(`tagged rows already exist (carriers ${existing.carriers.length}, products ${existing.products.length}, orders ${existing.orders.length}) — run teardown first`);

  const tripoli = must(await db.from("carriers").select("delivery_fee, return_fee").eq("id", TRIPOLI_CARRIER).maybeSingle(), "read Tripoli carrier") as { delivery_fee: number; return_fee: number } | null;
  if (!tripoli) fail("Tripoli carrier row not found");

  try {
    const r = await fetch(`${SANDBOX.base}/__sandbox/state`);
    const j = (await r.json()) as { shipments: unknown[]; mode: string };
    console.log(`sandbox reachable · ${j.shipments.length} shipments · mode=${j.mode}`);
  } catch {
    console.warn(`! sandbox NOT reachable at ${SANDBOX.base} — start it with: node scripts/darb-sandbox.mjs`);
  }

  const now = Date.now();
  const rows = buildRows(now, tripoli!);
  console.log(`plan: 1 carrier, ${rows.products.length} products, ${rows.inventoryLog.length} inventory_log, ${rows.orders.length} orders, ${rows.history.length} order_history`);
  for (const s of SCENARIOS) {
    console.log(`  ${s.key.padEnd(3)} ${s.status.padEnd(15)} ${s.market} ${s.external_id.padEnd(30)} ${s.purpose}`);
  }
  if (!APPLY) { console.log("\ndry-run — add --apply to write"); return; }

  const snapshot = await takeSnapshot(db);
  must(await db.from("carriers").insert(rows.carrier), "insert carrier");
  must(await db.from("products").insert(rows.products), "insert products");
  must(await db.from("inventory_log").insert(rows.inventoryLog), "insert inventory_log");
  must(await db.from("orders").insert(rows.orders), "insert orders");
  must(await db.from("order_history").insert(rows.history), "insert order_history");
  saveState({ seededAt: new Date().toISOString(), snapshot });
  console.log(`\n✓ seeded · state saved to ${STATE_FILE}`);
  await status(db);
}

/* ── status ─────────────────────────────────────────────────────────────── */

async function status(db: Db) {
  const t = await findTagged(db);
  console.log(`\n── tagged rows ── carriers ${t.carriers.length} · products ${t.products.length} · orders ${t.orders.length} · order_history ${t.history.length} · inventory_log ${t.logs.length}`);
  for (const c of t.carriers) console.log(`  carrier ${c.name} · active=${c.is_active} · ${c.api_endpoint}`);
  for (const p of t.products) {
    const last = [...t.logs].reverse().find((l) => l.product_id === p.id);
    const ok = last ? last.balance_after === p.current_stock : true;
    console.log(`  product ${p.name.slice(0, 34).padEnd(34)} stock ${String(p.current_stock).padStart(3)} damaged ${p.damaged_return_count} active=${p.is_active}${p.deleted_at ? " ARCHIVED" : ""} · ledger last balance ${last?.balance_after ?? "-"} ${ok ? "✓" : "✗ MISMATCH"}`);
  }
  const byId = new Map(t.orders.map((o) => [o.id, o]));
  for (const s of SCENARIOS) {
    const o = byId.get(s.id);
    if (!o) { console.log(`  ${s.key.padEnd(3)} — missing`); continue; }
    const extra = o.carrier_extra ?? {};
    const upl = t.history.filter((h) => h.order_id === s.id && h.status_to === "uploaded").map((h) => h.created_at).sort().pop();
    const age = upl ? `${((Date.now() - new Date(upl).getTime()) / 3_600_000).toFixed(1)}h` : "-";
    console.log(`  ${s.key.padEnd(3)} ${o.status.padEnd(15)} sticker=${o.carrier_sticker_ref ?? "-"} track=${o.tracking_number ?? "-"} slug=${o.carrier_status_slug ?? "-"} darb_id=${extra.darb_assabil_id ?? "-"} branch=${extra.darb_branch_group ?? "-"} bench=${age}`);
  }
  const moves = t.logs.filter((l) => l.reason !== "initial_stock");
  if (moves.length) {
    console.log("  inventory_log movements:");
    for (const l of moves) {
      const key = SCENARIOS.find((s) => s.id === l.order_id)?.key ?? "-";
      console.log(`    ${l.created_at.slice(11, 19)} ${l.reason.padEnd(16)} ${String(l.change).padStart(3)} → ${l.balance_after} order=${key} damaged=${l.is_damaged}`);
    }
  }

  try {
    const r = await fetch(`${SANDBOX.base}/__sandbox/state`);
    const j = (await r.json()) as { mode: string; binds: Array<{ scenario: string; from: string; to: string }> };
    console.log(`── sandbox ── mode=${j.mode} · binds ${j.binds.length}${j.binds.map((b) => ` [${b.scenario}: ${b.from}→${b.to}]`).join("")}`);
  } catch {
    console.log("── sandbox ── unreachable");
  }

  const state = loadState();
  if (state) {
    const diff = diffSnapshots(state.snapshot, await takeSnapshot(db));
    console.log(`── real rows vs snapshot (${state.snapshot.takenAt}) ── ${diff.length === 0 ? "no change ✓" : `${diff.length} differences`}`);
    for (const d of diff) console.log(`  ! ${d}`);
  } else {
    console.log("── no state file (not seeded, or torn down)");
  }
}

/* ── teardown ───────────────────────────────────────────────────────────── */

async function teardown(db: Db) {
  const t = await findTagged(db);
  console.log(`found: carriers ${t.carriers.length} · products ${t.products.length} · orders ${t.orders.length} · order_history ${t.history.length} · inventory_log ${t.logs.length}`);

  const leads = await db.from("leads").select("id", { count: "exact", head: true }).or(`converted_order_id.in.${inList(t.orderIds)},source_order_id.in.${inList(t.orderIds)}`);
  if (leads.error) fail(`leads check: ${leads.error.message}`);
  if ((leads.count ?? 0) > 0) fail(`${leads.count} leads reference test orders — unexpected, resolve by hand`);

  const logSql = `BEGIN;
ALTER TABLE public.inventory_log DISABLE TRIGGER inventory_log_no_delete;
DELETE FROM public.inventory_log
 WHERE product_id IN (${PRODUCT_IDS.map((i) => `'${i}'`).join(", ")})
    OR order_id IN (${t.orderIds.map((i) => `'${i}'`).join(", ")});
ALTER TABLE public.inventory_log ENABLE TRIGGER inventory_log_no_delete;
COMMIT;`;

  if (t.logs.length > 0 && !ARCHIVE_PRODUCTS) {
    console.log(`\n${t.logs.length} inventory_log rows are append-only by trigger. Run this as the table owner (Supabase MCP execute_sql / SQL editor), expecting DELETE ${t.logs.length}:\n\n${logSql}\n`);
    if (APPLY) fail("re-run teardown --apply once the inventory_log rows are gone (or pass --archive-products to keep them and soft-archive the products)");
  }
  if (!APPLY) { console.log("dry-run — add --apply to delete"); return; }

  const del = async (table: string, col: string, ids: string[]) => {
    if (ids.length === 0) return;
    const r = await db.from(table).delete({ count: "exact" }).in(col, ids);
    if (r.error) fail(`delete ${table}: ${r.error.message}`);
    console.log(`  ${table}: deleted ${r.count ?? "?"}`);
  };

  await del("order_history", "order_id", t.orderIds);
  await del("carrier_event_log", "order_id", t.orderIds);
  await del("webhook_delivery_log", "order_id", t.orderIds);
  await del("order_follow_ups", "order_id", t.orderIds);
  {
    const r = await db.from("orders").delete({ count: "exact" }).or(`id.in.${inList(t.orderIds)},external_id.like.${EXT_PREFIX}%`);
    if (r.error) fail(`delete orders: ${r.error.message}`);
    console.log(`  orders: deleted ${r.count ?? "?"}`);
  }

  const remaining = await db.from("inventory_log").select("id", { count: "exact", head: true }).in("product_id", PRODUCT_IDS);
  if ((remaining.count ?? 0) > 0) {
    const r = await db.from("products").update({ is_active: false, deleted_at: new Date().toISOString(), deleted_by: ACTORS.admin }).in("id", PRODUCT_IDS);
    if (r.error) fail(`archive products: ${r.error.message}`);
    console.log(`  products: soft-archived ${t.products.length} (inventory_log rows kept: ${remaining.count})`);
  } else {
    await del("products", "id", PRODUCT_IDS);
  }
  await del("carriers", "id", [IDS.carrier]);

  if (existsSync(STATE_FILE)) {
    const state = loadState()!;
    const diff = diffSnapshots(state.snapshot, await takeSnapshot(db));
    console.log(`── real rows vs seed-time snapshot ── ${diff.length === 0 ? "no change ✓" : `${diff.length} differences`}`);
    for (const d of diff) console.log(`  ! ${d}`);
    unlinkSync(STATE_FILE);
  }
  console.log("✓ teardown complete");
  await status(db);
}

/* ── session (fallback login) ───────────────────────────────────────────── */

async function session() {
  const email = arg("email", "adel@oms.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ref = new URL(url).hostname.split(".")[0];
  const db = admin();
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) fail(`generateLink: ${error.message}`);
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (vErr) fail(`verifyOtp: ${vErr.message}`);
  const payload = `base64-${Buffer.from(JSON.stringify(verified.session)).toString("base64")}`;
  const CHUNK = 3180;
  const cookies: Array<{ name: string; value: string }> = [];
  for (let i = 0; i * CHUNK < payload.length; i++) cookies.push({ name: `sb-${ref}-auth-token.${i}`, value: payload.slice(i * CHUNK, (i + 1) * CHUNK) });
  mkdirSync("scripts/.tmp", { recursive: true });
  writeFileSync("scripts/.tmp/session-cookies.json", JSON.stringify(cookies));
  console.log(`✓ ${cookies.length} cookie chunk(s) for ${email} written to scripts/.tmp/session-cookies.json (domain localhost, path /)`);
}

/* ── report: LY Darb returns that never credited stock ──────────────────── */

async function reportReturns(db: Db) {
  const rows = must(
    await db
      .from("orders")
      .select("id, external_id, customer_name, product_name, quantity, tracking_number, carrier_status_slug, terminal_at, updated_at, product_id, carrier_id")
      .eq("market_id", MARKETS.ly)
      .eq("status", "returned")
      .not("external_id", "like", `${EXT_PREFIX}%`)
      .order("terminal_at", { ascending: true }),
    "returned orders",
  ) as Array<Record<string, string | number | null>>;
  const ids = rows.map((r) => String(r.id));
  const credited = must(
    await db.from("inventory_log").select("order_id").in("order_id", ids).in("reason", ["returned", "damaged_writeoff", "received_back"]),
    "credited returns",
  ) as Array<{ order_id: string }>;
  const creditedSet = new Set(credited.map((c) => c.order_id));
  const missing = rows.filter((r) => !creditedSet.has(String(r.id)));
  mkdirSync("report", { recursive: true });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["order_id", "external_id", "customer_name", "product_name", "quantity", "tracking_number", "carrier_status_slug", "returned_at"];
  const csv = [header.join(","), ...missing.map((r) => [r.id, r.external_id, r.customer_name, r.product_name, r.quantity, r.tracking_number, r.carrier_status_slug, r.terminal_at ?? r.updated_at].map(esc).join(","))].join("\n");
  writeFileSync("report/ly-returns-without-stock-credit.csv", csv);
  const units = missing.reduce((n, r) => n + Number(r.quantity ?? 0), 0);
  console.log(`LY orders in status returned: ${rows.length} · with a stock-credit ledger row: ${creditedSet.size} · WITHOUT: ${missing.length} (${units} units) → report/ly-returns-without-stock-credit.csv`);
  const byProduct = new Map<string, number>();
  for (const r of missing) byProduct.set(String(r.product_name), (byProduct.get(String(r.product_name)) ?? 0) + Number(r.quantity ?? 0));
  for (const [p, n] of byProduct) console.log(`  ${String(n).padStart(4)} × ${p}`);
}

/* ── main ───────────────────────────────────────────────────────────────── */

async function main() {
  const db = admin();
  switch (cmd) {
    case "seed": return seed(db);
    case "status": return status(db);
    case "teardown": return teardown(db);
    case "session": return session();
    case "report-returns": return reportReturns(db);
    default: fail(`unknown command ${cmd} — seed | status | teardown | session | report-returns`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
