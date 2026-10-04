import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageSuppliers } from "@/lib/purchases/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";

export const dynamic = "force-dynamic";

/**
 * RÉSOUDRE UN LITIGE FOURNISSEUR.
 *
 * Deux issues, et chacune dit autre chose sur le fournisseur :
 *   · `credited` — l'avoir est arrivé. On ne l'a jamais dû, et c'est clos.
 *   · `conceded` — on renonce. Le montant cesse d'être retenu, donc il rejoint
 *     ce qu'on doit : la facture, elle, n'a jamais bougé.
 *
 * Il n'y a pas de troisième mot. « Retiré », « abandonné » auraient exactement
 * la conséquence de `conceded`, et deux noms sous un seul effet finissent
 * toujours par être comptés deux fois.
 *
 * UN LITIGE EST DE L'ARGENT, donc c'est une affaire de bureau — même frontière
 * que les coûts. L'agent du quai compte les unités cassées, il est la SOURCE du
 * chiffre, et il ne voit ni le montant ni l'ardoise.
 */

const OUTCOMES = new Set(["credited", "conceded"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageSuppliers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { outcome?: string; credit_ref?: string | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const outcome = typeof body.outcome === "string" ? body.outcome : "";
  if (!OUTCOMES.has(outcome)) {
    return NextResponse.json(
      { error: "Issue inconnue", error_code: "BAD_OUTCOME" },
      { status: 400 },
    );
  }

  const creditRef = body.credit_ref?.trim() || null;
  // UN AVOIR SE PROUVE. Effacer une créance sur une parole est exactement
  // l'écriture qu'un audit demandera à voir.
  if (outcome === "credited" && !creditRef) {
    return NextResponse.json(
      { error: "La référence de l'avoir est requise", error_code: "CREDIT_REF_REQUIRED" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_supplier_claim", {
    p_claim_id: id,
    p_actor_id: actor.id,
    p_outcome: outcome,
    p_credit_ref: creditRef,
    p_note: body.note?.trim() || null,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data);
}
