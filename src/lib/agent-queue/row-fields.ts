/**
 * The `orders` columns the agent queue actually consumes — one source of truth
 * for both ends of the pipe.
 *
 * The route builds its PostgREST select list from this, and the realtime
 * subscriber narrows incoming postgres_changes rows to it before merging. That
 * pairing is the point: a realtime payload carries ALL 59 order columns, so
 * without narrowing, a patched row would quietly regain everything the select
 * list dropped — including raw_payload — and cache-patch's shallowEqual, which
 * compares key counts, would report "changed" on every single event.
 *
 * WHY NOT select("*"): it shipped raw_payload (372 bytes/row averaged over the
 * 1,608 rows in agent queues fleet-wide — the largest key on the wire, read by
 * nothing in the agent interface) plus ~21 columns with no consumer at all.
 *
 * Every field here has a named reader. The gate is toQueueOrder in
 * QueuePage.tsx; anything it does not map is invisible to the UI regardless of
 * what the server sends, and toQueueOrder.test.ts asserts the two agree.
 */
export const QUEUE_ROW_FIELDS = [
  // identity + ownership (cache-patch, buckets, RLS-visible assignment)
  "id",
  "market_id",
  "assigned_to",
  "external_id", // human order reference, seeds the detail panel header
  "status",

  // customer (card, search, and both enrichment RPC payloads)
  "customer_name",
  "customer_phone",
  "customer_phone_2",
  "customer_address",
  "customer_city",
  "customer_note",

  // product + money
  "product_id",
  "product_name",
  "variant_label",
  "quantity",
  "total_price",
  "currency",

  // carrier
  "carrier_id",
  "tracking_number",
  "carrier_barcode_deleted_at",

  // queue mechanics (sort, bucketing, attempt ladder)
  "attempts_count",
  "callback_scheduled_at",
  "scheduled_dispatch_at",
  "scheduled_dispatch_auto",
  "created_at",
  "updated_at", // closed-list ordering

  // rejection taxonomy (drives the status pill's label)
  "rejection_reason",
  "rejection_subreason",
  "rejection_note",

  // carrier status pills
  "dexpress_status_slug",
  "dexpress_status_synced_at",
  "dexpress_status_accepted",
  "carrier_status_slug",
  "carrier_status_synced_at",
] as const;

const FIELD_SET: ReadonlySet<string> = new Set(QUEUE_ROW_FIELDS);

/**
 * The PostgREST select list, plus the two embeds the route flattens onto each
 * row as product_image_url / product_display_name / carrier_code / carrier_name.
 * Realtime never carries those — see pickQueueFields.
 *
 * Spelled out as a string LITERAL rather than QUEUE_ROW_FIELDS.join(", "):
 * supabase-js parses the select at the type level to infer the row shape, and a
 * computed string collapses it to GenericStringError. row-fields.test.ts
 * asserts the literal and the array stay in step, so the duplication cannot
 * drift silently.
 */
// Deliberately one unbroken literal: supabase-js parses this at the type level
// to infer the row shape and to reject a column that does not exist on `orders`
// (the guard behind the existing "orders SELECT only references columns that
// exist" regression test). Concatenation or .join() widens it to `string` and
// the inference collapses to GenericStringError, taking that check with it.
// eslint-disable-next-line max-len
export const QUEUE_ROW_SELECT = "id, market_id, assigned_to, external_id, status, customer_name, customer_phone, customer_phone_2, customer_address, customer_city, customer_note, product_id, product_name, variant_label, quantity, total_price, currency, carrier_id, tracking_number, carrier_barcode_deleted_at, attempts_count, callback_scheduled_at, scheduled_dispatch_at, scheduled_dispatch_auto, created_at, updated_at, rejection_reason, rejection_subreason, rejection_note, dexpress_status_slug, dexpress_status_synced_at, dexpress_status_accepted, carrier_status_slug, carrier_status_synced_at, product:products(image_url, name), carrier:carriers!orders_carrier_id_fkey(code, name)";

/**
 * Narrow a raw realtime row to the same shape the route returns.
 *
 * Derived fields (product_display_name, carrier_code, repeat_kind,
 * duplicate_siblings, last_action_at, …) are deliberately NOT in the result:
 * they are computed server-side and have no realtime equivalent. Dropping them
 * here means a spread merge `{ ...prev, ...narrowed }` keeps the previous
 * server-derived values instead of clobbering them with undefined — which is
 * why this returns only keys actually present on the incoming row.
 */
export function pickQueueFields<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (FIELD_SET.has(key)) out[key] = row[key];
  }
  return out;
}
