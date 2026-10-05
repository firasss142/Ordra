/**
 * Finances › Achats (prototypes/finances-achats-v1.html) — « ce que vous devez,
 * à qui, et quand ».
 *
 * Pure: the loader hands the market's receptions, claims, purchase orders and
 * suppliers; this file turns them into the four work lists of the page —
 * À payer, À solder, En commande, Fournisseurs — and the counts on the tiles.
 *
 * The rules are the ones already written in src/lib/purchases: the debt is the
 * invoice minus payments minus what an open or credited claim holds back
 * (derive.ts + claims.ts); an order's progress and a supplier's reliability come
 * from orders.ts. Nothing here invents a figure the base does not hold: there is
 * no deposit, no payment term and no local/import kind in the data model yet,
 * so none appears.
 */
import { payable } from "@/lib/purchases/derive";
import { claimEffect, type ClaimKind, type SupplierClaim } from "@/lib/purchases/claims";
import {
  projectPurchaseOrder,
  supplierReliability,
  type PurchaseOrderRow,
} from "@/lib/purchases/orders";

/** A bill due within this many days is « cette semaine ». */
export const WEEK_DAYS = 7;

export interface ReceptionIn {
  id: string;
  reference: string | null;
  /** open (counted at the dock) · settled (priced, a debt) · reversed */
  status: string;
  warehouseId: string;
  arrivalDate: string | null;
  createdAt: string;
  settledAt: string | null;
  /** who counted it at the dock */
  countedBy: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** the supplier's invoice number */
  supplierRef: string | null;
  invoiceTotal: number | null;
  dueAt: string | null;
  feeBasis: "value" | "units";
  payments: { amount: number }[];
  costs: { id: string; kind: string; amount: number }[];
  lines: {
    id: string;
    productId: string;
    name: string;
    variant: string | null;
    /** units counted in good state — what entered stock */
    received: number;
    damaged: number;
    unitCost: number | null;
  }[];
}

export interface PurchasesInput {
  /** the market's day, YYYY-MM-DD */
  today: string;
  warehouses: { id: string; name: string; isDefault?: boolean }[];
  suppliers: { id: string; name: string; category: string | null; city: string | null; isActive: boolean }[];
  receptions: ReceptionIn[];
  claims: SupplierClaim[];
  orders: PurchaseOrderRow[];
  /** a dock count attached to a purchase-order line */
  links: { receptionLineId: string; poRef: string; poSupplierId: string; poLineUnitCost: number | null }[];
  products: { id: string; name: string }[];
  suggestions: { productId: string; name: string; siteId: string; qty: number; value: number; days: number | null }[];
}

export type Bucket = "late" | "week" | "later";

export interface Bill {
  receptionId: string;
  ref: string | null;
  supplierId: string | null;
  supplierName: string | null;
  siteName: string | null;
  receivedOn: string | null;
  items: { name: string; qty: number }[];
  total: number;
  paid: number;
  held: number;
  /** the held amount is still disputed (not yet credited) */
  heldOpen: boolean;
  heldUnits: number | null;
  left: number;
  dueAt: string | null;
  bucket: Bucket;
  daysLate: number | null;
  daysLeft: number | null;
  /** everything this supplier is owed, this bill included */
  supplierOwed: number;
}

export interface ArrivalLine {
  id: string;
  productId: string;
  name: string;
  variant: string | null;
  received: number;
  damaged: number;
  /** pre-filled price; null when nothing is known */
  price: number | null;
  hint: { kind: "current" | "po" | "last" | "none"; value: number | null };
}

export interface Arrival {
  receptionId: string;
  siteId: string;
  siteName: string | null;
  day: string | null;
  countedBy: string | null;
  countedAt: string;
  supplierId: string | null;
  supplierRef: string | null;
  poRefs: string[];
  feeBasis: "value" | "units";
  fees: { freight: number; customs: number; other: number };
  /** cost rows already typed, by kind — the drawer replaces freight and customs */
  costIds: { freight: string[]; customs: string[] };
  units: number;
  damaged: number;
  lines: ArrivalLine[];
}

export type OrderState = "late" | "partial" | "week" | "waiting";

export interface OrderCard {
  id: string;
  ref: string;
  supplierId: string;
  supplierName: string | null;
  siteId: string;
  siteName: string | null;
  items: { name: string; qty: number }[];
  /** Σ qty × announced price; null as soon as one line has no price */
  total: number | null;
  ordered: number;
  received: number;
  orderedAt: string;
  wantedBy: string | null;
  firstReceivedAt: string | null;
  state: OrderState;
  daysLate: number | null;
}

export interface SupplierCard {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  owed: number;
  overdue: number;
  openOrders: number;
  /** % received of ordered on CLOSED orders; null without a sample */
  fillRate: number | null;
  sampleOrders: number;
  leadTimeDays: number | null;
  /** arrivals waiting to be settled that point at this supplier */
  toSettle: number;
  claims: { id: string; amount: number; units: number | null; kind: ClaimKind; receptionRef: string | null }[];
}

export interface PurchasesView {
  today: string;
  tiles: {
    owed: number;
    late: number;
    toSettle: number;
    openOrders: number;
    arrivingThisWeek: number;
    suppliers: number;
    openClaims: number;
  };
  buckets: { key: Bucket; total: number; count: number; suppliers: string[] }[];
  bills: Bill[];
  /** settled without an invoice: owed, amount unknown */
  unknownBills: number;
  arrivals: Arrival[];
  orders: OrderCard[];
  /** what the open orders commit, on the lines that carry a price */
  committed: number;
  suggestions: (PurchasesInput["suggestions"][number] & { siteName: string | null })[];
  suppliers: SupplierCard[];
  catalogue: { id: string; name: string; lastPrice: number | null; lastSupplierId: string | null }[];
  warehouses: { id: string; name: string; isDefault?: boolean }[];
}

const DAY_MS = 86_400_000;
const EPS = 0.0005;
const noon = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const daysFrom = (from: string, to: string) => Math.round((noon(to) - noon(from)) / DAY_MS);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function itemsOf(lines: { name: string; qty: number }[]) {
  const by = new Map<string, number>();
  for (const l of lines) if (l.qty > 0) by.set(l.name, (by.get(l.name) ?? 0) + l.qty);
  return [...by].map(([name, qty]) => ({ name, qty }));
}

export function buildPurchasesView(input: PurchasesInput): PurchasesView {
  const today = input.today;
  const todayDate = new Date(noon(today));
  const site = new Map(input.warehouses.map((w) => [w.id, w.name]));
  const supplierName = new Map(input.suppliers.map((s) => [s.id, s.name]));

  const live = input.receptions.filter((r) => r.status !== "reversed" && r.status !== "cancelled");
  const settled = live.filter((r) => r.status !== "open");

  // ── what a claim holds back, per reception ─────────────────────────────────
  const held = new Map<string, { amount: number; open: boolean; units: number | null }>();
  for (const c of input.claims) {
    if (!c.receptionId) continue;
    const e = claimEffect(c);
    if (e.withheld === 0) continue;
    const cur = held.get(c.receptionId) ?? { amount: 0, open: false, units: null };
    cur.amount += e.withheld;
    if (c.status === "open") {
      cur.open = true;
      if (c.units !== null) cur.units = (cur.units ?? 0) + c.units;
    }
    held.set(c.receptionId, cur);
  }

  // ── À payer ────────────────────────────────────────────────────────────────
  let unknownBills = 0;
  const bills: Bill[] = [];
  for (const r of settled) {
    const paid = round3(r.payments.reduce((a, p) => a + Number(p.amount || 0), 0));
    const h = held.get(r.id);
    const p = payable({ invoiceTotal: r.invoiceTotal, paid, dueAt: r.dueAt, withheld: h?.amount ?? 0 }, todayDate);
    if (p.state === "unknown") {
      unknownBills += 1;
      continue;
    }
    if (p.state === "paid" || p.balance === null) continue;
    const daysLeft = r.dueAt && p.state !== "overdue" ? daysFrom(today, r.dueAt) : null;
    const bucket: Bucket = p.state === "overdue" ? "late" : daysLeft !== null && daysLeft <= WEEK_DAYS ? "week" : "later";
    bills.push({
      receptionId: r.id,
      ref: r.reference,
      supplierId: r.supplierId,
      supplierName: (r.supplierId ? supplierName.get(r.supplierId) : null) ?? r.supplierName,
      siteName: site.get(r.warehouseId) ?? null,
      receivedOn: r.arrivalDate ?? r.settledAt ?? r.createdAt,
      items: itemsOf(r.lines.map((l) => ({ name: l.name, qty: l.received }))),
      total: r.invoiceTotal as number,
      paid,
      held: round3(h?.amount ?? 0),
      heldOpen: h?.open ?? false,
      heldUnits: h?.open ? h.units : null,
      left: round3(p.balance),
      dueAt: r.dueAt,
      bucket,
      daysLate: p.daysLate,
      daysLeft,
      supplierOwed: 0,
    });
  }
  const BUCKET_ORDER: Bucket[] = ["late", "week", "later"];
  bills.sort((a, b) => {
    const k = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (k) return k;
    if (a.daysLate !== null || b.daysLate !== null) return (b.daysLate ?? -1) - (a.daysLate ?? -1);
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return b.left - a.left;
  });
  const owedBy = new Map<string, { owed: number; overdue: number }>();
  for (const b of bills) {
    if (!b.supplierId) continue;
    const cur = owedBy.get(b.supplierId) ?? { owed: 0, overdue: 0 };
    cur.owed = round3(cur.owed + b.left);
    if (b.bucket === "late") cur.overdue = round3(cur.overdue + b.left);
    owedBy.set(b.supplierId, cur);
  }
  for (const b of bills) b.supplierOwed = b.supplierId ? owedBy.get(b.supplierId)!.owed : b.left;

  const buckets = BUCKET_ORDER.map((key) => {
    const mine = bills.filter((b) => b.bucket === key);
    return {
      key,
      total: round3(mine.reduce((a, b) => a + b.left, 0)),
      count: mine.length,
      suppliers: [...new Set(mine.map((b) => b.supplierName ?? "—"))],
    };
  });

  // ── the last price paid, per product (settled receptions, then orders) ────
  const last = new Map<string, { price: number; supplierId: string | null; at: string }>();
  const offer = (product: string, price: number | null, supplierId: string | null, at: string) => {
    if (price === null || price === undefined) return;
    const cur = last.get(product);
    if (!cur || at > cur.at) last.set(product, { price: Number(price), supplierId, at });
  };
  for (const r of settled) for (const l of r.lines) offer(l.productId, l.unitCost, r.supplierId, r.settledAt ?? r.arrivalDate ?? r.createdAt);
  const fromReceptions = new Set(last.keys());
  for (const o of input.orders)
    for (const l of o.lines) if (!fromReceptions.has(l.product_id)) offer(l.product_id, l.unit_cost, o.supplier_id, o.ordered_at);

  // ── À solder ───────────────────────────────────────────────────────────────
  const linkBy = new Map<string, PurchasesInput["links"][number][]>();
  for (const k of input.links) linkBy.set(k.receptionLineId, [...(linkBy.get(k.receptionLineId) ?? []), k]);
  const arrivals: Arrival[] = live
    .filter((r) => r.status === "open" && r.lines.some((l) => l.received > 0 || l.damaged > 0))
    .sort((a, b) => (b.arrivalDate ?? b.createdAt).localeCompare(a.arrivalDate ?? a.createdAt))
    .map((r) => {
      const counted = r.lines.filter((l) => l.received > 0 || l.damaged > 0);
      const links = counted.flatMap((l) => linkBy.get(l.id) ?? []);
      const fees = { freight: 0, customs: 0, other: 0 };
      const costIds = { freight: [] as string[], customs: [] as string[] };
      for (const c of r.costs) {
        const k = c.kind === "freight" || c.kind === "customs" ? c.kind : "other";
        fees[k] = round3(fees[k] + Number(c.amount || 0));
        if (k !== "other") costIds[k].push(c.id);
      }
      return {
        receptionId: r.id,
        siteId: r.warehouseId,
        siteName: site.get(r.warehouseId) ?? null,
        day: r.arrivalDate,
        countedBy: r.countedBy,
        countedAt: r.createdAt,
        supplierId: r.supplierId ?? links[0]?.poSupplierId ?? null,
        supplierRef: r.supplierRef,
        poRefs: [...new Set(links.map((k) => k.poRef))],
        feeBasis: r.feeBasis,
        fees,
        costIds,
        units: counted.reduce((a, l) => a + l.received, 0),
        damaged: counted.reduce((a, l) => a + l.damaged, 0),
        lines: counted.map((l) => {
          const poPrice = (linkBy.get(l.id) ?? []).find((k) => k.poLineUnitCost !== null)?.poLineUnitCost ?? null;
          const lastPrice = last.get(l.productId)?.price ?? null;
          const hint: ArrivalLine["hint"] =
            l.unitCost !== null
              ? { kind: "current", value: Number(l.unitCost) }
              : poPrice !== null
                ? { kind: "po", value: Number(poPrice) }
                : lastPrice !== null
                  ? { kind: "last", value: lastPrice }
                  : { kind: "none", value: null };
          return { id: l.id, productId: l.productId, name: l.name, variant: l.variant, received: l.received, damaged: l.damaged, price: hint.value, hint };
        }),
      };
    });

  // ── En commande ────────────────────────────────────────────────────────────
  const STATE_ORDER: OrderState[] = ["late", "partial", "week", "waiting"];
  const orders: OrderCard[] = input.orders
    .filter((o) => o.status === "open")
    .map((o) => {
      const p = projectPurchaseOrder(o, todayDate);
      const wantedIn = o.wanted_by ? daysFrom(today, o.wanted_by) : null;
      const state: OrderState = p.is_late
        ? "late"
        : p.received_units > 0
          ? "partial"
          : wantedIn !== null && wantedIn <= WEEK_DAYS
            ? "week"
            : "waiting";
      const firsts = o.lines.map((l) => l.first_received_at).filter((d): d is string => !!d).sort();
      return {
        id: o.id,
        ref: o.reference,
        supplierId: o.supplier_id,
        supplierName: supplierName.get(o.supplier_id) ?? o.supplier_name,
        siteId: o.warehouse_id,
        siteName: site.get(o.warehouse_id) ?? o.warehouse_name,
        items: itemsOf(o.lines.map((l) => ({ name: l.variant_label ? `${l.product_name} · ${l.variant_label}` : l.product_name, qty: l.ordered_qty }))),
        total: p.committed_value === null ? null : round3(p.committed_value),
        ordered: p.ordered_units,
        received: p.received_units,
        orderedAt: o.ordered_at,
        wantedBy: o.wanted_by,
        firstReceivedAt: firsts[0] ?? null,
        state,
        daysLate: p.days_late,
      };
    })
    .sort((a, b) => {
      if (a.state === "late" || b.state === "late") {
        const k = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
        if (k) return k;
        return (b.daysLate ?? 0) - (a.daysLate ?? 0);
      }
      if (a.wantedBy && b.wantedBy) return a.wantedBy.localeCompare(b.wantedBy);
      if (a.wantedBy) return -1;
      if (b.wantedBy) return 1;
      return a.orderedAt.localeCompare(b.orderedAt);
    });
  const arrivingThisWeek = orders.filter((o) => o.state !== "late" && o.wantedBy !== null && daysFrom(today, o.wantedBy) >= 0 && daysFrom(today, o.wantedBy) <= WEEK_DAYS).length;

  // ── Fournisseurs ───────────────────────────────────────────────────────────
  const refOf = new Map(input.receptions.map((r) => [r.id, r.reference]));
  const suppliers: SupplierCard[] = input.suppliers
    .filter((s) => s.isActive)
    .map((s) => {
      const mine = input.orders.filter((o) => o.supplier_id === s.id);
      const rel = supplierReliability(mine, todayDate);
      const o = owedBy.get(s.id);
      return {
        id: s.id,
        name: s.name,
        city: s.city,
        category: s.category,
        owed: o?.owed ?? 0,
        overdue: o?.overdue ?? 0,
        openOrders: mine.filter((x) => x.status === "open").length,
        fillRate: rel.service_rate === null ? null : Math.round(rel.service_rate * 100),
        sampleOrders: rel.sample_orders,
        leadTimeDays: rel.lead_time_days,
        toSettle: arrivals.filter((a) => a.supplierId === s.id).length,
        claims: input.claims
          .filter((c) => c.supplierId === s.id && c.status === "open" && c.amount > EPS)
          .map((c) => ({ id: c.id, amount: c.amount, units: c.units, kind: c.kind, receptionRef: c.receptionId ? refOf.get(c.receptionId) ?? null : null })),
      };
    })
    .sort((a, b) => b.owed - a.owed || b.openOrders - a.openOrders || a.name.localeCompare(b.name));

  const owed = round3(bills.reduce((a, b) => a + b.left, 0));
  return {
    today,
    tiles: {
      owed,
      late: buckets[0].total,
      toSettle: arrivals.length,
      openOrders: orders.length,
      arrivingThisWeek,
      suppliers: suppliers.length,
      openClaims: suppliers.reduce((a, s) => a + s.claims.length, 0),
    },
    buckets,
    bills,
    unknownBills,
    arrivals,
    orders,
    committed: round3(orders.reduce((a, o) => a + (o.total ?? 0), 0)),
    suggestions: input.suggestions.map((g) => ({ ...g, siteName: site.get(g.siteId) ?? null })),
    suppliers,
    catalogue: input.products
      .map((p) => ({ id: p.id, name: p.name, lastPrice: last.get(p.id)?.price ?? null, lastSupplierId: last.get(p.id)?.supplierId ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    warehouses: input.warehouses,
  };
}
