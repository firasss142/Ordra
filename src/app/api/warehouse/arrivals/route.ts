import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canRecordArrival } from "@/lib/receptions/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";

export const dynamic = "force-dynamic";

/**
 * ENREGISTRER UN ARRIVAGE — le geste du quai, et le seul chemin d'entrée de
 * stock.
 *
 * DEUX CHAMPS. Le produit et la quantité. Le bâtiment vient de l'agent, le
 * marché du bâtiment, le jour de la base, et le document se trouve ou se crée
 * tout seul : un agent debout devant une palette n'a ni fournisseur, ni
 * référence, ni date à saisir.
 *
 * LE STOCK BOUGE ICI. C'est l'inversion du modèle : la marchandise est au sol,
 * donc elle existe. L'ancien état « déclarée mais pas validée » était une
 * fenêtre où le carton était sur l'étagère et où Ordra disait qu'il n'existait
 * pas — quelqu'un finissait par le vendre.
 *
 * Tout le travail est dans `record_arrival` : elle verrouille, vérifie le rôle,
 * le marché et le BÂTIMENT de l'agent, refuse un produit nu quand il est
 * ventilé, crée la ligne de site et écrit le registre. La route ne fait que
 * traduire les codes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canRecordArrival(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    product_id?: string;
    variant_id?: string | null;
    qty?: number;
    damaged_qty?: number;
    warehouse_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.product_id || !body.warehouse_id) {
    return NextResponse.json(
      { error: "product_id et warehouse_id sont requis" },
      { status: 400 },
    );
  }

  const qty = typeof body.qty === "number" ? body.qty : NaN;
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json(
      { error: "La quantité doit être un entier strictement positif" },
      { status: 400 },
    );
  }

  const damaged = typeof body.damaged_qty === "number" ? body.damaged_qty : 0;
  if (!Number.isInteger(damaged) || damaged < 0) {
    return NextResponse.json(
      { error: "Les unités abîmées doivent être un entier positif ou nul" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_arrival", {
    p_product_id: body.product_id,
    p_variant_id: body.variant_id ?? null,
    p_qty: qty,
    p_damaged: damaged,
    p_warehouse_id: body.warehouse_id,
    p_actor_id: actor.id,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data, { status: 201 });
}
