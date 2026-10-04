import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canViewReceptions, canSettleReception } from "@/lib/receptions/permissions";
import { projectReception, type RawReception } from "@/lib/receptions/project";

export const dynamic = "force-dynamic";

const RECEPTION_SELECT = `
  id, market_id, warehouse_id, reference, supplier_name, supplier_ref, status,
  expected_at, note, photo_url, arrival_date, settled_at, settled_by,
  supplier_id, invoice_total, due_at, discrepancy_reason,
  reverses_reception_id, created_at, fee_basis,
  warehouse:warehouses ( code, name_fr, name_ar ),
  counted_by_user:users!receptions_created_by_fkey ( full_name ),
  settled_by_user:users!receptions_settled_by_fkey ( full_name ),
  supplier:suppliers ( id, name ),
  reception_lines (
    id, product_id, variant_id, expected_qty, received_qty, damaged_qty, unit_cost, landed_unit_cost, note,
    product:products ( name, sku, image_url, current_stock, unit_cogs ),
    variant:product_variants ( label, sku )
  ),
  reception_costs ( id, kind, label, amount ),
  reception_payments ( id, paid_at, amount, method, note )
`;

async function load(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  return supabase.from("receptions").select(RECEPTION_SELECT).eq("id", id).maybeSingle();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewReceptions(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await load(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // RLS a déjà filtré par marché : une réception d'un autre marché est
  // indistinguable d'une réception inexistante, et c'est voulu.
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = data as unknown as RawReception;

  // Le bâtiment est une autorisation : un agent d'un site ne lit pas l'autre.
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) {
    return NextResponse.json(
      { error: "no_site_assigned", error_code: "NO_SITE_ASSIGNED" },
      { status: 409 },
    );
  }
  if (site.pinned && site.warehouseId && raw.warehouse_id !== site.warehouseId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ reception: projectReception(raw, actor.role) });
}

/**
 * Modifier un brouillon : l'en-tête et les lignes, en un seul appel.
 *
 * Les lignes sont remplacées en bloc plutôt que patchées une par une : le
 * client tient la liste complète, et un remplacement ne peut pas laisser une
 * ligne fantôme derrière lui. Le trigger d'immutabilité refuse tout cela dès
 * que la réception est validée — la garde n'est pas ici, elle est en base.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  /*
   * CHIFFRER EST UN GESTE DE BUREAU. Les QUANTITÉS appartiennent au quai et ne
   * passent plus par ici : elles s'écrivent par `record_arrival` et se corrigent
   * par `correct_arrival`, qui écrit le delta au registre. Ce qui reste ici,
   * c'est le PRIX — et le prix n'est pas une information de quai.
   */
  if (!canSettleReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    supplier_name?: string | null;
    supplier_ref?: string | null;
    expected_at?: string | null;
    note?: string | null;
    lines?: {
      id?: string;
      unit_cost?: number | null;
      note?: string | null;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("receptions")
    .select("id, status, warehouse_id, market_id")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string; warehouse_id: string; market_id: string }>();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (current.status !== "open") {
    return NextResponse.json(
      { error: "Cette réception est définitive", error_code: "RECEPTION_IMMUTABLE" },
      { status: 409 },
    );
  }

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.pinned && site.warehouseId && current.warehouse_id !== site.warehouseId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const header: Record<string, unknown> = {};
  if ("supplier_name" in body) header.supplier_name = body.supplier_name?.trim() || null;
  if ("supplier_ref" in body) header.supplier_ref = body.supplier_ref?.trim() || null;
  if ("expected_at" in body) header.expected_at = body.expected_at || null;
  if ("note" in body) header.note = body.note?.trim() || null;

  if (Object.keys(header).length > 0) {
    const { error } = await supabase.from("receptions").update(header).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  /*
   * ON NE REMPLACE PLUS LA LISTE DES LIGNES.
   *
   * L'ancienne version supprimait toutes les lignes et les réinsérait : sous le
   * modèle de l'arrivage, cela effacerait des lignes dont le stock est DÉJÀ
   * entré, et le registre ne saurait plus à quoi rattacher ses mouvements. Les
   * lignes naissent au quai et meurent avec leur document.
   *
   * Seul le PRIX se modifie ici, ligne par ligne, et uniquement sur des lignes
   * de CETTE réception.
   */
  if (Array.isArray(body.lines)) {
    for (const l of body.lines) {
      if (!l.id) continue;
      const patch: Record<string, unknown> = {};
      if ("unit_cost" in l) patch.unit_cost = l.unit_cost ?? null;
      if ("note" in l) patch.note = l.note?.trim() || null;
      if (Object.keys(patch).length === 0) continue;

      const { error } = await supabase
        .from("reception_lines")
        .update(patch)
        .eq("id", l.id)
        .eq("reception_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const { data: fresh } = await load(supabase, id);
  return NextResponse.json({
    reception: projectReception(fresh as unknown as RawReception, actor.role),
  });
}

/** Supprimer un groupe ouvert. Une réception soldée se contre-passe, ne se supprime pas. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("receptions").delete().eq("id", id);
  if (error) {
    // Le trigger d'immutabilité parle en 42501.
    const immutable = error.message.includes("définitive") || error.code === "42501";
    return NextResponse.json(
      { error: error.message, error_code: immutable ? "RECEPTION_IMMUTABLE" : undefined },
      { status: immutable ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
