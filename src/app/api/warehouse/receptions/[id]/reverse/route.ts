import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReverseReception } from "@/lib/receptions/permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Contre-passer une réception validée.
 *
 * Le registre est en écriture seule : on ne modifie pas, on ajoute l'inverse.
 * `reverse_reception` refuse AVANT toute écriture si les unités sont déjà
 * parties — réécrire l'histoire n'est pas la réponse quand la marchandise est
 * chez le client ; un comptage l'est.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canReverseReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Une note est facultative ; le motif par défaut nomme la réception d'origine.
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_reception", {
    p_reception_id: id,
    p_actor_id: actor.id,
    p_note: body.note?.trim() || null,
  });

  if (error) {
    const detail = typeof error.details === "string" ? error.details : "";
    const code = detail.match(/"code"\s*:\s*"([A-Z_]+)"/)?.[1] ?? null;

    const status =
      code === "ACTOR_MISMATCH" || code === "FORBIDDEN"
        ? 403
        : code === "NO_RECEPTION"
          ? 404
          : code === "NOT_POSTED"
            ? 409
            : 422; // STOCK_UNDERFLOW arrive ici, avec son message explicite

    return NextResponse.json({ error: error.message, error_code: code }, { status });
  }

  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/warehouse/receptions/[id]/reverse", "POST", handlePOST);
