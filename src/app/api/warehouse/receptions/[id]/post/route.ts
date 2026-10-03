import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canPostReception } from "@/lib/receptions/permissions";

export const dynamic = "force-dynamic";

/**
 * Valider une réception — le seul geste qui fait exister le stock.
 *
 * Tout le travail est dans `post_reception` : c'est elle qui verrouille la
 * réception, vérifie le rôle et le marché, crée la ligne de site, écrit une
 * ligne de registre par ligne reçue, répartit les frais d'approche et écrit le
 * COÛT DE REVIENT de chaque ligne. La route ne fait que traduire les codes
 * d'erreur.
 *
 * IL N'Y A PLUS DE `adopt_costs`. Mettre à jour `unit_cogs` est une POLITIQUE
 * COMPTABLE, lue par la RPC dans le réglage `costing_update_on_settle` du
 * marché — pas une case cochée sur ce document-ci par celui qui validait, à
 * 23 h, sur un quai. Un an de cette case donnait un `unit_cogs` qui faisait une
 * marche aléatoire entre les prix d'achat. Absent, le réglage vaut FAUX : on
 * n'allume pas une réécriture du P&L par défaut.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPostReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_reception", {
    p_reception_id: id,
    p_actor_id: actor.id,
  });

  if (error) {
    const detail = typeof error.details === "string" ? error.details : "";
    const code = detail.match(/"code"\s*:\s*"([A-Z_]+)"/)?.[1] ?? null;

    const status =
      code === "ACTOR_MISMATCH" || code === "FORBIDDEN" || code === "MARKET_MISMATCH"
        ? 403
        : code === "NO_RECEPTION"
          ? 404
          : code === "ALREADY_POSTED"
            ? 409
            : 422;

    return NextResponse.json({ error: error.message, error_code: code }, { status });
  }

  return NextResponse.json(data);
}
