import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canPlacePurchaseOrder } from "@/lib/purchases/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";

export const dynamic = "force-dynamic";

/**
 * ARRÊTER D'ATTENDRE LE RESTE.
 *
 * Une livraison courte est le cas NORMAL : tant que la commande court, le reste
 * peut encore arriver, et la base ne clôture d'elle-même que lorsque TOUTES les
 * lignes sont servies. Décider que le reste ne viendra pas est un jugement, pas
 * un calcul — il appartient à l'acheteur, et c'est cette route.
 *
 * `close_purchase_order` choisit alors entre `closed` et `cancelled` : une
 * commande dont rien n'est arrivé est annulée et ne pèse pas sur le taux de
 * service du fournisseur, parce qu'elle ne dit rien sur sa capacité à servir.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPlacePurchaseOrder(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { reason?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    // Un corps vide est légitime : clôturer sans motif reste une décision.
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_purchase_order", {
    p_purchase_order_id: id,
    p_actor_id: actor.id,
    p_reason: body.reason?.trim() || null,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data);
}
