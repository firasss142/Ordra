import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewPurchaseOrders, canPlacePurchaseOrder } from "@/lib/purchases/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";
import { projectPurchaseOrder, type PurchaseOrderRow } from "@/lib/purchases/orders";

export const dynamic = "force-dynamic";

/**
 * LES BONS DE COMMANDE.
 *
 * LE MARCHÉ VIENT DE L'ACTEUR, JAMAIS DU CORPS DE LA REQUÊTE — seul un
 * super_admin nomme un marché, parce qu'il n'en a pas.
 *
 * LE QUAI N'A PAS ACCÈS À CETTE ROUTE. La RLS le refuserait déjà, mais une
 * route ne s'appuie jamais sur la base pour dire non : c'est la règle du
 * comptage à l'aveugle, et elle doit tenir aux deux étages.
 */

interface IncomingLine {
  product_id?: string;
  variant_id?: string | null;
  qty?: number;
  unit_cost?: number | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewPurchaseOrders(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const supabase = await createClient();

  /*
   * LE LITTÉRAL RESTE ENTIER. `supabase-js` déduit le type du `.select()` de la
   * CHAÎNE elle-même ; la couper avec un `+` perd tout le typage et laisse
   * passer un champ qui n'existe pas.
   */
  let q = supabase
    .from("purchase_orders")
    .select(
      "id, reference, market_id, warehouse_id, supplier_id, status, wanted_by, ordered_at, closed_at, close_reason, note, warehouses(code, name_fr, name_ar), suppliers(name), users!purchase_orders_ordered_by_fkey(full_name)",
    )
    .eq("market_id", marketId)
    .order("ordered_at", { ascending: false });
  if (status) q = q.eq("status", status);

  const { data: poRows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (poRows ?? []).map((o) => o.id as string);
  /*
   * DEUX REQUÊTES, PAS UNE IMBRICATION. `purchase_order_line_progress` est une
   * VUE ; PostgREST ne garantit pas de déduire sa relation vers
   * `purchase_orders`, et un `select` imbriqué qui échoue rendrait un tableau
   * vide — « rien en route », le mensonge le plus cher de tout cet écran.
   */
  const { data: lineRows } = ids.length
    ? await supabase
        .from("purchase_order_line_progress")
        .select(
          "id, purchase_order_id, product_id, variant_id, ordered_qty, unit_cost, received_qty, first_received_at, products(name), product_variants(label)",
        )
        .in("purchase_order_id", ids)
    : { data: [] };

  const linesBy = new Map<string, PurchaseOrderRow["lines"]>();
  for (const raw of (lineRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const poId = raw.purchase_order_id as string;
    const product = raw.products as { name?: string } | null;
    const variant = raw.product_variants as { label?: string } | null;
    const bucket = linesBy.get(poId) ?? [];
    bucket.push({
      id: raw.id as string,
      product_id: raw.product_id as string,
      product_name: product?.name ?? "",
      variant_id: (raw.variant_id as string | null) ?? null,
      variant_label: variant?.label ?? null,
      ordered_qty: Number(raw.ordered_qty ?? 0),
      // `null` traverse : un prix absent n'est pas un prix de zéro.
      unit_cost: raw.unit_cost === null || raw.unit_cost === undefined ? null : Number(raw.unit_cost),
      received_qty: Number(raw.received_qty ?? 0),
      first_received_at: (raw.first_received_at as string | null) ?? null,
    });
    linesBy.set(poId, bucket);
  }

  const now = new Date();
  const orders = ((poRows ?? []) as unknown as Array<Record<string, unknown>>).map((o) => {
    // `warehouses` ne porte pas de colonne `name` : c'est `name_fr` / `name_ar`.
    // Le français est la langue du bureau (un super_admin n'a pas de marché, donc
    // l'intergiciel le sert toujours en français), et `code` est le dernier recours.
    const wh = o.warehouses as { code?: string; name_fr?: string; name_ar?: string } | null;
    const sup = o.suppliers as { name?: string } | null;
    const by = o.users as { full_name?: string } | null;
    const row: PurchaseOrderRow = {
      id: o.id as string,
      reference: o.reference as string,
      market_id: o.market_id as string,
      warehouse_id: o.warehouse_id as string,
      warehouse_name: wh?.name_fr ?? wh?.code ?? null,
      supplier_id: o.supplier_id as string,
      supplier_name: sup?.name ?? null,
      status: o.status as PurchaseOrderRow["status"],
      wanted_by: (o.wanted_by as string | null) ?? null,
      ordered_at: o.ordered_at as string,
      ordered_by_name: by?.full_name ?? null,
      closed_at: (o.closed_at as string | null) ?? null,
      close_reason: (o.close_reason as string | null) ?? null,
      note: (o.note as string | null) ?? null,
      lines: linesBy.get(o.id as string) ?? [],
    };
    return projectPurchaseOrder(row, now);
  });

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPlacePurchaseOrder(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    supplier_id?: string;
    warehouse_id?: string;
    wanted_by?: string | null;
    note?: string | null;
    lines?: IncomingLine[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.supplier_id || !body.warehouse_id) {
    return NextResponse.json(
      { error: "Un fournisseur et un bâtiment sont requis", error_code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "Une commande sans ligne n'est pas une commande", error_code: "EMPTY_ORDER" },
      { status: 400 },
    );
  }

  const lines: Array<{
    product_id: string;
    variant_id: string | null;
    qty: number;
    unit_cost: number | null;
  }> = [];
  for (const l of raw) {
    const qty = typeof l.qty === "number" ? l.qty : NaN;
    if (!l.product_id || !Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json(
        { error: "Chaque ligne doit porter un produit et une quantité entière positive" },
        { status: 400 },
      );
    }
    const cost =
      l.unit_cost === null || l.unit_cost === undefined ? null : Number(l.unit_cost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      return NextResponse.json({ error: "Le prix annoncé doit être positif" }, { status: 400 });
    }
    lines.push({
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      qty,
      unit_cost: cost,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_actor_id: actor.id,
    p_supplier_id: body.supplier_id,
    p_warehouse_id: body.warehouse_id,
    p_lines: lines,
    p_wanted_by: body.wanted_by || null,
    p_note: body.note?.trim() || null,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data);
}
