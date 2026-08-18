import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { DARB_STATUSES, type DarbSlug } from "@/lib/carriers/darb-assabil-statuses";

/**
 * GET /api/darb/control-room
 *
 * Everything the Darb Assabil operations panel needs, in one call:
 *   - per-account funnel across the carrier's own 11 statuses (not our 4-state
 *     phase-2 model, which Darb orders never enter — that is exactly why they
 *     were invisible on /in-delivery)
 *   - sync health: last successful sweep per account + whether the schedule is live
 *   - shipments sitting on the same carrier status too long, with the COURIER'S
 *     NAME, PHONE and their own note about why
 *   - orders whose shipment no longer exists at Darb (hard-deleted there) — these
 *     need a human decision and are otherwise invisible
 *   - real vs assumed delivery cost
 *
 * Reads the local mirror, so it is fast and works even if the carrier is down.
 * Auth: RLS-scoped client; market isolation enforced at the data layer.
 */

export const dynamic = "force-dynamic";

const STUCK_DAYS = 4;
const LIST_LIMIT = 100;
const TERMINAL: DarbSlug[] = ["completed", "returned", "cancelled"];

export interface DarbAccountFunnel {
  carrier_id: string;
  carrier_name: string;
  total: number;
  by_status: Record<string, number>;
  in_flight: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  minutes_since_sync: number | null;
}

export interface DarbStuckShipment {
  order_id: string | null;
  darb_id: string;
  reference: string | null;
  status_slug: string | null;
  carrier_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  to_city: string | null;
  /** The courier currently holding the parcel. */
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  /** The courier's own note about why it hasn't moved. */
  latest_remark: string | null;
  latest_comment: string | null;
  delayed_until: string | null;
  days_on_status: number;
  latest_event_at: string | null;
}

export interface DarbLostOrder {
  order_id: string;
  tracking_number: string | null;
  status: string;
  carrier_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  product_name: string | null;
  total_price: number | null;
  created_at: string;
  days_stranded: number;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: carrierRows, error: carrierErr } = await supabase
    .from("carriers")
    .select("id, name")
    .eq("code", "darb_assabil");
  if (carrierErr) {
    return NextResponse.json({ error: carrierErr.message }, { status: 500 });
  }
  const carriers = carrierRows ?? [];
  const nameById = new Map(carriers.map((c) => [c.id as string, c.name as string]));
  if (carriers.length === 0) {
    return NextResponse.json({ accounts: [], stuck: [], lost: [], cost: null, cron: null });
  }

  const now = Date.now();
  const DAY = 86_400_000;

  // ── Funnel per account ──────────────────────────────────────────────
  const { data: shipmentRows } = await supabase
    .from("darb_shipments")
    .select("carrier_id, status_slug");

  const funnelByCarrier = new Map<string, Record<string, number>>();
  for (const s of shipmentRows ?? []) {
    const cid = s.carrier_id as string | null;
    if (!cid) continue;
    const slug = (s.status_slug as string | null) ?? "unknown";
    const bucket = funnelByCarrier.get(cid) ?? {};
    bucket[slug] = (bucket[slug] ?? 0) + 1;
    funnelByCarrier.set(cid, bucket);
  }

  // ── Sync health ─────────────────────────────────────────────────────
  const { data: runRows } = await supabase
    .from("darb_sync_runs")
    .select("carrier_id, finished_at, status")
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(50);
  const lastRunByCarrier = new Map<string, { at: string; status: string }>();
  for (const r of runRows ?? []) {
    const cid = r.carrier_id as string | null;
    if (!cid || lastRunByCarrier.has(cid)) continue;
    if (r.finished_at) {
      lastRunByCarrier.set(cid, { at: r.finished_at as string, status: r.status as string });
    }
  }

  const accounts: DarbAccountFunnel[] = carriers.map((c) => {
    const by_status = funnelByCarrier.get(c.id as string) ?? {};
    const total = Object.values(by_status).reduce((a, b) => a + b, 0);
    const in_flight = Object.entries(by_status)
      .filter(([slug]) => !TERMINAL.includes(slug as DarbSlug))
      .reduce((a, [, n]) => a + n, 0);
    const last = lastRunByCarrier.get(c.id as string) ?? null;
    return {
      carrier_id: c.id as string,
      carrier_name: c.name as string,
      total,
      by_status,
      in_flight,
      last_sync_at: last?.at ?? null,
      last_sync_status: last?.status ?? null,
      minutes_since_sync: last ? Math.round((now - Date.parse(last.at)) / 60000) : null,
    };
  });

  // ── Stuck in-flight shipments ───────────────────────────────────────
  const staleBefore = new Date(now - STUCK_DAYS * DAY).toISOString();
  const { data: stuckRows } = await supabase
    .from("darb_shipments")
    .select(
      `darb_id, order_id, carrier_id, reference, status_slug, to_city,
       handler_name, handler_phone, handler_account_name,
       latest_remark, latest_comment, delayed_until, latest_event_at,
       orders!darb_shipments_order_id_fkey ( customer_name, customer_phone )`,
    )
    .not("status_slug", "in", `(${TERMINAL.join(",")})`)
    .lt("latest_event_at", staleBefore)
    .order("latest_event_at", { ascending: true })
    .limit(LIST_LIMIT);

  const stuck: DarbStuckShipment[] = (stuckRows ?? []).map((s) => {
    const o = (s.orders ?? null) as { customer_name?: string; customer_phone?: string } | null;
    const eventAt = s.latest_event_at as string | null;
    return {
      order_id: (s.order_id as string | null) ?? null,
      darb_id: s.darb_id as string,
      reference: (s.reference as string | null) ?? null,
      status_slug: (s.status_slug as string | null) ?? null,
      carrier_name: nameById.get(s.carrier_id as string) ?? "—",
      customer_name: o?.customer_name ?? null,
      customer_phone: o?.customer_phone ?? null,
      to_city: (s.to_city as string | null) ?? null,
      handler_name: (s.handler_name as string | null) ?? null,
      handler_phone: (s.handler_phone as string | null) ?? null,
      handler_account_name: (s.handler_account_name as string | null) ?? null,
      latest_remark: (s.latest_remark as string | null) ?? null,
      latest_comment: (s.latest_comment as string | null) ?? null,
      delayed_until: (s.delayed_until as string | null) ?? null,
      latest_event_at: eventAt,
      days_on_status: eventAt ? Math.floor((now - Date.parse(eventAt)) / DAY) : 0,
    };
  });

  // ── Orders whose shipment no longer exists at Darb ───────────────────
  // Darb's DELETE is a hard delete: the shipment vanishes from every list and
  // tab. These orders are NOT auto-cancelled — the carrier losing a shipment
  // says nothing about whether the customer received the parcel.
  const { data: mirroredRows } = await supabase
    .from("darb_shipments")
    .select("order_id")
    .not("order_id", "is", null);
  const mirrored = new Set((mirroredRows ?? []).map((r) => r.order_id as string));

  const { data: darbOrders } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, status, carrier_id, customer_name, customer_phone, customer_city, product_name, total_price, created_at",
    )
    .in(
      "carrier_id",
      carriers.map((c) => c.id as string),
    )
    .not("status", "in", "(delivered,returned,cancelled,rejected,deleted)")
    .order("created_at", { ascending: true });

  const lost: DarbLostOrder[] = (darbOrders ?? [])
    .filter((o) => !mirrored.has(o.id as string))
    .slice(0, LIST_LIMIT)
    .map((o) => ({
      order_id: o.id as string,
      tracking_number: (o.tracking_number as string | null) ?? null,
      status: o.status as string,
      carrier_name: nameById.get(o.carrier_id as string) ?? "—",
      customer_name: (o.customer_name as string | null) ?? null,
      customer_phone: (o.customer_phone as string | null) ?? null,
      customer_city: (o.customer_city as string | null) ?? null,
      product_name: (o.product_name as string | null) ?? null,
      total_price: o.total_price === null ? null : Number(o.total_price),
      created_at: o.created_at as string,
      days_stranded: Math.floor((now - Date.parse(o.created_at as string)) / DAY),
    }));

  // ── Real vs assumed delivery cost ───────────────────────────────────
  const { data: costRows } = await supabase
    .from("darb_shipments")
    .select("carrier_id, billed_shipping_amount")
    .not("billed_shipping_amount", "is", null);
  const costByCarrier = new Map<string, number[]>();
  for (const r of costRows ?? []) {
    const cid = r.carrier_id as string | null;
    if (!cid) continue;
    const list = costByCarrier.get(cid) ?? [];
    list.push(Number(r.billed_shipping_amount));
    costByCarrier.set(cid, list);
  }
  const cost = carriers.map((c) => {
    const amounts = costByCarrier.get(c.id as string) ?? [];
    const n = amounts.length;
    return {
      carrier_id: c.id as string,
      carrier_name: c.name as string,
      shipments_priced: n,
      avg_billed: n ? Math.round((amounts.reduce((a, b) => a + b, 0) / n) * 100) / 100 : null,
      min_billed: n ? Math.min(...amounts) : null,
      max_billed: n ? Math.max(...amounts) : null,
    };
  });

  // Honest cadence: report what pg_cron actually says, never a hardcoded claim.
  const { data: cronRows } = await supabase.rpc("darb_cron_status");
  const cron = Array.isArray(cronRows) && cronRows.length > 0 ? cronRows[0] : null;

  return NextResponse.json({
    accounts,
    statuses: DARB_STATUSES,
    stuck,
    lost,
    lost_total: (darbOrders ?? []).filter((o) => !mirrored.has(o.id as string)).length,
    cost,
    cron,
    stuck_days_threshold: STUCK_DAYS,
  });
}
