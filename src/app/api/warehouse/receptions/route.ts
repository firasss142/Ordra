import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canViewReceptions, canDraftReception } from "@/lib/receptions/permissions";
import { projectReceptionList } from "@/lib/receptions/project";
import type { RawReception } from "@/lib/receptions/project";

export const dynamic = "force-dynamic";

/**
 * Les réceptions d'un marché et d'un bâtiment.
 *
 * LE MARCHÉ VIENT DU SCOPE, PAS SEULEMENT DE L'URL. `/api/warehouse/stock`
 * ne lit que `?market_id`, que son client n'envoie jamais, donc un super_admin
 * y voit la Tunisie et la Libye mélangées. On utilise ici
 * `resolveWarehouseScope`, comme `/api/warehouse/history`, pour que le
 * sélecteur de marché de la barre du haut soit respecté.
 *
 * LE BÂTIMENT EST UNE AUTORISATION, PAS UN FILTRE. Un agent d'entrepôt ne voit
 * que son bâtiment ; un agent sans bâtiment ne voit rien et se le fait dire.
 */

const LINE_SELECT = `
  id, product_id, variant_id, expected_qty, received_qty, damaged_qty, unit_cost, landed_unit_cost, note,
  product:products ( name, sku, image_url, current_stock, unit_cogs ),
  variant:product_variants ( label, sku )
`;

const RECEPTION_SELECT = `
  id, market_id, warehouse_id, reference, supplier_name, supplier_ref, status,
  expected_at, note, photo_url, submitted_at, submitted_by, posted_at, posted_by,
  reverses_reception_id, created_at, fee_basis,
  warehouse:warehouses ( code, name_fr, name_ar ),
  submitted_by_user:users!receptions_submitted_by_fkey ( full_name ),
  posted_by_user:users!receptions_posted_by_fkey ( full_name ),
  reception_lines ( ${LINE_SELECT} ),
  reception_costs ( id, kind, label, amount ),
  reception_payments ( id, paid_at, amount, method, note )
`;

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewReceptions(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const scope = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: req.nextUrl.searchParams.get("warehouse_id"),
  });

  // Un agent sans bâtiment ne voit rien. Une liste vide qui nomme sa raison
  // renvoie l'agent vers son manager, pas vers la mauvaise étagère.
  if (site.unassigned) {
    return NextResponse.json({
      receptions: [],
      unassigned: true,
      error_code: "NO_SITE_ASSIGNED",
      currency: scope.currency,
    });
  }

  let query = supabase
    .from("receptions")
    .select(RECEPTION_SELECT)
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope.marketId) query = query.eq("market_id", scope.marketId);
  if (site.warehouseId) query = query.eq("warehouse_id", site.warehouseId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  /*
   * LES COMPTEURS SE COMPTENT SUR TOUT, LE FILTRE S'APPLIQUE APRÈS.
   *
   * Le filtre de statut était posé sur la requête SQL, et les compteurs étaient
   * ensuite comptés sur ce qu'elle retournait : demander `status=draft` donnait
   * donc « À valider 0 » et « Validées 0 ». Le seul écran censé dire à un
   * manager ce qui l'attend l'oubliait dès qu'on s'en servait.
   *
   * « impayées » n'est de toute façon pas un statut en base — c'est une
   * déduction de somme(paiements) contre la valeur reçue — donc le filtre vivait
   * déjà en partie ici. Il y vit maintenant entièrement, et la règle n'est
   * écrite qu'une fois.
   */
  const all = projectReceptionList((data ?? []) as unknown as RawReception[], actor.role);

  const counts = {
    all: all.length,
    draft: all.filter((r) => r.status === "draft").length,
    submitted: all.filter((r) => r.status === "submitted").length,
    posted: all.filter((r) => r.status === "posted").length,
    unpaid: all.filter((r) => r.payment_state === "unpaid" || r.payment_state === "partial").length,
    late: all.filter((r) => r.is_late).length,
  };

  const status = req.nextUrl.searchParams.get("status");
  const receptions =
    !status || status === "all"
      ? all
      : status === "unpaid"
        ? all.filter((r) => r.payment_state === "unpaid" || r.payment_state === "partial")
        : all.filter((r) => r.status === status);

  return NextResponse.json({
    receptions,
    currency: scope.currency,
    site: { warehouse_id: site.warehouseId, pinned: site.pinned },
    counts,
  });
}

/**
 * Créer un brouillon. Rien n'entre en stock ici — c'est `POST .../[id]/post`
 * qui le fait, et lui seul.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canDraftReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    warehouse_id?: string;
    supplier_name?: string;
    supplier_ref?: string;
    expected_at?: string | null;
    note?: string;
    lines?: {
      product_id?: string;
      variant_id?: string | null;
      expected_qty?: number | null;
      received_qty?: number | null;
      damaged_qty?: number | null;
      unit_cost?: number | null;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const scope = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: body.warehouse_id ?? null,
  });

  if (site.unassigned) {
    return NextResponse.json(
      { error: "no_site_assigned", error_code: "NO_SITE_ASSIGNED" },
      { status: 409 },
    );
  }

  const warehouseId = site.warehouseId ?? body.warehouse_id ?? null;
  if (!warehouseId) {
    return NextResponse.json(
      { error: "A reception happens in one building — warehouse_id is required" },
      { status: 400 },
    );
  }

  // Le marché vient du bâtiment, jamais du corps de la requête : c'est le
  // bâtiment qui est physique, et un client ne choisit pas son marché.
  const { data: warehouse, error: whError } = await supabase
    .from("warehouses")
    .select("id, market_id")
    .eq("id", warehouseId)
    .maybeSingle<{ id: string; market_id: string }>();

  if (whError) return NextResponse.json({ error: whError.message }, { status: 500 });
  if (!warehouse) return NextResponse.json({ error: "Unknown warehouse" }, { status: 404 });

  if (actor.role !== "super_admin" && warehouse.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "super_admin" && scope.marketId && warehouse.market_id !== scope.marketId) {
    return NextResponse.json(
      { error: "Ce bâtiment n'appartient pas au marché sélectionné" },
      { status: 400 },
    );
  }

  const { data: reference, error: refError } = await supabase.rpc("next_reception_reference", {
    p_market_id: warehouse.market_id,
  });
  if (refError) return NextResponse.json({ error: refError.message }, { status: 500 });

  const { data: created, error: insertError } = await supabase
    .from("receptions")
    .insert({
      market_id: warehouse.market_id,
      warehouse_id: warehouseId,
      reference,
      supplier_name: body.supplier_name?.trim() || null,
      supplier_ref: body.supplier_ref?.trim() || null,
      expected_at: body.expected_at || null,
      note: body.note?.trim() || null,
      status: "draft",
      created_by: actor.id,
    })
    .select("id, reference")
    .single<{ id: string; reference: string }>();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const lines = (body.lines ?? []).filter((l) => l.product_id);
  if (lines.length > 0) {
    const { error: linesError } = await supabase.from("reception_lines").insert(
      lines.map((l) => ({
        reception_id: created.id,
        product_id: l.product_id!,
        variant_id: l.variant_id ?? null,
        expected_qty: l.expected_qty ?? null,
        received_qty: l.received_qty ?? null,
        damaged_qty: l.damaged_qty ?? 0,
        // Un agent d'entrepôt ne saisit pas de prix : même s'il en envoyait un,
        // il est ignoré côté serveur.
        unit_cost: actor.role === "warehouse_agent" ? null : (l.unit_cost ?? null),
      })),
    );
    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ id: created.id, reference: created.reference }, { status: 201 });
}
