/**
 * Verify the order panel's Darb query against the live schema and real data.
 * Read-only. Runs the exact column list the route selects, so a renamed or
 * missing column fails here rather than as an empty panel in production.
 */
import { createClient } from "@supabase/supabase-js";

const SHIPMENT_COLS = `darb_id, reference, original_reference, status_slug,
  handler_name, handler_phone, handler_account_name, handler_account_phone,
  latest_remark, latest_remark_at, latest_comment, comment_count,
  cancellation_cause, delayed_until, cancel_count, resend_count,
  billed_shipping_amount, billed_currency, shipping_breakdown, cod_outstanding,
  delivery_withdrawal_at, completed_at,
  to_city, to_area, to_address, to_branch_group,
  service_title, priority, notes, attachments,
  last_synced_at, carrier_updated_at`;

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Column list resolves.
  const { data: probe, error: probeErr } = await admin
    .from("darb_shipments").select(SHIPMENT_COLS).limit(1);
  if (probeErr) throw new Error(`shipment columns: ${probeErr.message}`);
  console.log(`✓ darb_shipments column list resolves (${Object.keys(probe?.[0] ?? {}).length} fields)`);

  const { error: tlErr } = await admin
    .from("darb_timeline_events")
    .select("event_id, type, description_ar, description_en, remarks, actor_name, actor_phone, occurred_at")
    .limit(1);
  if (tlErr) throw new Error(`timeline columns: ${tlErr.message}`);
  console.log("✓ darb_timeline_events column list resolves");

  const { error: cErr } = await admin
    .from("darb_conversation").select("message_id, message, author_name, posted_at").limit(1);
  if (cErr) throw new Error(`conversation columns: ${cErr.message}`);
  console.log("✓ darb_conversation column list resolves");

  // 2. How many orders will actually render a populated panel?
  const { count: withCourier } = await admin.from("darb_shipments")
    .select("*", { count: "exact", head: true })
    .not("order_id", "is", null).not("handler_phone", "is", null);
  const { count: withNote } = await admin.from("darb_shipments")
    .select("*", { count: "exact", head: true })
    .not("order_id", "is", null).not("latest_remark", "is", null);
  const { count: withCost } = await admin.from("darb_shipments")
    .select("*", { count: "exact", head: true })
    .not("order_id", "is", null).not("billed_shipping_amount", "is", null);
  const { count: linked } = await admin.from("darb_shipments")
    .select("*", { count: "exact", head: true }).not("order_id", "is", null);

  console.log(`\nOrders whose panel will show:`);
  console.log(`  courier name + phone : ${withCourier} / ${linked}`);
  console.log(`  courier note         : ${withNote} / ${linked}`);
  console.log(`  real billed cost     : ${withCost} / ${linked}`);

  // 3. One real sample, as the panel will read it.
  const { data: sample } = await admin.from("darb_shipments")
    .select(SHIPMENT_COLS + ", order_id")
    .not("order_id", "is", null).not("handler_phone", "is", null)
    .not("latest_remark", "is", null).limit(1).maybeSingle();
  if (sample) {
    const s = sample as unknown as Record<string, unknown>;
    console.log(`\nSample order ${String(s.order_id).slice(0, 8)} (ref ${s.reference}):`);
    console.log(`  courier   : ${s.handler_name}  ${s.handler_phone}`);
    console.log(`  office    : ${s.handler_account_name}`);
    console.log(`  note      : ${s.latest_remark}`);
    console.log(`  billed    : ${s.billed_shipping_amount} ${s.billed_currency}  ${JSON.stringify(s.shipping_breakdown)}`);
    const { count: evs } = await admin.from("darb_timeline_events")
      .select("*", { count: "exact", head: true }).eq("darb_id", s.darb_id as string);
    console.log(`  events    : ${evs}`);
  }
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
