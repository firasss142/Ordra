import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canDraftReception } from "@/lib/receptions/permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Déclarer : « le camion est passé, voilà ce que j'ai compté ».
 *
 * Rien ne bouge en stock. C'est le geste de l'agent, et il ferme la saisie
 * jusqu'à ce qu'un manager tranche — ou la renvoie.
 *
 * On exige au moins une quantité reçue : déclarer une réception vide ne veut
 * rien dire et ferait échouer la validation plus tard, loin de la personne qui
 * pourrait encore corriger.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canDraftReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: reception, error: loadError } = await supabase
    .from("receptions")
    .select("id, status, warehouse_id")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string; warehouse_id: string }>();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!reception) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) {
    return NextResponse.json(
      { error: "no_site_assigned", error_code: "NO_SITE_ASSIGNED" },
      { status: 409 },
    );
  }
  if (site.pinned && site.warehouseId && reception.warehouse_id !== site.warehouseId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (reception.status !== "draft") {
    return NextResponse.json(
      { error: "Seul un brouillon se déclare", error_code: "NOT_DRAFT" },
      { status: 409 },
    );
  }

  const { count, error: countError } = await supabase
    .from("reception_lines")
    .select("id", { count: "exact", head: true })
    .eq("reception_id", id)
    .gt("received_qty", 0);

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if (!count) {
    return NextResponse.json(
      {
        error: "Aucune quantité reçue — comptez au moins une ligne",
        error_code: "EMPTY_RECEPTION",
      },
      { status: 422 },
    );
  }

  const { error } = await supabase
    .from("receptions")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: actor.id })
    .eq("id", id)
    .eq("status", "draft"); // garde contre deux déclarations simultanées

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, status: "submitted" });
}

export const POST = withRouteErrors("/api/warehouse/receptions/[id]/submit", "POST", handlePOST);
