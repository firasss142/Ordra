import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canViewReceptions } from "@/lib/receptions/permissions";
import { projectReceptionList } from "@/lib/receptions/project";
import type { RawReception } from "@/lib/receptions/project";
import { withRouteErrors } from "@/lib/journal/route-errors";

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
  expected_at, note, photo_url, arrival_date, settled_at, settled_by,
  supplier_id, invoice_total, due_at, discrepancy_reason,
  reverses_reception_id, created_at, fee_basis,
  warehouse:warehouses ( code, name_fr, name_ar ),
  counted_by_user:users!receptions_created_by_fkey ( full_name ),
  settled_by_user:users!receptions_settled_by_fkey ( full_name ),
  supplier:suppliers ( id, name ),
  reception_lines ( ${LINE_SELECT} ),
  reception_costs ( id, kind, label, amount ),
  reception_payments ( id, paid_at, amount, method, note )
`;

async function handleGET(req: NextRequest) {
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
    open: all.filter((r) => r.status === "open").length,
    settled: all.filter((r) => r.status === "settled").length,
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

/*
 * IL N'Y A PLUS DE « CRÉER UNE RÉCEPTION » ICI.
 *
 * Le document naît au QUAI, au premier arrivage : `POST /api/warehouse/arrivals`
 * le trouve ou le crée pour (bâtiment, jour). Un formulaire de bureau qui
 * réclamait bâtiment, fournisseur, numéro de bon et date avant d'accepter une
 * seule unité demandait la paperasse AVANT la marchandise — et c'est exactement
 * là que la seule réception jamais créée en production s'est arrêtée, à zéro
 * ligne.
 */
export const GET = withRouteErrors("/api/warehouse/receptions", "GET", handleGET);
