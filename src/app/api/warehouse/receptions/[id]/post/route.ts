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
 * ligne de registre par ligne reçue et, seulement si on le lui demande,
 * recalcule `unit_cogs`. La route ne fait que traduire les codes d'erreur.
 *
 * `adopt_costs` DOIT arriver explicitement à `true`. Un client qui oublie le
 * champ ne redate pas la rentabilité par accident.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPostReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { adopt_costs?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Un corps vide est légitime : ne rien adopter est le défaut.
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_reception", {
    p_reception_id: id,
    p_actor_id: actor.id,
    p_adopt_costs: body.adopt_costs === true,
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
