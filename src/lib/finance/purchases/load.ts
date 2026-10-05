/**
 * Loader for Finances › Achats. Reads one market's receptions (with payments,
 * landed fees and lines), supplier claims, purchase orders (with their progress
 * view), the dock-to-order links of the arrivals still open, the catalogue, the
 * warehouses and the restock suggestions of Stock — and hands them to the pure
 * model. RLS scopes every read to what the caller may see; the route has
 * already fixed the market from the actor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/types";
import { todayInMarket } from "@/lib/dates/market-day";
import { loadStockPage } from "@/lib/finance/stock/load";
import type { SupplierClaim } from "@/lib/purchases/claims";
import type { PurchaseOrderRow } from "@/lib/purchases/orders";
import { buildPurchasesView, type PurchasesInput, type PurchasesView, type ReceptionIn } from "./model";

/** suggestions shown on « En commande » — the most urgent first */
const SUGGESTIONS = 4;

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadPurchasesPage(
  supabase: SupabaseClient,
  input: { marketId: string; role: Role; actorMarketId: string | null; locale: "fr" | "ar" },
): Promise<PurchasesView> {
  const { marketId } = input;
  const [whRes, supRes, recRes, claimRes, poRes, prodRes, stock] = await Promise.all([
    supabase.from("warehouses").select("id, name_fr, name_ar, is_default, code").eq("market_id", marketId).eq("is_active", true).order("code"),
    supabase.from("suppliers").select("id, name, category, city, is_active").eq("market_id", marketId).order("name"),
    supabase
      .from("receptions")
      .select(
        "id, reference, status, warehouse_id, arrival_date, created_at, settled_at, supplier_id, supplier_name, supplier_ref, invoice_total, due_at, fee_basis, counted_by_user:users!receptions_created_by_fkey(full_name), reception_payments(amount), reception_costs(id, kind, amount), reception_lines(id, product_id, received_qty, damaged_qty, unit_cost, product:products(name), variant:product_variants(label))",
      )
      .eq("market_id", marketId)
      .neq("status", "reversed"),
    supabase
      .from("supplier_claims")
      .select("id, supplier_id, reception_id, kind, amount, units, status, opened_at")
      .eq("market_id", marketId),
    supabase
      .from("purchase_orders")
      .select("id, reference, market_id, warehouse_id, supplier_id, status, wanted_by, ordered_at, closed_at, close_reason, note")
      .eq("market_id", marketId),
    supabase.from("products").select("id, name").eq("market_id", marketId).eq("is_active", true).order("name"),
    // Stock's « à racheter », reused rather than recomputed. Optional: the page
    // stands without it, so a failure here must not take the debts down.
    loadStockPage(supabase, { marketId, windowDays: 28, role: input.role, actorMarketId: input.actorMarketId }).catch(() => null),
  ]);
  if (recRes.error) throw new Error(recRes.error.message);
  if (supRes.error) throw new Error(supRes.error.message);

  const recRows = (recRes.data ?? []) as Row[];
  const receptions: ReceptionIn[] = recRows.map((r) => ({
    id: r.id as string,
    reference: (r.reference as string | null) ?? null,
    status: r.status as string,
    warehouseId: r.warehouse_id as string,
    arrivalDate: (r.arrival_date as string | null) ?? null,
    createdAt: r.created_at as string,
    settledAt: (r.settled_at as string | null) ?? null,
    countedBy: ((r.counted_by_user as { full_name?: string } | null)?.full_name as string | undefined) ?? null,
    supplierId: (r.supplier_id as string | null) ?? null,
    supplierName: (r.supplier_name as string | null) ?? null,
    supplierRef: (r.supplier_ref as string | null) ?? null,
    invoiceTotal: num(r.invoice_total),
    dueAt: (r.due_at as string | null) ?? null,
    feeBasis: r.fee_basis === "units" ? "units" : "value",
    payments: ((r.reception_payments as Row[] | null) ?? []).map((p) => ({ amount: Number(p.amount ?? 0) })),
    costs: ((r.reception_costs as Row[] | null) ?? []).map((c) => ({ id: c.id as string, kind: c.kind as string, amount: Number(c.amount ?? 0) })),
    lines: ((r.reception_lines as Row[] | null) ?? []).map((l) => ({
      id: l.id as string,
      productId: l.product_id as string,
      name: ((l.product as { name?: string } | null)?.name as string | undefined) ?? "",
      variant: ((l.variant as { label?: string } | null)?.label as string | undefined) ?? null,
      received: Number(l.received_qty ?? 0),
      damaged: Number(l.damaged_qty ?? 0),
      unitCost: num(l.unit_cost),
    })),
  }));

  const claims: SupplierClaim[] = ((claimRes.data ?? []) as Row[]).map((c) => ({
    id: c.id as string,
    supplierId: c.supplier_id as string,
    receptionId: (c.reception_id as string | null) ?? null,
    kind: c.kind as SupplierClaim["kind"],
    amount: Number(c.amount ?? 0),
    units: num(c.units),
    status: c.status as SupplierClaim["status"],
    openedAt: c.opened_at as string,
  }));

  // Two queries, not a nested select: `purchase_order_line_progress` is a VIEW
  // and PostgREST does not promise its relation to `purchase_orders`.
  const poRows = (poRes.data ?? []) as Row[];
  const poIds = poRows.map((o) => o.id as string);
  const openLineIds = receptions.filter((r) => r.status === "open").flatMap((r) => r.lines.map((l) => l.id));
  const [lineRes, linkRes] = await Promise.all([
    poIds.length
      ? supabase
          .from("purchase_order_line_progress")
          .select("id, purchase_order_id, product_id, variant_id, ordered_qty, unit_cost, received_qty, first_received_at, products(name), product_variants(label)")
          .in("purchase_order_id", poIds)
      : Promise.resolve({ data: [] as Row[] }),
    openLineIds.length
      ? supabase
          .from("purchase_order_receipts")
          .select("reception_line_id, purchase_order_lines(unit_cost, purchase_orders(reference, supplier_id))")
          .in("reception_line_id", openLineIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const linesBy = new Map<string, PurchaseOrderRow["lines"]>();
  for (const l of (lineRes.data ?? []) as Row[]) {
    const key = l.purchase_order_id as string;
    linesBy.set(key, [
      ...(linesBy.get(key) ?? []),
      {
        id: l.id as string,
        product_id: l.product_id as string,
        product_name: ((l.products as { name?: string } | null)?.name as string | undefined) ?? "",
        variant_id: (l.variant_id as string | null) ?? null,
        variant_label: ((l.product_variants as { label?: string } | null)?.label as string | undefined) ?? null,
        ordered_qty: Number(l.ordered_qty ?? 0),
        unit_cost: num(l.unit_cost),
        received_qty: Number(l.received_qty ?? 0),
        first_received_at: (l.first_received_at as string | null) ?? null,
      },
    ]);
  }
  const orders: PurchaseOrderRow[] = poRows.map((o) => ({
    id: o.id as string,
    reference: o.reference as string,
    market_id: o.market_id as string,
    warehouse_id: o.warehouse_id as string,
    warehouse_name: null,
    supplier_id: o.supplier_id as string,
    supplier_name: null,
    status: o.status as PurchaseOrderRow["status"],
    wanted_by: (o.wanted_by as string | null) ?? null,
    ordered_at: o.ordered_at as string,
    ordered_by_name: null,
    closed_at: (o.closed_at as string | null) ?? null,
    close_reason: (o.close_reason as string | null) ?? null,
    note: (o.note as string | null) ?? null,
    lines: linesBy.get(o.id as string) ?? [],
  }));

  const links: PurchasesInput["links"] = [];
  for (const k of (linkRes.data ?? []) as Row[]) {
    const pol = k.purchase_order_lines as { unit_cost?: unknown; purchase_orders?: { reference?: string; supplier_id?: string } | null } | null;
    if (!pol?.purchase_orders?.reference || !pol.purchase_orders.supplier_id) continue;
    links.push({
      receptionLineId: k.reception_line_id as string,
      poRef: pol.purchase_orders.reference,
      poSupplierId: pol.purchase_orders.supplier_id,
      poLineUnitCost: num(pol.unit_cost),
    });
  }

  const suggestions: PurchasesInput["suggestions"] = (stock?.sites ?? [])
    .flatMap((s) =>
      s.rebuy
        .filter((r) => r.buy)
        .map((r) => ({ productId: r.id, name: r.name, siteId: s.id, qty: r.buy!.qty, value: r.buy!.cost, days: r.days })),
    )
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))
    .slice(0, SUGGESTIONS);

  return buildPurchasesView({
    today: todayInMarket(marketId),
    warehouses: ((whRes.data ?? []) as Row[]).map((w) => ({
      id: w.id as string,
      name: ((input.locale === "ar" ? w.name_ar : w.name_fr) as string | null) ?? (w.name_fr as string | null) ?? (w.code as string),
      isDefault: Boolean(w.is_default),
    })),
    suppliers: ((supRes.data ?? []) as Row[]).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      category: (s.category as string | null) ?? null,
      city: (s.city as string | null) ?? null,
      isActive: s.is_active !== false,
    })),
    receptions,
    claims,
    orders,
    links,
    products: ((prodRes.data ?? []) as Row[]).map((p) => ({ id: p.id as string, name: p.name as string })),
    suggestions,
  });
}
