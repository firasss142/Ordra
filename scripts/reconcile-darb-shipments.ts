/**
 * Reconcile EVERY Darb Assabil order the bulk sweep could not account for.
 *
 * WHY a second pass exists: the sweep mirrors each account's shipment list, which
 * is complete for shipments that still EXIST. Darb's DELETE is a hard delete
 * (INTEGRATION_GUIDE §5.9) — a removed shipment vanishes from every list and tab.
 * So an order with no mirror row is either (a) addressable by its stored internal
 * _id but somehow absent from the list, or (b) genuinely gone. Only a per-order
 * lookup can tell those apart, and only that distinction makes the leftovers
 * actionable instead of merely unexplained.
 *
 * For each unaccounted order it walks the resolution ladder:
 *   1. GET /api/local/shipments/:id        (stored carrier_extra.darb_assabil_id)
 *   2. GET /api/local/shipments?reference= (the stored tracking_number)
 *   3. GET /api/local/shipments?search=    (tracking_number, then customer phone)
 *
 * and classifies the outcome:
 *   found          — shipment alive; mirrored + status promoted
 *   re_referenced  — alive under a different reference; tracking_number repaired
 *   hard_deleted   — absent from all three lookups → gone at the carrier
 *   unresolvable   — no usable key to search with
 *
 * EVERY order gets a carrier_event_log row (source='reconcile') so the result is
 * auditable afterwards rather than living in this terminal.
 *
 * SAFETY: a hard_deleted order is NEVER auto-cancelled. Darb losing a shipment is
 * not evidence about whether the customer got their parcel; that is a human call.
 * This script only ever mirrors, repairs references, and promotes statuses that
 * the carrier itself reports.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reconcile-darb-shipments.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/reconcile-darb-shipments.ts --apply
 *   npx tsx --env-file=.env.local scripts/reconcile-darb-shipments.ts --dry-run --all
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import { projectDarbShipment, projectDarbTimeline } from "../src/lib/carriers/darb-assabil-shipment";
import type { CarrierConfig } from "../src/lib/carriers/types";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const APPLY = flag("apply") !== undefined;
const DRY_RUN = !APPLY;
/** By default only orders with no mirror row; --all re-checks every Darb order. */
const ALL = flag("all") !== undefined;
const LIMIT = Number(flag("limit") ?? 0);
const DELAY_MS = Number(flag("delay-ms") ?? 200);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin: SupabaseClient = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number) => ([...s].length >= n ? s : s + " ".repeat(n - [...s].length));

type Outcome = "found" | "re_referenced" | "hard_deleted" | "unresolvable";

interface OrderRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string;
  carrier_extra: Record<string, unknown> | null;
  customer_phone: string | null;
  carrier_status_slug: string | null;
  status: string;
  created_at: string;
}

// ── Carrier HTTP (GET only) ──────────────────────────────────────────
async function getJson(
  config: CarrierConfig,
  path: string,
  query: Record<string, string | number | boolean> = {},
): Promise<unknown> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
  const url = `${base}${path}${qs.toString() ? `?${qs}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `apikey ${config.apiCredentials.api_key}`,
      "X-API-VERSION": "1.0.0",
      "X-ACCOUNT-ID": config.apiCredentials.account_id,
    },
    signal: AbortSignal.timeout(20000),
  });
  await sleep(DELAY_MS);
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resultsOf(body: unknown): Array<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.status !== true) return [];
  const data = (b.data ?? {}) as Record<string, unknown>;
  return Array.isArray(data.results)
    ? (data.results as Array<Record<string, unknown>>).filter((r) => r && typeof r === "object")
    : [];
}

// ── Persistence ──────────────────────────────────────────────────────
async function mirror(
  record: Record<string, unknown>,
  carrierId: string,
  orderId: string,
): Promise<void> {
  const p = projectDarbShipment(record);
  if (!p) return;
  const syncedAt = new Date().toISOString();
  await admin.from("darb_shipments").upsert(
    {
      darb_id: p.darbId,
      carrier_id: carrierId,
      order_id: orderId,
      reference: p.reference,
      original_reference: p.originalReference,
      status_slug: p.slug,
      raw_status: p.rawStatus || null,
      handler_name: p.handlerName,
      handler_phone: p.handlerPhone,
      handler_account_name: p.handlerAccountName,
      handler_account_phone: p.handlerAccountPhone,
      latest_remark: p.latestRemark,
      latest_remark_at: p.latestRemarkAt,
      cancellation_cause: p.cancellationCause,
      delayed_until: p.delayedUntil,
      cancel_count: p.cancelCount,
      resend_count: p.resendCount,
      billed_shipping_amount: p.billedShippingAmount,
      billed_currency: p.billedCurrency,
      shipping_breakdown: p.shippingBreakdown,
      cod_outstanding: p.codOutstanding,
      delivery_withdrawal_at: p.deliveryWithdrawalAt,
      sales_withdrawal_at: p.salesWithdrawalAt,
      to_city: p.toCity,
      to_area: p.toArea,
      to_address: p.toAddress,
      to_branch_group: p.toBranchGroup,
      to_zone_code: p.toZoneCode,
      group_reference: p.groupReference,
      service_title: p.serviceTitle,
      priority: p.priority,
      notes: p.notes,
      attachments: p.attachments,
      completed_at: p.completedAt,
      carrier_created_at: p.createdAt,
      carrier_updated_at: p.updatedAt,
      latest_event_at: p.latestEventAt,
      raw: record,
      last_synced_at: syncedAt,
    },
    { onConflict: "darb_id" },
  );

  const events = projectDarbTimeline(p.darbId, record).map((e) => ({
    darb_id: e.darbId,
    order_id: orderId,
    event_id: e.eventId,
    type: e.type,
    description_ar: e.descriptionAr,
    description_en: e.descriptionEn,
    remarks: e.remarks,
    actor_id: e.actorId,
    actor_name: e.actorName,
    actor_phone: e.actorPhone,
    account_phone: e.accountPhone,
    occurred_at: e.occurredAt,
  }));
  if (events.length) {
    await admin
      .from("darb_timeline_events")
      .upsert(events, { onConflict: "darb_id,event_id", ignoreDuplicates: true });
  }

  await admin.rpc("promote_darb_status", {
    p_order_id: orderId,
    p_slug: p.slug,
    p_reference: p.reference,
    p_synced_at: syncedAt,
    p_actor_id: null,
  });
}

async function logOutcome(
  order: OrderRow,
  outcome: Outcome,
  detail: string,
  raw: unknown,
): Promise<void> {
  await admin.from("carrier_event_log").insert({
    carrier_code: "darb_assabil",
    source: "reconcile",
    tracking_number: order.tracking_number,
    order_id: order.id,
    carrier_status_raw: order.carrier_status_slug,
    outcome: outcome === "found" || outcome === "re_referenced" ? "processed" : "ignored",
    outcome_reason: `${outcome}:${detail}`,
    raw_body: raw,
  });
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`Darb reconcile — ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY"}`);
  console.log(`  scope: ${ALL ? "every Darb order" : "orders with no mirror row"}\n`);

  const { data: carrierRows, error: cErr } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil");
  if (cErr) throw new Error(cErr.message);

  const configById = new Map<string, CarrierConfig>();
  const nameById = new Map<string, string>();
  for (const row of carrierRows ?? []) {
    nameById.set(row.id, row.name as string);
    try {
      configById.set(row.id, buildConfig(row as unknown as CarrierRow));
    } catch (e) {
      console.warn(`  WARN ${row.name}: credentials unusable — ${(e as Error).message}`);
    }
  }

  // Orders belonging to a Darb account. `mirrored` tells us which are accounted for.
  const carrierIds = [...configById.keys()];
  const { data: orderRows, error: oErr } = await admin
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carrier_extra, customer_phone, carrier_status_slug, status, created_at",
    )
    .in("carrier_id", carrierIds)
    .order("created_at", { ascending: false });
  if (oErr) throw new Error(oErr.message);

  const { data: mirroredRows } = await admin
    .from("darb_shipments")
    .select("order_id")
    .not("order_id", "is", null);
  const mirrored = new Set((mirroredRows ?? []).map((r) => r.order_id as string));

  let orders = (orderRows ?? []) as unknown as OrderRow[];
  if (!ALL) orders = orders.filter((o) => !mirrored.has(o.id));
  if (LIMIT > 0) orders = orders.slice(0, LIMIT);

  console.log(`  ${orders.length} order(s) to reconcile\n`);

  const outcomes: Record<Outcome, number> = {
    found: 0,
    re_referenced: 0,
    hard_deleted: 0,
    unresolvable: 0,
  };
  const gone: OrderRow[] = [];

  for (const order of orders) {
    const config = configById.get(order.carrier_id);
    if (!config) continue;
    const internalId =
      typeof order.carrier_extra?.darb_assabil_id === "string"
        ? order.carrier_extra.darb_assabil_id
        : "";
    const ref = order.tracking_number ?? "";

    let record: Record<string, unknown> | null = null;
    let via = "";

    if (internalId) {
      record = resultsOf(await getJson(config, `/api/local/shipments/${encodeURIComponent(internalId)}`))[0] ?? null;
      if (record) via = "internal_id";
    }
    if (!record && ref) {
      record = resultsOf(
        await getJson(config, "/api/local/shipments", { reference: ref, offset: 0, limit: 5 }),
      )[0] ?? null;
      if (record) via = "reference";
    }
    if (!record && (ref || order.customer_phone)) {
      record = resultsOf(
        await getJson(config, "/api/local/shipments", {
          search: ref || String(order.customer_phone),
          offset: 0,
          limit: 5,
        }),
      )[0] ?? null;
      if (record) via = "search";
    }

    let outcome: Outcome;
    let detail: string;
    if (record) {
      const p = projectDarbShipment(record);
      const changed = p?.reference && p.reference !== ref;
      outcome = changed ? "re_referenced" : "found";
      detail = `via=${via} status=${p?.slug ?? p?.rawStatus ?? "?"}${changed ? ` ref=${ref}→${p?.reference}` : ""}`;
      if (APPLY) {
        await mirror(record, order.carrier_id, order.id);
        await logOutcome(order, outcome, detail, { via, darbId: p?.darbId, status: p?.rawStatus });
      }
    } else if (!internalId && !ref) {
      outcome = "unresolvable";
      detail = "no internal id and no reference";
      if (APPLY) await logOutcome(order, outcome, detail, null);
    } else {
      outcome = "hard_deleted";
      detail = `tried id=${internalId ? "yes" : "no"} ref=${ref ? "yes" : "no"} search=yes`;
      gone.push(order);
      if (APPLY) await logOutcome(order, outcome, detail, null);
    }

    outcomes[outcome] += 1;
    console.log(
      `  ${pad(order.id.slice(0, 8), 10)} ${pad(nameById.get(order.carrier_id) ?? "", 26)} ` +
        `${pad(ref, 12)} ${pad(order.carrier_status_slug ?? "(null)", 11)} → ${pad(outcome, 14)} ${detail}`,
    );
  }

  console.log(`\n${"─".repeat(78)}\nOUTCOMES`);
  for (const [k, v] of Object.entries(outcomes)) console.log(`  ${pad(k, 16)} ${v}`);

  if (gone.length) {
    console.log(
      `\n  ${gone.length} order(s) have no shipment at Darb. These are NOT auto-cancelled —\n` +
        "  Darb losing a shipment says nothing about whether the customer got the parcel.\n" +
        "  They need a human decision. Internal status of those orders:",
    );
    const byStatus = new Map<string, number>();
    for (const g of gone) byStatus.set(g.status, (byStatus.get(g.status) ?? 0) + 1);
    for (const [s, n] of byStatus) console.log(`    ${pad(s, 20)} ${n}`);
    const oldest = gone[gone.length - 1];
    const newest = gone[0];
    console.log(`    date range: ${oldest?.created_at?.slice(0, 10)} … ${newest?.created_at?.slice(0, 10)}`);
  }

  if (DRY_RUN) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply to persist.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
