import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";

/**
 * Commandes répétées (prototypes/commandes-v4.html `cases()`): the same client,
 * several orders — those who came back, and the duplicates to clean up.
 *
 * A case is one client: their orders (a duplicate group counted once), the
 * group to clean when there is one, and a reliability read from what happened
 * to their orders. Built in the page from /api/orders/repeat-customers and
 * /api/orders/duplicates, so the two sources stay one view.
 */

export interface RepeatOrder {
  id: string;
  external_id: string | null;
  created_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  customer_address: string | null;
  product_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  assigned_to: string | null;
  storefront_id: string | null;
  rejection_reason: string | null;
  rejection_subreason: string | null;
  callback_scheduled_at: string | null;
  attempts_count: number | null;
}

export interface RepeatCustomerRow {
  customer_id: string;
  last_at: string;
  orders: RepeatOrder[];
}

/** risk « À risque » · ok « Fiable » · mid « Moyen » · new « Nouveau client » (nothing to judge yet) */
export type Reliability = "risk" | "ok" | "mid" | "new";

export interface RepeatCase {
  key: string;
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
  /** Every order, oldest first, a duplicate group counted once (its first order). */
  orders: RepeatOrder[];
  group: DuplicateGroup | null;
  delivered: number;
  /** rejected + returned */
  bad: number;
  /** still being worked or on the road */
  live: number;
  rel: Reliability;
  lastAt: string;
}

export const FINAL_STATUSES = new Set(["delivered", "returned", "rejected", "cancelled"]);
const LOST = new Set(["rejected", "returned"]);

export function reliabilityOf(orders: { status: string }[]): { rel: Reliability; delivered: number; bad: number } {
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const bad = orders.filter((o) => LOST.has(o.status)).length;
  const rel: Reliability =
    orders.length < 2 ? "new" : bad >= 2 && bad > delivered ? "risk" : delivered && !bad ? "ok" : "mid";
  return { rel, delivered, bad };
}

const byTime = <T extends { created_at: string }>(a: T, b: T) => Date.parse(a.created_at) - Date.parse(b.created_at);

/** A group member read as an order of the trail (the group carries no phone, agent or store). */
function memberAsOrder(m: DuplicateGroupMember, phone: string): RepeatOrder {
  return {
    id: m.id,
    external_id: m.external_id,
    created_at: m.created_at,
    status: m.status,
    customer_name: m.customer_name,
    customer_phone: phone,
    customer_city: m.customer_city,
    customer_address: m.customer_address,
    product_id: m.product_id,
    product_name: m.product_name,
    product_image_url: m.product_image_url,
    variant_label: null,
    quantity: m.quantity,
    total_price: m.total_price,
    assigned_to: null,
    storefront_id: null,
    rejection_reason: null,
    rejection_subreason: null,
    callback_scheduled_at: null,
    attempts_count: null,
  };
}

function shape(key: string, all: RepeatOrder[], group: DuplicateGroup | null, phoneHint: string): RepeatCase {
  const sorted = [...all].sort(byTime);
  const groupIds = new Set(group?.members.map((m) => m.id) ?? []);
  const firstOfGroup = sorted.find((o) => groupIds.has(o.id));
  const orders = sorted.filter((o) => !groupIds.has(o.id) || o === firstOfGroup);
  const { rel, delivered, bad } = reliabilityOf(orders);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    key,
    name: first?.customer_name?.trim() || "—",
    phone: first?.customer_phone || phoneHint,
    city: last?.customer_city || first?.customer_city || null,
    address: last?.customer_address || first?.customer_address || null,
    orders,
    group,
    delivered,
    bad,
    live: orders.filter((o) => !FINAL_STATUSES.has(o.status)).length,
    rel,
    lastAt: last?.created_at ?? "",
  };
}

export function buildCases(customers: RepeatCustomerRow[], groups: DuplicateGroup[]): RepeatCase[] {
  const out: RepeatCase[] = [];
  const claimed = new Set<string>();
  const groupOf = new Map<string, DuplicateGroup>();
  for (const g of groups) for (const m of g.members) groupOf.set(m.id, g);

  for (const c of customers) {
    const g = c.orders.map((o) => groupOf.get(o.id)).find(Boolean) ?? null;
    if (g) claimed.add(g.key);
    const shaped = shape(c.customer_id, c.orders, g, "");
    if (g || shaped.orders.length >= 2) out.push(shaped);
  }
  // A duplicate whose client is not in the history read (no customer link, or
  // nothing this week) is still a client to clean up.
  for (const g of groups) {
    if (claimed.has(g.key)) continue;
    const phone = g.key.split("|")[0] ?? "";
    out.push(shape(`g:${g.key}`, g.members.map((m) => memberAsOrder(m, phone)), g, phone));
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** The order the cleanup keeps: the one picked with ★, else the one at the carrier, else the first. */
export function keepOf(g: DuplicateGroup, picked: Record<string, string>): string {
  if (picked[g.key] && g.members.some((m) => m.id === picked[g.key])) return picked[g.key];
  const sorted = [...g.members].sort(byTime);
  return (sorted.find((m) => m.already_shipped) ?? sorted[0]).id;
}

/** The copies that can go: not the kept one, not shipped, still deletable. Oldest first. */
export function copiesOf(g: DuplicateGroup, picked: Record<string, string>): DuplicateGroupMember[] {
  const keep = keepOf(g, picked);
  return [...g.members].sort(byTime).filter((m) => m.id !== keep && !m.already_shipped && m.deletable);
}
