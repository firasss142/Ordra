import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canPostReception } from "@/lib/receptions/permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Renvoyer une déclaration à son agent.
 *
 * LA TROISIÈME ISSUE. Sans elle, un manager qui voit une erreur dans une
 * déclaration n'a que deux choix : valider ce qui est faux, ou ne rien faire —
 * et la deuxième laisse la réception bloquée pour toujours dans sa file.
 *
 * C'EST LE GESTE DE CELUI QUI VALIDE, pas de celui qui déclare. Si l'agent
 * pouvait rouvrir sa propre déclaration, il déclarerait, corrigerait et
 * redéclarerait sans qu'aucun manager ne voie passer la version intermédiaire :
 * la séparation des tâches ne tiendrait plus.
 *
 * RIEN N'A BOUGÉ EN STOCK à ce stade — seule la validation écrit le registre —
 * donc il n'y a rien à annuler et aucune contre-passation à écrire. La réception
 * redevient simplement un brouillon, et la trace de déclaration part avec le
 * statut : « déclarée par Adel » sur un brouillon que personne n'a déclaré
 * serait un mensonge, et c'est justement ce libellé qu'un manager lit pour
 * savoir qui a compté.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPostReception(actor.role)) {
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
  if (site.pinned && site.warehouseId && reception.warehouse_id !== site.warehouseId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Une réception validée se contre-passe, elle ne se rouvre pas : le registre
  // porte déjà son mouvement. Un brouillon, lui, n'a jamais été déclaré.
  if (reception.status !== "submitted") {
    return NextResponse.json(
      {
        error: "Seule une réception déclarée se renvoie",
        error_code: "NOT_SUBMITTED",
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("receptions")
    .update({ status: "draft", submitted_at: null, submitted_by: null })
    .eq("id", id)
    // Garde contre deux clics simultanés : si elle vient d'être validée, ce
    // filtre ne trouve rien et rien n'est réécrit.
    .eq("status", "submitted");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, status: "draft" });
}

export const POST = withRouteErrors("/api/warehouse/receptions/[id]/unsubmit", "POST", handlePOST);
