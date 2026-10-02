import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageReceptionPayments } from "@/lib/receptions/permissions";

export const dynamic = "force-dynamic";

const METHODS = ["cash", "bank_transfer", "cheque", "other"] as const;

/**
 * Enregistrer un versement sur une réception.
 *
 * LE PAIEMENT EST UNE LISTE, PAS UNE CASE. « payé / partiellement payé » se
 * déduit de somme(paiements) contre la valeur reçue et n'est stocké nulle part.
 * Deux acomptes sur une livraison marchent donc d'emblée, et le reste à payer
 * ne peut pas se désynchroniser de ses lignes.
 *
 * LIMITE ASSUMÉE : un versement couvrant TROIS livraisons n'a pas sa place ici.
 * Il faudra une facture fournisseur, et ces lignes s'y rebrancheront sans être
 * réécrites — c'est à cela que sert `receptions.supplier_invoice_id`, laissé
 * nullable et sans cible.
 *
 * Un agent d'entrepôt n'entre pas ici : un paiement est une information
 * d'argent, et la RLS de `reception_payments` le refuse aussi.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageReceptionPayments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { amount?: number; paid_at?: string; method?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Le montant doit être strictement positif" },
      { status: 400 },
    );
  }
  if (body.method && !METHODS.includes(body.method as (typeof METHODS)[number])) {
    return NextResponse.json({ error: "Mode de paiement inconnu" }, { status: 400 });
  }

  const supabase = await createClient();

  // Une réception contre-passée n'attend plus d'argent.
  const { data: reception, error: loadError } = await supabase
    .from("receptions")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!reception) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reception.status === "reversed" || reception.status === "cancelled") {
    return NextResponse.json(
      { error: "Cette réception n'attend plus de paiement", error_code: "RECEPTION_CLOSED" },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("reception_payments")
    .insert({
      reception_id: id,
      amount,
      paid_at: body.paid_at || new Date().toISOString().slice(0, 10),
      method: body.method || null,
      note: body.note?.trim() || null,
      created_by: actor.id,
    })
    .select("id, paid_at, amount, method, note")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ payment: data }, { status: 201 });
}

/** Supprimer un versement saisi par erreur. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageReceptionPayments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const paymentId = req.nextUrl.searchParams.get("payment_id");
  if (!paymentId) {
    return NextResponse.json({ error: "payment_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reception_payments")
    .delete()
    .eq("id", paymentId)
    .eq("reception_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
