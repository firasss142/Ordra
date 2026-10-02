/**
 * The read-only preview of an order the agent found but does not hold.
 *
 * Deliberately NOT the order panel's payload (GET /api/orders/[id]): opening
 * the panel registers the agent's presence, and an agent's presence row blocks
 * manager writes — a curious agent would freeze the manager. This is a snapshot:
 * no presence, no realtime, nothing editable. Writes stay refused server-side
 * for non-owners anyway (the PATCH route 404s, `orders_update` RLS requires
 * `assigned_to = auth.uid()`), so view-only never rests on the UI alone.
 *
 * Service-role read, like lib/agent-search/market: the caller passes the
 * market from the session, and an order outside it does not exist.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderAccess, OrderOwner } from "./market";

export interface OrderPreviewItem {
  product_name: string | null;
  variant_label: string | null;
  quantity: number | null;
  line_total: number | null;
}

export interface OrderPreviewEvent {
  status_to: string;
  created_at: string;
  note: string | null;
  /** First name of whoever made the change; null for the system. */
  actor_name: string | null;
}

export interface OrderPreview {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  archived: boolean;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  customer_city: string | null;
  customer_address: string | null;
  total_price: number | null;
  currency: string | null;
  tracking_number: string | null;
  carrier_name: string | null;
  owner: OrderOwner;
  owner_name: string | null;
  access: OrderAccess;
  items: OrderPreviewItem[];
  history: OrderPreviewEvent[];
}

const ORDER_SELECT =
  "id, market_id, external_id, status, assigned_to, customer_name, customer_phone, customer_phone_2, customer_city, customer_address, product_name, variant_label, quantity, total_price, currency, carrier_id, tracking_number, created_at, archived_at";

const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;

export async function loadOrderPreview(
  client: SupabaseClient,
  opts: { orderId: string; marketId: string; meId: string },
): Promise<OrderPreview | null> {
  const { data: order, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", opts.orderId)
    .eq("market_id", opts.marketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  const o = order as Record<string, unknown> & { assigned_to: string | null; carrier_id: string | null };

  const [itemsRes, historyRes, carrierRes] = await Promise.all([
    client
      .from("order_items")
      .select("product_name, variant_label, quantity, line_total, created_at")
      .eq("order_id", opts.orderId)
      .order("created_at", { ascending: true }),
    client
      .from("order_history")
      .select("status_to, note, actor_id, created_at")
      .eq("order_id", opts.orderId)
      .order("created_at", { ascending: true }),
    o.carrier_id
      ? client.from("carriers").select("name").eq("id", o.carrier_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const events = (historyRes.data ?? []) as {
    status_to: string;
    note: string | null;
    actor_id: string | null;
    created_at: string;
  }[];

  // One users read for the holder and every actor of the timeline.
  const people = [...new Set([o.assigned_to, ...events.map((e) => e.actor_id)].filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (people.length > 0) {
    const { data: users } = await client.from("users").select("id, full_name").in("id", people);
    for (const u of (users ?? []) as { id: string; full_name: string | null }[]) {
      names.set(u.id, firstName(u.full_name));
    }
  }

  const lines = (itemsRes.data ?? []) as OrderPreviewItem[];
  // Orders that predate multi-line intake carry their one line on the order.
  const items: OrderPreviewItem[] = lines.length
    ? lines.map((l) => ({
        product_name: l.product_name,
        variant_label: l.variant_label,
        quantity: l.quantity,
        line_total: l.line_total,
      }))
    : [
        {
          product_name: (o.product_name as string | null) ?? null,
          variant_label: (o.variant_label as string | null) ?? null,
          quantity: (o.quantity as number | null) ?? null,
          line_total: (o.total_price as number | null) ?? null,
        },
      ];

  const owner: OrderOwner = o.assigned_to === opts.meId ? "me" : o.assigned_to ? "other" : "none";

  return {
    id: o.id as string,
    external_id: (o.external_id as string | null) ?? null,
    status: o.status as string,
    created_at: o.created_at as string,
    archived: o.archived_at !== null && o.archived_at !== undefined,
    customer_name: (o.customer_name as string | null) ?? null,
    customer_phone: (o.customer_phone as string | null) ?? null,
    customer_phone_2: (o.customer_phone_2 as string | null) ?? null,
    customer_city: (o.customer_city as string | null) ?? null,
    customer_address: (o.customer_address as string | null) ?? null,
    total_price: (o.total_price as number | null) ?? null,
    currency: (o.currency as string | null) ?? null,
    tracking_number: (o.tracking_number as string | null) ?? null,
    carrier_name: ((carrierRes.data as { name?: string } | null)?.name as string | undefined) ?? null,
    owner,
    owner_name: owner === "other" ? names.get(o.assigned_to!) ?? null : null,
    access: owner === "me" ? "full" : "view",
    items,
    history: events.map((e) => ({
      status_to: e.status_to,
      created_at: e.created_at,
      note: e.note,
      actor_name: e.actor_id ? names.get(e.actor_id) ?? null : null,
    })),
  };
}
