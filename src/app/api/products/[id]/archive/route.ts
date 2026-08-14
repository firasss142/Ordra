// DELETE /api/products/[id]/archive — retire un produit désactivé du catalogue.
// POST   /api/products/[id]/archive — annule l'archivage.
//
// ── POURQUOI « ARCHIVE » ET PAS « DELETE » ────────────────────────────────
// Un vrai DELETE est physiquement impossible sur la plupart des produits :
// orders.product_id et inventory_log.product_id sont en NO ACTION,
// storefront_product_mappings et les tables investisseur en RESTRICT. Mesuré en
// production, deux des trois produits désactivés portent respectivement 128 et
// 2 commandes — la suppression lève. Forcer le passage voudrait dire cascader
// dans des tables que CLAUDE.md déclare APPEND-ONLY et réécrire du chiffre
// d'affaires déjà servi à des investisseurs.
// L'archivage pose donc une pierre tombale (products.deleted_at) : la ligne
// quitte product_inventory_view et tous les sélecteurs, l'historique reste.
//
// Le contrôle de rôle vit DEUX FOIS : ici (réponse HTTP lisible) et dans la RPC
// SECURITY DEFINER (autorité réelle). La route peut mentir, la RPC non.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canArchiveProduct } from "@/lib/product-permissions";

export const dynamic = "force-dynamic";

/** Traduit l'exception PL/pgSQL en statut HTTP. Aucun message SQL ne sort. */
function fromRpcError(message: string): NextResponse {
  if (message.includes("must be deactivated")) {
    return NextResponse.json({ error: "product_still_active" }, { status: 422 });
  }
  if (message.includes("Product not found")) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (message.includes("Not authorized")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canArchiveProduct(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("archive_product", {
    p_product_id: id,
    p_actor_id: actor.id,
  });

  if (error) return fromRpcError(error.message ?? "");

  return NextResponse.json({ archived_at: data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canArchiveProduct(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.rpc("restore_product", {
    p_product_id: id,
    p_actor_id: actor.id,
  });

  if (error) return fromRpcError(error.message ?? "");

  // Restauré DÉSACTIVÉ : on ne remet jamais un produit devant les agents
  // par le seul fait de le sortir de l'archive.
  return NextResponse.json({ restored: true, is_active: false });
}
