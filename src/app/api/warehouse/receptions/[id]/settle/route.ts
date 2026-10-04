import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canSettleReception } from "@/lib/receptions/permissions";
import { rpcErrorResponse } from "@/lib/receptions/rpc-errors";

export const dynamic = "force-dynamic";

/**
 * SOLDER — le geste du bureau.
 *
 * Le stock a déjà bougé au quai. Solder écrit l'ARGENT : le fournisseur, les
 * prix, les frais répartis, le coût de revient, le dû — et frappe la référence
 * `REC-…`, parce que le numéro est l'identité du DOCUMENT et que le document
 * naît ici.
 *
 * LE RAPPROCHEMENT EST LA BARRIÈRE. Une deuxième signature ne crée pas de
 * preuve : elle crée un deuxième nom sous le même chiffre non vérifié. Comparer
 * deux sources indépendantes, si — ce que l'agent a compté à l'aveugle, et ce
 * que le fournisseur réclame par écrit. Un écart non justifié fait répondre
 * `DISCREPANCY` en 422, et l'écran propose la cause quand la base la connaît
 * (`damaged_qty × prix` explique souvent le trou exactement).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canSettleReception(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    supplier_id?: string;
    invoice_total?: number | null;
    due_at?: string | null;
    discrepancy_reason?: string | null;
    claim_amount?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.supplier_id) {
    return NextResponse.json(
      { error: "Un fournisseur est requis pour solder", error_code: "SUPPLIER_REQUIRED" },
      { status: 400 },
    );
  }

  // `null` est légitime : on peut solder sans facture sous les yeux, et le
  // rapprochement ne s'applique alors pas. C'est `0` qui mentirait.
  const invoice =
    body.invoice_total === null || body.invoice_total === undefined
      ? null
      : Number(body.invoice_total);
  if (invoice !== null && (!Number.isFinite(invoice) || invoice < 0)) {
    return NextResponse.json(
      { error: "Le total de la facture doit être positif" },
      { status: 400 },
    );
  }

  /*
   * LE LITIGE EST CE QU'ON REFUSE DE PAYER, pas une facture rabotée.
   * `invoice_total` garde le chiffre que le fournisseur a écrit ; le montant
   * réclamé vit dans `supplier_claims` et se retire du solde. Y ranger la valeur
   * marchandise à la place stockerait un chiffre qui ne figure sur aucun
   * document, et il faudrait deviner écran par écran lequel des deux on lit.
   *
   * Les deux voyagent dans LE MÊME appel : solder puis réclamer en deux
   * requêtes laisserait une fenêtre où la réception est soldée et la
   * réclamation perdue — alors que l'écran a promis qu'elle resterait visible
   * dans Achats jusqu'à sa résolution.
   */
  const claim =
    body.claim_amount === null || body.claim_amount === undefined
      ? null
      : Number(body.claim_amount);
  if (claim !== null && (!Number.isFinite(claim) || claim <= 0)) {
    return NextResponse.json(
      { error: "Le montant réclamé doit être strictement positif" },
      { status: 400 },
    );
  }
  if (claim !== null && invoice === null) {
    return NextResponse.json(
      {
        error: "On ne réclame rien sans facture à contester",
        error_code: "CLAIM_WITHOUT_INVOICE",
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_reception", {
    p_reception_id: id,
    p_actor_id: actor.id,
    p_supplier_id: body.supplier_id,
    p_invoice_total: invoice,
    p_due_at: body.due_at || null,
    p_discrepancy_reason: body.discrepancy_reason?.trim() || null,
    p_claim_amount: claim,
  });

  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data);
}
