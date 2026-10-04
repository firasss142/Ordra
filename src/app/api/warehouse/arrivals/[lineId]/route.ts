import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canRecordArrival } from "@/lib/receptions/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * CORRIGER UN COMPTAGE.
 *
 * On n'efface rien : `correct_arrival` écrit le DELTA au registre, en
 * `arrival_correction`. Compter 100 puis corriger à 94 laisse deux lignes,
 * +100 et −6, et la ligne porte « corrigée » à l'écran. Le registre reste en
 * ajout seul, comme partout ailleurs dans Ordra.
 *
 * La porte se ferme au soldage : à ce moment-là le coût de revient est écrit et
 * a pu nourrir `unit_cogs`, donc rouvrir le comptage ferait mentir le registre.
 */
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
): Promise<NextResponse> {
  const { lineId } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canRecordArrival(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { qty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const qty = typeof body.qty === "number" ? body.qty : NaN;
  // Zéro est une réponse — « le carton était vide ». C'est `null` qui n'en est
  // pas une, et il n'a pas sa place ici.
  if (!Number.isInteger(qty) || qty < 0) {
    return NextResponse.json(
      { error: "La quantité corrigée doit être un entier positif ou nul" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_arrival", {
    p_line_id: lineId,
    p_new_qty: qty,
    p_actor_id: actor.id,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data);
}

/*
 * Chaque gestionnaire passe par `withRouteErrors`, sinon ses 500 n'arrivent
 * jamais dans Journaux › « Ordra — erreurs et sécurité ». Un test du dépôt
 * (`routes-are-wrapped`) refuse toute route qui exporte un gestionnaire nu.
 */
export const PATCH = withRouteErrors("/api/warehouse/arrivals/[lineId]", "PATCH", handlePATCH);
